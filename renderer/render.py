"""CPU render core. No external URLs, shell interpolation, AI calls, or third-party Python deps."""
import json, math, os, struct, subprocess, threading
from pathlib import Path
FPS=30
MAX_DURATION=600

def validate_manifest(m):
    if not isinstance(m,dict) or m.get('version')!=1 or m.get('width')!=1080 or m.get('height')!=1920 or m.get('fps')!=FPS: raise ValueError('仅支持 1080×1920、30fps 视频任务。')
    frames=m.get('frames');audios=m.get('audios')
    if not isinstance(frames,list) or not 1<=len(frames)<=300 or not isinstance(audios,list) or not 1<=len(audios)<=100: raise ValueError('任务图片或音频数量无效。')
    total=0
    for f in frames:
        n=f.get('frames') if isinstance(f,dict) else None
        if isinstance(n,bool) or not isinstance(n,int) or n<1: raise ValueError('视频帧时长无效。')
        total+=n
    if total/FPS>MAX_DURATION: raise ValueError('单个视频最多 10 分钟。')
    for a in audios:
        d=a.get('duration') if isinstance(a,dict) else None
        if isinstance(d,bool) or not isinstance(d,(int,float)) or not math.isfinite(d) or d<=0 or d>MAX_DURATION: raise ValueError('真实音频时长无效。')
    if abs(sum(a['duration'] for a in audios)-total/FPS)>.1: raise ValueError('音频与视频总时长不一致。')
    return m

def probe(path, mp3=False):
    cmd=['ffprobe','-v','error','-protocol_whitelist','file,pipe']
    if mp3:cmd+=['-f','mp3']
    cmd+=['-show_streams','-show_format','-of','json',str(path)]
    return json.loads(subprocess.check_output(cmd,timeout=30))

def check_png(path):
    with open(path,'rb') as f:head=f.read(24)
    if len(head)!=24 or head[:8]!=b'\x89PNG\r\n\x1a\n' or struct.unpack('>II',head[16:24])!=(1080,1920):raise ValueError('字幕帧必须是 1080×1920 PNG。')

def progress_value(line,total):
    if not line.startswith('out_time_us='):return None
    try:value=float(line.split('=',1)[1].strip())
    except (ValueError,IndexError):return None
    if not math.isfinite(value) or value<0:return None
    return min(99,10+int(value/1e6/total*89))

def render(directory,manifest,progress=lambda n:None,cancelled=lambda:False,process_callback=lambda p:None):
    directory=Path(directory);validate_manifest(manifest)
    for i in range(len(manifest['frames'])):check_png(directory/f'frame-{i}.png')
    for i,a in enumerate(manifest['audios']):
        info=probe(directory/f'audio-{i}.mp3',True)
        if not any(s.get('codec_type')=='audio' and s.get('codec_name')=='mp3' for s in info['streams']):raise ValueError('仅支持真实 MP3 音频。')
        if abs(float(info['format']['duration'])-a['duration'])>.25:raise ValueError('音频真实时长与网页时长不符，请重新载入音频后导出。')
    total=sum(f['frames'] for f in manifest['frames'])/FPS
    lines=[]
    for i,f in enumerate(manifest['frames']):lines += [f"file 'frame-{i}.png'",f"duration {f['frames']/FPS:.9f}"]
    lines += [f"file 'frame-{len(manifest['frames'])-1}.png'"]
    (directory/'frames.txt').write_text('\n'.join(lines)+'\n')
    cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-threads','2','-protocol_whitelist','file,pipe','-f','concat','-safe','1','-c:v','png','-i',str(directory/'frames.txt')]
    for i in range(len(manifest['audios'])):cmd+=['-protocol_whitelist','file,pipe','-f','mp3','-i',str(directory/f'audio-{i}.mp3')]
    parts=[f"[{i+1}:a]aresample=48000,atrim=duration={a['duration']},apad=whole_dur={a['duration']},asetpts=PTS-STARTPTS[a{i}]" for i,a in enumerate(manifest['audios'])]
    parts+=[''.join(f'[a{i}]' for i in range(len(manifest['audios'])))+f"concat=n={len(manifest['audios'])}:v=0:a=1,apad[audio]"]
    cmd+=['-filter_complex_threads','1','-filter_complex',';'.join(parts),'-map','0:v:0','-map','[audio]','-r',str(FPS),'-c:v','libx264','-preset','veryfast','-crf','20','-profile:v','high','-level','4.0','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t',str(total),'-movflags','+faststart','-progress','pipe:1','-nostats',str(directory/'video.mp4')]
    with open(directory/'render-error.log','w') as errors:
        process=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=errors,text=True);process_callback(process)
        timer=threading.Timer(900,process.kill);timer.start()
        try:
            for line in process.stdout:
                if cancelled():process.kill();raise ValueError('导出已取消。')
                value=progress_value(line,total)
                if value is not None:progress(value)
            if process.wait()!=0:raise ValueError('FFmpeg 编码失败，请检查图片/音频或服务内存。')
        finally:
            timer.cancel()
            if process.poll() is None:process.kill();process.wait(timeout=10)
            if process.stdout:process.stdout.close()
            process_callback(None)
    info=probe(directory/'video.mp4');streams=info['streams'];v=next(s for s in streams if s['codec_type']=='video');a=next(s for s in streams if s['codec_type']=='audio')
    if v['codec_name']!='h264' or a['codec_name']!='aac' or v['width']!=1080 or v['height']!=1920:raise ValueError('输出编码验证失败。')
    progress(100);return {'duration':float(info['format']['duration']),'videoCodec':'h264','audioCodec':'aac','width':1080,'height':1920}

if __name__=='__main__':
    import sys
    directory=Path(sys.argv[1]);manifest=json.loads((directory/'manifest.json').read_text())
    print(json.dumps(render(directory,manifest),ensure_ascii=False))
