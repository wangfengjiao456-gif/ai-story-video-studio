import contextlib,json,os,shutil,socket,struct,subprocess,sys,tempfile,time,unittest,urllib.request,urllib.error,zlib
from pathlib import Path
from render import validate_manifest,render,probe,progress_value

def png(path,color=(60,110,75)):
    def chunk(t,b):return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
    raw=(b'\x00'+bytes(color)*1080)*1920
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1080,1920,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))

class RendererTests(unittest.TestCase):
    def test_ffmpeg_progress_accepts_initial_na(self):
        for line in ['out_time_us=N/A\n','out_time_us=nan\n','out_time_us=-1','progress=continue']:
            self.assertIsNone(progress_value(line,10))
        self.assertEqual(progress_value('out_time_us=5000000\n',10),54)

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg not installed')
    def test_frame_boundary_uses_30fps_and_audio_duration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);png(root/'frame-0.png',(230,20,20));png(root/'frame-1.png',(20,230,20))
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:duration=1.5','-c:a','libmp3lame','-y',str(root/'audio-0.mp3')],check=True)
            duration=float(probe(root/'audio-0.mp3',True)['format']['duration'])
            total=__import__('math').ceil(duration*30)
            manifest={'version':1,'width':1080,'height':1920,'fps':30,'frames':[{'frames':16},{'frames':total-16}],'audios':[{'duration':duration}]}
            result=render(root,manifest)
            self.assertLessEqual(abs(result['duration']-duration),1/30+.001)
            data=subprocess.check_output(['ffmpeg','-v','error','-i',str(root/'video.mp4'),'-vf',r'select=eq(n\,15)+eq(n\,16),scale=1:1','-vsync','0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
            self.assertEqual(len(data),6)
            self.assertGreater(data[0],180);self.assertLess(data[1],90)
            self.assertGreater(data[4],180);self.assertLess(data[3],90)

    def test_rejects_invalid_manifest(self):
        for m in [{},{'version':1,'width':1080,'height':1920,'fps':30,'frames':[{'frames':-1}],'audios':[{'duration':1}]}]:
            with self.assertRaises(ValueError):validate_manifest(m)
    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg not installed')
    def test_authenticated_http_upload_render_range_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);png(root/'fixture.png')
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:duration=1.5','-c:a','libmp3lame','-y',str(root/'fixture.mp3')],check=True)
            duration=float(probe(root/'fixture.mp3',True)['format']['duration']);total=__import__('math').ceil(duration*30)
            manifest={'version':1,'width':1080,'height':1920,'fps':30,'frames':[{'frames':total}],'audios':[{'duration':duration}],'origin':'https://studio.test'}
            with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
            env={**os.environ,'RENDERER_API_KEY':'offline-test-key-01234567890123456789','ALLOWED_ORIGINS':'https://studio.test','PORT':str(port),'RENDERER_DATA_DIR':str(root/'jobs')}
            process=subprocess.Popen([sys.executable,str(Path(__file__).parent/'server.py')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            base=f'http://127.0.0.1:{port}'
            def request(path,method='GET',data=None,headers=None):
                req=urllib.request.Request(base+path,method=method,data=data,headers=headers or {})
                return urllib.request.urlopen(req,timeout=40)
            try:
                for _ in range(100):
                    try:request('/health').close();break
                    except (OSError,urllib.error.URLError):time.sleep(.05)
                with self.assertRaises(urllib.error.HTTPError) as denied:request('/jobs','POST',json.dumps(manifest).encode(),{'Content-Type':'application/json'})
                self.assertEqual(denied.exception.code,401)
                for origin,expected in [('https://other.test',403),('https://studio.test',200)]:
                    try:
                        checked=request('/check','POST',json.dumps({'origin':origin}).encode(),{'Content-Type':'application/json','Authorization':'Bearer '+env['RENDERER_API_KEY']})
                        self.assertEqual(checked.status,expected);checked.close()
                    except urllib.error.HTTPError as e:self.assertEqual(e.code,expected)
                response=request('/jobs','POST',json.dumps(manifest).encode(),{'Content-Type':'application/json','Authorization':'Bearer '+env['RENDERER_API_KEY']});job=json.load(response);prefix='/jobs/'+job['jobId'];auth={'Authorization':'Bearer '+job['token'],'Origin':'https://studio.test'}
                with self.assertRaises(urllib.error.HTTPError):request(prefix+'/../../secrets','PUT',b'bad',auth)
                request(prefix+'/frame-0.png','PUT',(root/'fixture.png').read_bytes(),auth).close();request(prefix+'/audio-0.mp3','PUT',(root/'fixture.mp3').read_bytes(),auth).close()
                request(prefix+'/start','POST',b'',auth).close()
                with self.assertRaises(urllib.error.HTTPError) as duplicate:request(prefix+'/start','POST',b'',auth)
                self.assertEqual(duplicate.exception.code,409)
                state={}
                for _ in range(160):
                    state=json.load(request(prefix,headers=auth))
                    if state['state'] in ['complete','error']:break
                    time.sleep(.1)
                self.assertEqual(state['state'],'complete',state)
                self.assertEqual(state['result']['videoCodec'],'h264');self.assertEqual(state['result']['audioCodec'],'aac');self.assertLessEqual(abs(state['result']['duration']-duration),1/30+.001)
                response=request(prefix+'/video?token='+job['token'],headers={'Range':'bytes=0-99','Origin':'https://studio.test'})
                self.assertEqual(response.status,206);self.assertEqual(len(response.read()),100);self.assertIn('ftyp',request(prefix+'/video?token='+job['token']).read(64).decode('latin1'))
            finally:
                process.terminate();process.wait(timeout=10)
                if process.stderr:process.stderr.close()

if __name__=='__main__':unittest.main()
