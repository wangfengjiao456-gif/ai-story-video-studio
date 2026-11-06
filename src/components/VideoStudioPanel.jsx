import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildVideoTimeline, frameAt, audioAt } from "../video/timeline.js";
import {
  audioDuration,
  renderVideo,
  cancelRender,
} from "../video/exportClient.js";
import { paintFrame, FONT_STACK } from "../presentation/frameRenderer.js";
import ServiceStatus from "./ServiceStatus.jsx";
export default function VideoStudioPanel({
  project,
  ai,
  onTimingChange,
  onStart,
  onFrame,
  hidden,
  pauseRef,
}) {
  const [source, setSource] = useState("article"),
    [prepared, setPrepared] = useState(null),
    [imported, setImported] = useState(null),
    [error, setError] = useState(""),
    [preparing, setPreparing] = useState(false),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [progress, setProgress] = useState(null),
    [result, setResult] = useState(null);
  const audio = useRef(null),
    canvas = useRef(null),
    cursor = useRef(0),
    controller = useRef(null),
    job = useRef(null),
    fileInput = useRef(null),
    importedUrl = useRef(null),
    exportImage = useRef(null),
    timelineRef = useRef(null),
    busyRef = useRef(false);
  const measure = useMemo(() => {
    if (typeof document === "undefined") return undefined;
    const ctx = document.createElement("canvas").getContext("2d");
    const cache = new Map();
    return (ch, size) => {
      const key = ch + size;
      if (!cache.has(key)) {
        ctx.font = `600 ${size}px ${FONT_STACK}`;
        cache.set(key, ctx.measureText(ch).width);
      }
      return cache.get(key);
    };
  }, []);
  let timeline = null,
    timingError = "";
  try {
    if (prepared)
      timeline = buildVideoTimeline(
        project,
        prepared.assets,
        prepared.speed,
        prepared.source,
        measure,
      );
  } catch (err) {
    timingError = err.message;
  }
  timelineRef.current = timeline;
  const frame = timeline ? frameAt(timeline, time) : null;
  const pause = () => {
    audio.current?.pause();
    setPlaying(false);
  };
  useEffect(() => {
    if (pauseRef) pauseRef.current = pause;
    return () => {
      if (pauseRef) pauseRef.current = null;
    };
  }, [pauseRef]);
  useEffect(() => {
    if (!timeline) pause();
  }, [timingError, !!timeline]);
  useEffect(
    () => () => {
      controller.current?.abort();
      if (busyRef.current) cancelRender(job.current);
      if (importedUrl.current) URL.revokeObjectURL(importedUrl.current);
    },
    [],
  );
  useEffect(() => {
    pause();
    setTime(0);
  }, [
    project.english,
    project.scenes.map((s) => s.english).join("\n"),
    source,
  ]);
  useEffect(() => {
    if (!frame || !canvas.current) return;
    let cancelled = false;
    const ctx = canvas.current.getContext("2d");
    async function draw() {
      try {
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(Error("分镜图片无法解码，请重新上传。"));
          image.src = frame.plan.scene.imageRef.dataUrl;
        });
        if (cancelled) return;
        paintFrame(ctx, frame.plan, frame.page, image);
        onFrame?.(frame.sceneIndex);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    draw();
    return () => {
      cancelled = true;
    };
  }, [
    frame?.start,
    frame?.end,
    frame?.plan.scene.imageRef,
    frame?.plan.scene.imageFit,
    frame?.plan.scene.imageScale,
    frame?.plan.scene.imagePosition?.x,
    frame?.plan.scene.imagePosition?.y,
    project.subtitles,
    JSON.stringify(project.subtitleStyle),
    project.subtitlePosition,
    project.videoTemplate,
  ]);
  async function prepare() {
    if (preparing) return;
    pause();
    setPreparing(true);
    setError("");
    setResult(null);
    try {
      const assets = { ...ai.assets };
      if (source === "imported") {
        if (!imported) throw Error("请先导入整篇 MP3。");
        assets.article = imported;
      }
      const mode = source === "scenes" ? "scenes" : "article",
        keys =
          mode === "article" ? ["article"] : project.scenes.map((s) => s.id);
      for (const key of keys) {
        if (!assets[key]) throw Error("尚无可用音频，请先生成或导入 MP3。");
        assets[key] = {
          ...assets[key],
          duration: await audioDuration(assets[key]),
        };
      }
      buildVideoTimeline(project, assets, ai.speed, mode, measure);
      setPrepared({ assets, speed: ai.speed, source: mode });
      setTime(0);
      cursor.current = 0;
    } catch (err) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  }
  async function importMp3(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (
        file.size > 50 * 1024 * 1024 ||
        !file.name.toLowerCase().endsWith(".mp3")
      )
        throw Error("请导入 50 MB 内的 MP3 文件。");
      const url = URL.createObjectURL(file);
      const asset = {
        blob: file,
        url,
        text: project.english.trim(),
        speed: ai.speed,
        duration: null,
      };
      try {
        asset.duration = await audioDuration(asset);
      } catch (err) {
        URL.revokeObjectURL(url);
        throw err;
      }
      if (importedUrl.current) URL.revokeObjectURL(importedUrl.current);
      importedUrl.current = url;
      setImported(asset);
      setSource("imported");
      setPrepared(null);
      setError(
        "已导入整篇 MP3；来源、语速和内容需人工确认，字幕将使用估算或手动时轴。",
      );
    } catch (err) {
      setError(err.message);
    }
  }
  function seek(value, play = false) {
    const t = timelineRef.current;
    if (!t) return;
    const target = audioAt(t, value);
    cursor.current = target.index;
    const element = audio.current,
      a = t.audios[target.index];
    const changed = element.getAttribute("src") !== a.url;
    if (changed) {
      element.src = a.url;
      element.load();
    }
    const position = () => {
      try {
        element.currentTime = target.offset;
      } catch {}
    };
    position();
    if (changed)
      element.addEventListener("loadedmetadata", position, { once: true });
    setTime(value);
    if (play) {
      onStart?.();
      element.play().catch(() => {
        setPlaying(false);
        setError("浏览器阻止播放，请点击继续。进度已保留。");
      });
    }
  }
  function timeUpdate() {
    const t = timelineRef.current;
    if (!t) return;
    const start = t.audios
      .slice(0, cursor.current)
      .reduce((n, a) => n + a.duration, 0);
    setTime(Math.min(t.duration, start + (audio.current?.currentTime || 0)));
  }
  function ended() {
    const t = timelineRef.current;
    if (!t) return;
    const next = cursor.current + 1;
    if (next < t.audios.length) {
      const start = t.audios.slice(0, next).reduce((n, a) => n + a.duration, 0);
      seek(start + 0.0001, true);
    } else {
      setTime(t.duration);
      setPlaying(false);
    }
  }
  async function exportMp4() {
    if (!timeline || busyRef.current) return;
    pause();
    onStart?.();
    busyRef.current = true;
    setError("");
    setProgress({ percent: 0, message: "正在创建渲染任务…" });
    setResult(null);
    const c = new AbortController();
    controller.current = c;
    const snapshot = timeline;
    const temp = document.createElement("canvas");
    temp.width = 1080;
    temp.height = 1920;
    const makeFrame = async (f) => {
      let image;
      if (exportImage.current?.src === f.plan.scene.imageRef.dataUrl)
        image = exportImage.current.image;
      else {
        image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(Error("导出图片无法解码。"));
          image.src = f.plan.scene.imageRef.dataUrl;
        });
        exportImage.current = { src: f.plan.scene.imageRef.dataUrl, image };
      }
      paintFrame(temp.getContext("2d"), f.plan, f.page, image);
      return new Promise((resolve, reject) =>
        temp.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(Error("字幕画面编码失败。")),
          "image/png",
        ),
      );
    };
    try {
      const output = await renderVideo(snapshot, makeFrame, {
        signal: c.signal,
        onProgress: setProgress,
        onJob: (value) => (job.current = value),
      });
      setResult(output);
      setProgress({
        percent: 100,
        message: "MP4 已完成并通过 H.264 / AAC 验证。",
      });
    } catch (err) {
      setError(
        err.name === "AbortError"
          ? "导出已取消，项目与音频未删除。"
          : err.message,
      );
      setProgress(null);
    } finally {
      busyRef.current = false;
      controller.current = null;
      exportImage.current = null;
    }
  }
  function timing(index, value) {
    if (!timeline) return;
    const boundaries = [
      ...timeline.ranges.map((r) => r.start),
      timeline.sourceDuration,
    ];
    boundaries[index] = Number(value);
    if (
      !Number.isFinite(boundaries[index]) ||
      boundaries[index] <= boundaries[index - 1] + 0.033 ||
      boundaries[index] >= boundaries[index + 1] - 0.033
    ) {
      setError("边界必须严格位于相邻分镜之间，至少相隔一帧。");
      return;
    }
    pause();
    onTimingChange({ signature: timeline.signature, boundaries });
  }
  return (
    <section
      hidden={hidden}
      className="video-studio"
      aria-label="完整视频预览与 MP4 导出"
    >
      <div className="intro">
        <div>
          <strong>完整视频预览 → MP4</strong>
          <p>
            固定 9:16 / 1080×1920，使用真实 MP3
            时长与同一字幕帧时轴。此步骤不调用付费 AI。
          </p>
        </div>
      </div>
      <ServiceStatus />
      <label className="field">
        <span>视频音频来源</span>
        <select
          value={source}
          disabled={!!progress && progress.percent < 100}
          onChange={(e) => {
            pause();
            setSource(e.target.value);
            setPrepared(null);
          }}
        >
          <option value="article">当前整篇 ElevenLabs MP3</option>
          <option value="scenes">全部逐分镜 MP3（连续）</option>
          <option value="imported">导入的整篇 MP3（估算/手动）</option>
        </select>
      </label>
      <div className="ai-actions">
        <button onClick={() => fileInput.current.click()}>导入已有 MP3</button>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept="audio/mpeg,.mp3"
          onChange={importMp3}
        />
        <button disabled={preparing || busyRef.current} onClick={prepare}>
          {preparing
            ? "读取真实时长…"
            : prepared
              ? "重新准备完整视频"
              : "准备完整视频"}
        </button>
      </div>
      <p className="muted">
        每镜必须已有图片和对应文字。生成新音频后请重新准备。预览和导出使用准备时音频快照，字幕样式和图片使用当前配置；导出开始后是固定快照。
      </p>
      {(error || timingError) && (
        <p className="validation-error" role="alert">
          {error || timingError}
        </p>
      )}
      <audio
        ref={audio}
        preload="metadata"
        onTimeUpdate={timeUpdate}
        onEnded={ended}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setError("音频无法播放，请重新准备或导入 MP3。")}
      />
      {timeline && (
        <>
          <div className="full-video-frame">
            <canvas
              ref={canvas}
              width="1080"
              height="1920"
              aria-label="完整视频字幕帧预览"
            />
          </div>
          <p className="sync-label">
            {timeline.precision === "aligned"
              ? "ElevenLabs API 字符对齐"
              : timeline.precision === "clips"
                ? "逐镜真实音频边界"
                : timeline.precision === "manual"
                  ? "手动微调时轴"
                  : "估算同步 · 按真实总时长和英文词数分配"}{" "}
            · 长字幕翻页按本镜时间比例估算 · 30fps 精度
          </p>
          {timeline.manualStale && (
            <p className="tip">
              已有手动时轴与当前音频或文字不符，已停用，请重新微调。
            </p>
          )}
          <div className="ai-actions">
            <button onClick={() => seek(0, true)}>从第 1 镜重播</button>
            <button
              onClick={() =>
                playing
                  ? pause()
                  : seek(time >= timeline.duration ? 0 : time, true)
              }
            >
              {playing ? "暂停" : "继续播放"}
            </button>
            <span>
              {time.toFixed(1)} / {timeline.duration.toFixed(1)} 秒
            </span>
          </div>
          <input
            aria-label="完整视频进度"
            className="video-seek"
            type="range"
            min="0"
            max={timeline.duration}
            step={1 / 30}
            value={time}
            onChange={(e) => seek(Number(e.target.value), playing)}
          />
          <details>
            <summary>手动微调字幕切镜时间（秒）</summary>
            <p className="muted">
              不修改音频，只调整画面/双语字幕切换；修改会保存到项目。原文或音频变化会停用旧时轴。
            </p>
            {timeline.ranges.slice(1).map((range, i) => (
              <label className="field" key={i}>
                <span>分镜 {i + 2} 开始</span>
                <input
                  type="number"
                  min={timeline.ranges[i].start + 0.034}
                  max={timeline.ranges[i + 1].end - 0.034}
                  step="0.033333"
                  defaultValue={range.start.toFixed(3)}
                  key={`${timeline.signature}-${range.start}`}
                  onBlur={(e) => timing(i + 1, e.target.value)}
                />
              </label>
            ))}
            <button
              onClick={() => {
                pause();
                onTimingChange(null);
              }}
            >
              恢复自动时轴
            </button>
          </details>
          <button
            className="primary"
            disabled={busyRef.current}
            onClick={exportMp4}
          >
            导出真实 MP4（H.264 + AAC）
          </button>
        </>
      )}
      {progress && (
        <div className="export-progress" role="status">
          <progress max="100" value={progress.percent} />
          <p>
            {progress.percent}% · {progress.message}
          </p>
          {progress.percent < 100 && (
            <button
              onClick={() => {
                controller.current?.abort();
                cancelRender(job.current);
              }}
            >
              取消导出
            </button>
          )}
        </div>
      )}
      {result && (
        <section className="note">
          <strong>已完成的 MP4 · 导出时项目快照</strong>
          <video
            className="completed-video"
            controls
            playsInline
            crossOrigin="anonymous"
            src={result.url}
          />
          <a
            href={result.download}
            target="_blank"
            rel="noreferrer"
            referrerPolicy="no-referrer"
          >
            下载标准 MP4
          </a>
          <p>
            服务端结果保留约 1 小时，请及时下载。iPad
            如打开播放页，可用分享菜单存储到文件。
          </p>
        </section>
      )}
      <details>
        <summary>离线编码回归证据（不是你的项目）</summary>
        <p>
          10 张程序插画 + 本地 Flite 英文语音，约 35.47 秒；非 ElevenLabs 或
          OpenAI 结果。字幕帧使用网站同一渲染器，FFmpeg 实际生成 H.264/AAC MP4。
        </p>
        <video
          className="completed-video"
          controls
          playsInline
          preload="none"
          src="/regression/daily-progress-regression.mp4"
        />
        <a href="/regression/daily-progress-regression.mp4" download>
          下载已编码的回归 MP4
        </a>
      </details>
      <p className="tip">
        MP4 需要独立 FFmpeg
        渲染服务；未配置时会明确报错，不会假装导出成功。图片/字幕帧与 MP3
        只发送至你的渲染服务，任务有大小与时长限制。没有任何自动配音或图片生成请求。
      </p>
    </section>
  );
}
