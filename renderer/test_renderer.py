import threading
from unittest.mock import patch
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

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg not installed')
    def test_ten_scenes_keep_order_silence_and_complete_audio(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);colors=[(30+i*20,220-i*17,40+i*12) for i in range(10)]
            for i,color in enumerate(colors):png(root/f'frame-{i}.png',color)
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2.5','-af','adelay=200,apad=pad_dur=0.2','-c:a','libmp3lame','-y',str(root/'audio-0.mp3')],check=True)
            duration=float(probe(root/'audio-0.mp3',True)['format']['duration'])
            lengths=[6,8,5,10,7,6,9,8,6,22]
            manifest={'version':1,'width':1080,'height':1920,'fps':30,'frames':[{'frames':n} for n in lengths],'audios':[{'duration':duration}]}
            result=render(root,manifest)
            self.assertLessEqual(abs(result['duration']-duration),1/30+.001)
            starts=[];cursor=0
            for n in lengths:starts.append(cursor);cursor+=n
            select='+'.join(f'eq(n\\,{n})' for n in starts)
            pixels=subprocess.check_output(['ffmpeg','-v','error','-i',str(root/'video.mp4'),'-vf',f'select={select},scale=1:1','-vsync','0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
            self.assertEqual(len(pixels),30)
            for i,color in enumerate(colors):self.assertLess(max(abs(pixels[i*3+j]-color[j]) for j in range(3)),12)
            samples=subprocess.check_output(['ffmpeg','-v','error','-i',str(root/'video.mp4'),'-vn','-ar','8000','-ac','1','-f','s16le','pipe:1'])
            audio=struct.unpack('<'+'h'*(len(samples)//2),samples)
            # The late tone survives; both original silent margins remain, with no tempo change.
            self.assertGreater(max(abs(x) for x in audio[int(2.55*8000):int(2.65*8000)]),1000)
            self.assertLess(max(abs(x) for x in audio[:int(.1*8000)]),100)
            self.assertLess(max(abs(x) for x in audio[int(2.8*8000):int(2.88*8000)]),100)
            bad={**manifest,'audios':[{'duration':duration-.2}],'frames':[{'frames':81}]}
            with self.assertRaisesRegex(ValueError,'未裁切或拉伸'):render(root,bad)
            with self.assertRaisesRegex(ValueError,'超时'):render(root,manifest,timeout_seconds=0)

    def test_cleanup_removes_expired_cancelled_and_orphaned_files_without_touching_active_jobs(self):
        import server
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);ids=['a'*32,'b'*32,'c'*32,'d'*32]
            for id in ids:(root/id).mkdir()
            (root/'unrelated').mkdir()
            jobs={ids[0]:{'state':'complete','expiresAt':0,'cancelled':False},ids[1]:{'state':'rendering','expiresAt':0,'cancelled':False},ids[2]:{'state':'error','expiresAt':time.time()+100,'cancelled':True}}
            with patch.object(server,'ROOT',root),patch.object(server,'JOBS',jobs):server.cleanup(orphaned=True)
            self.assertTrue((root/ids[1]).exists());self.assertTrue((root/'unrelated').exists())
            for i in [0,2,3]:self.assertFalse((root/ids[i]).exists())

    def test_failed_task_metadata_is_bounded_and_active_tasks_survive(self):
        import server
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            jobs={f'{i:032x}':{'state':'error','cancelled':False,'expiresAt':time.time()+1000,'finishedAt':i} for i in range(30)}
            active='f'*32;jobs[active]={'state':'rendering','expiresAt':0,'cancelled':False}
            with patch.object(server,'ROOT',root),patch.object(server,'JOBS',jobs):server.cleanup()
            self.assertEqual(len(jobs),11);self.assertIn(active,jobs)
            self.assertIn(f'{29:032x}',jobs);self.assertNotIn(f'{0:032x}',jobs)

    def test_cancelled_result_cannot_become_complete(self):
        import server
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);id='e'*32;(root/id).mkdir()
            job={'state':'queued','cancelled':False,'process':None,'manifest':{}}
            slot=threading.BoundedSemaphore(1);slot.acquire()
            def complete_after_cancel(*args,**kwargs):job['cancelled']=True;return {'duration':1}
            with patch.object(server,'ROOT',root),patch.object(server,'JOBS',{id:job}),patch.object(server,'SLOT',slot),patch.object(server,'render',complete_after_cancel):server.run(id)
            self.assertEqual(job['state'],'error');self.assertNotIn('result',job);self.assertFalse((root/id).exists());self.assertTrue(slot.acquire(False))

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
                with self.assertRaises(urllib.error.HTTPError) as malformed:request('/check','POST',b'null',{'Content-Type':'application/json','Authorization':'Bearer '+env['RENDERER_API_KEY']})
                self.assertEqual(malformed.exception.code,400)
                for origin,expected in [('https://other.test',403),('https://studio.test',200)]:
                    try:
                        checked=request('/check','POST',json.dumps({'origin':origin}).encode(),{'Content-Type':'application/json','Authorization':'Bearer '+env['RENDERER_API_KEY']})
                        self.assertEqual(checked.status,expected);checked.close()
                    except urllib.error.HTTPError as e:self.assertEqual(e.code,expected)
                response=request('/jobs','POST',json.dumps(manifest).encode(),{'Content-Type':'application/json','Authorization':'Bearer '+env['RENDERER_API_KEY']});job=json.load(response);prefix='/jobs/'+job['jobId'];auth={'Authorization':'Bearer '+job['token'],'Origin':'https://studio.test'}
                with self.assertRaises(urllib.error.HTTPError):request(prefix+'/../../secrets','PUT',b'bad',auth)
                request(prefix+'/frame-0.png','PUT',(root/'fixture.png').read_bytes(),auth).close();request(prefix+'/audio-0.mp3','PUT',(root/'fixture.mp3').read_bytes(),auth).close()
                # Replacing the same upload is allowed and must not accumulate size.
                request(prefix+'/frame-0.png','PUT',(root/'fixture.png').read_bytes(),auth).close()
                cors=request(prefix,'OPTIONS',headers={'Origin':'https://studio.test','Access-Control-Request-Method':'HEAD'})
                self.assertIn('HEAD',cors.headers['Access-Control-Allow-Methods']);cors.close()
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
                head=request(prefix+'/video?token='+job['token']+'&download=1','HEAD',headers={'Origin':'https://studio.test'})
                self.assertEqual(head.status,200);self.assertEqual(head.read(),b'');self.assertIn('attachment',head.headers['Content-Disposition']);self.assertIn('Content-Length',head.headers['Access-Control-Expose-Headers'])
                suffix=request(prefix+'/video?token='+job['token'],headers={'Range':'bytes=-100','Origin':'https://studio.test'});self.assertEqual(len(suffix.read()),100)
                with self.assertRaises(urllib.error.HTTPError) as invalid:request(prefix+'/video?token='+job['token'],headers={'Range':'bytes=999999999-'})
                self.assertEqual(invalid.exception.code,416);self.assertIn('bytes */',invalid.exception.headers['Content-Range'])
                self.assertEqual(response.status,206);self.assertEqual(len(response.read()),100);self.assertIn('ftyp',request(prefix+'/video?token='+job['token']).read(64).decode('latin1'))
            finally:
                process.terminate();process.wait(timeout=10)
                if process.stderr:process.stderr.close()

if __name__=='__main__':unittest.main()
