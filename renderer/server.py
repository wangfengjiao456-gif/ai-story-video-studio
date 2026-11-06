"""Single-instance authenticated render worker, stdlib only. HTTPS terminates at hosting proxy."""
import hashlib,hmac,json,os,re,secrets,shutil,threading,time,uuid
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlparse,parse_qs
from render import validate_manifest,render
ROOT=Path(os.environ.get('RENDERER_DATA_DIR','/tmp/story-renderer'));ROOT.mkdir(parents=True,exist_ok=True)
KEY=os.environ.get('RENDERER_API_KEY','');ORIGINS=set(x.strip() for x in os.environ.get('ALLOWED_ORIGINS','').split(',') if x.strip())
JOBS={};LOCK=threading.RLock();SLOT=threading.Semaphore(1);TTL=3600;MAX_JOB_BYTES=200*1024*1024

def cleanup():
    with LOCK:
        for id,job in list(JOBS.items()):
            if job['expiresAt']<time.time() and job['state']!='rendering':shutil.rmtree(ROOT/id,ignore_errors=True);del JOBS[id]

def run(id):
    j=JOBS[id]
    try:
        j['state']='rendering';j['progress']=10
        result=render(ROOT/id,j['manifest'],lambda n:j.update(progress=n),lambda:j['cancelled'],lambda p:j.update(process=p))
        j.update(state='complete',result=result)
    except Exception as err:j.update(state='error',error=str(err) if isinstance(err,ValueError) else '渲染服务内部错误，请重新导出。')
    finally:SLOT.release()

class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup();self.connection.settimeout(60)
    def log_message(self,*args):pass # Never log query-scoped credentials or project content.
    def cors(self):
        origin=self.headers.get('Origin')
        if origin in ORIGINS:self.send_header('Access-Control-Allow-Origin',origin);self.send_header('Vary','Origin')
        self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer')
    def json(self,status,value):
        data=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.cors();self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def body(self,limit):
        try:n=int(self.headers.get('Content-Length','-1'))
        except:raise ValueError('请求大小无效。')
        if n<0 or n>limit:raise ValueError('上传内容过大。')
        data=self.rfile.read(n)
        if len(data)!=n:raise ValueError('上传中断。')
        return data
    def job(self):
        cleanup();path=urlparse(self.path);match=re.fullmatch(r'/jobs/([a-f0-9]{32})(?:/(.*))?',path.path)
        if not match:return None,None,None
        id,action=match.groups();job=JOBS.get(id);token=self.headers.get('Authorization','').removeprefix('Bearer ') or parse_qs(path.query).get('token',[''])[0]
        if not job or job['expiresAt']<time.time() or not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(),job['tokenHash']):return None,None,None
        origin=self.headers.get('Origin')
        if origin and origin!=job['origin']:return None,None,None
        return id,job,action
    def do_OPTIONS(self):
        if self.headers.get('Origin') not in ORIGINS:return self.json(403,{'error':'渲染服务尚未允许当前 Preview 来源。'})
        self.send_response(204);self.cors();self.send_header('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');self.send_header('Access-Control-Allow-Headers','Authorization,Content-Type,Range');self.send_header('Access-Control-Expose-Headers','Content-Range,Content-Length');self.end_headers()
    def do_POST(self):
        try:
            if self.path=='/jobs':
                if not KEY or not hmac.compare_digest(self.headers.get('Authorization',''),f'Bearer {KEY}'):return self.json(401,{'error':'渲染服务密钥不匹配。'})
                body=json.loads(self.body(100000));validate_manifest(body)
                if body.get('origin') not in ORIGINS:return self.json(403,{'error':'请在渲染服务 ALLOWED_ORIGINS 添加当前 Vercel Preview 域名。'})
                cleanup()
                with LOCK:
                    if len(JOBS)>=10:return self.json(429,{'error':'渲染任务过多，请等待旧任务过期。'})
                    id=uuid.uuid4().hex;token=secrets.token_urlsafe(32);expires=int(time.time())+TTL;(ROOT/id).mkdir()
                    JOBS[id]={'manifest':body,'origin':body['origin'],'tokenHash':hashlib.sha256(token.encode()).hexdigest(),'expiresAt':expires,'state':'uploading','progress':0,'cancelled':False,'process':None,'bytes':0}
                return self.json(200,{'jobId':id,'token':token,'expiresAt':expires})
            id,j,action=self.job()
            if not j:return self.json(401,{'error':'任务凭证无效或已过期。'})
            with LOCK:
                if action!='start' or j['state']!='uploading':return self.json(409,{'error':'任务不可重复启动。'})
                expected=[f'frame-{i}.png' for i in range(len(j['manifest']['frames']))]+[f'audio-{i}.mp3' for i in range(len(j['manifest']['audios']))]
                if not all((ROOT/id/name).is_file() for name in expected):return self.json(400,{'error':'图片或音频尚未上传完成。'})
                if not SLOT.acquire(False):return self.json(429,{'error':'渲染服务正忙，请稍后重新导出。'})
                j['state']='queued';threading.Thread(target=run,args=(id,),daemon=True).start()
            return self.json(202,{'state':'queued'})
        except (ValueError,KeyError,TypeError):return self.json(400,{'error':'视频任务格式或大小无效，请重新准备预览。'})
    def do_PUT(self):
        id,j,action=self.job()
        if not j:return self.json(401,{'error':'任务凭证无效或已过期。'})
        try:
            with LOCK:
                if j['state']!='uploading':return self.json(409,{'error':'任务已开始，不能修改媒体。'})
                valid=action in [f'frame-{i}.png' for i in range(len(j['manifest']['frames']))]+[f'audio-{i}.mp3' for i in range(len(j['manifest']['audios']))]
                if not valid:return self.json(400,{'error':'文件名无效。'})
                data=self.body(50*1024*1024 if action.startswith('audio-') else 10*1024*1024)
                path=ROOT/id/action;old=path.stat().st_size if path.exists() else 0
                if j['bytes']-old+len(data)>MAX_JOB_BYTES:return self.json(413,{'error':'单个任务最多上传 200 MB。'})
                path.write_bytes(data);j['bytes']+=len(data)-old
            return self.json(200,{'ok':True})
        except (ValueError,OSError):return self.json(400,{'error':'媒体上传失败或文件过大。'})
    def do_GET(self):
        if self.path=='/health':return self.json(200,{'ok':True})
        id,j,action=self.job()
        if not j:return self.json(401,{'error':'任务凭证无效或已过期。'})
        if action!='video':return self.json(200,{k:j[k] for k in ['state','progress','expiresAt','error','result'] if k in j})
        if j['state']!='complete':return self.json(409,{'error':'MP4 尚未完成。'})
        path=ROOT/id/'video.mp4';size=path.stat().st_size;start=0;end=size-1;partial=False
        r=self.headers.get('Range')
        if r:
            m=re.fullmatch(r'bytes=(\d*)-(\d*)',r)
            if not m:return self.json(416,{'error':'视频字节范围无效。'})
            if m[1]:start=int(m[1]);end=min(size-1,int(m[2])) if m[2] else size-1
            elif m[2]:start=max(0,size-int(m[2]))
            if start>end or start>=size:return self.json(416,{'error':'视频字节范围无效。'})
            partial=True
        self.send_response(206 if partial else 200);self.cors();self.send_header('Content-Type','video/mp4');self.send_header('Accept-Ranges','bytes');self.send_header('Content-Length',str(end-start+1))
        if partial:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        if 'download=1' in self.path:self.send_header('Content-Disposition','attachment; filename="story.mp4"')
        self.end_headers()
        with path.open('rb') as file:
            file.seek(start);remaining=end-start+1
            while remaining:
                chunk=file.read(min(131072,remaining));self.wfile.write(chunk);remaining-=len(chunk)
    def do_DELETE(self):
        id,j,action=self.job()
        if not j:return self.json(401,{'error':'任务凭证无效或已过期。'})
        j['cancelled']=True
        if j['process']:j['process'].kill()
        j['state']='error';j['error']='导出已取消。'
        return self.json(200,{'ok':True})

if __name__=='__main__':
    if len(KEY)<24 or not ORIGINS:raise SystemExit('Configure RENDERER_API_KEY (24+ chars) and ALLOWED_ORIGINS before starting.')
    ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','8000'))),Handler).serve_forever()
