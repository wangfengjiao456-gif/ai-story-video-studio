"""CPU render core. No external URLs, shell interpolation, AI calls, or third-party Python deps."""
import json, math, os, struct, subprocess, threading, time
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
        if not isinstance(a,dict) or a.get('encoding','mp3') not in ['mp3','wav']:raise ValueError('音频编码必须是 MP3 或 WAV。')
        if isinstance(d,bool) or not isinstance(d,(int,float)) or not math.isfinite(d) or d<=0 or d>MAX_DURATION: raise ValueError('真实音频时长无效。')
    if abs(sum(a['duration'] for a in audios)-total/FPS)>.1: raise ValueError('音频与视频总时长不一致。')
    return m

def probe(path, mp3=False, timeout=30):
    cmd=['ffprobe','-v','error','-protocol_whitelist','file,pipe']
    if mp3:cmd+=['-f','mp3','-select_streams','a:0','-show_frames','-show_entries','frame=nb_samples']
    cmd+=['-show_streams','-show_format','-of','json',str(path)]
    try:
        info=json.loads(subprocess.check_output(cmd,timeout=timeout,stderr=subprocess.DEVNULL))
        if mp3:
            stream=next(s for s in info['streams'] if s['codec_type']=='audio')
            duration=sum(f['nb_samples'] for f in info.pop('frames'))/int(stream['sample_rate'])
            if not math.isfinite(duration) or duration<=0:raise ValueError('empty audio')
            info['format']['duration']=str(duration)
        return info
    except subprocess.TimeoutExpired:raise ValueError('读取媒体超时，请检查文件或缩短项目。') from None
    except (subprocess.CalledProcessError,KeyError,TypeError,ValueError,StopIteration):raise ValueError('媒体无法解码，请重新上传标准 MP3 / PNG。') from None

def check_png(path):
    with open(path,'rb') as f:head=f.read(24)
    if len(head)!=24 or head[:8]!=b'\x89PNG\r\n\x1a\n' or struct.unpack('>II',head[16:24])!=(1080,1920):raise ValueError('字幕帧必须是 1080×1920 PNG。')

def progress_value(line,total):
    if not line.startswith('out_time_us='):return None
    try:value=float(line.split('=',1)[1].strip())
    except (ValueError,IndexError):return None
    if not math.isfinite(value) or value<0:return None
    return min(99,10+int(value/1e6/total*89))

def render(directory,manifest,progress=lambda n:None,cancelled=lambda:False,process_callback=lambda p:None,timeout_seconds=900):
    deadline=time.monotonic()+timeout_seconds
    def remaining():
        if cancelled():raise ValueError('导出已取消。')
        left=deadline-time.monotonic()
        if left<=0:raise ValueError('渲染超时，任务已停止，请缩短项目或增加服务资源后重试。')
        return left
    directory=Path(directory);validate_manifest(manifest)
    actual_durations=[];declared_elapsed=0;actual_elapsed=0
    for i in range(len(manifest['frames'])):check_png(directory/f'frame-{i}.png')
    for i,a in enumerate(manifest['audios']):
        encoding=a.get('encoding','mp3')
        info=probe(directory/f'audio-{i}.{encoding}',encoding=='mp3',timeout=min(30,remaining()))
        if not any(s.get('codec_type')=='audio' and s.get('codec_name')==('mp3' if encoding=='mp3' else 'pcm_s16le') for s in info['streams']):raise ValueError('音频不是有效MP3或16位PCM WAV。')
        actual=float(info['format']['duration']);actual_durations.append(actual)
        declared_elapsed+=a['duration'];actual_elapsed+=actual
        if abs(actual-a['duration'])>1/FPS or abs(actual_elapsed-declared_elapsed)>1/FPS:
            raise ValueError(f'音频 {i+1} 解码时长与网页时轴不一致，请重新导入 MP3 并校准时间轴；未裁切或拉伸配音。')
    total=sum(actual_durations) # decoded samples, excluding MP3 encoder padding
    # Paths are generated above, never accepted from the client. safe=0 enables
    # per-image framerate, avoiding concat's default 25fps timing quantization.
    lines=[]
    for i,f in enumerate(manifest['frames']):lines += [f"file 'frame-{i}.png'", "option framerate 30", f"duration {f['frames']/FPS:.9f}"]
    lines += [f"file 'frame-{len(manifest['frames'])-1}.png'", "option framerate 30"]
    (directory/'frames.txt').write_text('\n'.join(lines)+'\n')
    cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-threads','2','-protocol_whitelist','file,pipe','-f','concat','-safe','0','-c:v','png','-i',str(directory/'frames.txt')]
    for i,a in enumerate(manifest['audios']):
        encoding=a.get('encoding','mp3');cmd+=['-protocol_whitelist','file,pipe','-f',encoding,'-i',str(directory/f'audio-{i}.{encoding}')]
    parts=[f"[{i+1}:a]aresample=48000,asetpts=PTS-STARTPTS[a{i}]" for i,a in enumerate(manifest['audios'])]
    parts+=[''.join(f'[a{i}]' for i in range(len(manifest['audios'])))+f"concat=n={len(manifest['audios'])}:v=0:a=1[audio]"]
    cmd+=['-filter_complex_threads','1','-filter_complex',';'.join(parts),'-map','0:v:0','-map','[audio]','-vf','fps=fps=30:round=near','-r',str(FPS),'-c:v','libx264','-preset','veryfast','-crf','20','-profile:v','high','-level','4.0','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t',str(total),'-movflags','+faststart','-progress','pipe:1','-nostats',str(directory/'video.mp4')]
    with open(directory/'render-error.log','w') as errors:
        budget=remaining()
        process=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=errors,text=True);process_callback(process)
        timed_out=threading.Event()
        def expire():timed_out.set();process.kill()
        timer=threading.Timer(budget,expire);timer.start()
        try:
            for line in process.stdout:
                if cancelled():process.kill();raise ValueError('导出已取消。')
                value=progress_value(line,total)
                if value is not None:progress(value)
            code=process.wait()
            if cancelled():raise ValueError('导出已取消。')
            if timed_out.is_set():raise ValueError('渲染超时，任务已停止，请缩短项目或增加服务资源后重试。')
            if code!=0:raise ValueError('FFmpeg 编码失败，请检查图片/音频或服务内存。')
        finally:
            timer.cancel()
            if process.poll() is None:process.kill();process.wait(timeout=10)
            if process.stdout:process.stdout.close()
            process_callback(None)
    info=probe(directory/'video.mp4',timeout=min(30,remaining()));streams=info['streams'];v=next(s for s in streams if s['codec_type']=='video');a=next(s for s in streams if s['codec_type']=='audio')
    if v['codec_name']!='h264' or a['codec_name']!='aac' or v['width']!=1080 or v['height']!=1920 or v.get('avg_frame_rate')!='30/1' or v.get('pix_fmt')!='yuv420p' or a.get('sample_rate')!='48000' or a.get('channels')!=2:raise ValueError('输出编码验证失败。')
    if abs(float(info['format']['duration'])-total)>1/FPS+.005:raise ValueError('输出视频时长验证失败，未标记为成功。')
    progress(100);return {'duration':float(info['format']['duration']),'videoCodec':'h264','audioCodec':'aac','width':1080,'height':1920}

if __name__=='__main__':
    import sys
    directory=Path(sys.argv[1]);manifest=json.loads((directory/'manifest.json').read_text())
    print(json.dumps(render(directory,manifest),ensure_ascii=False))
