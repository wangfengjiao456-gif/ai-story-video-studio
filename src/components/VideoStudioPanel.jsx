import MusicSettings from "./MusicSettings.jsx";
import { mixKey, mixVideoAudio } from "../creation/audioMix.js";
import { parseTimingDraft } from "../video/timingDraft.js";
import { isFresh } from "../services/aiVoice.js";
import {
  audioFingerprint,
  assertPreparedAudio,
} from "../video/audioIdentity.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildVideoTimeline, frameAt, audioAt } from "../video/timeline.js";
import {
  audioDuration,
  renderVideo,
  cancelRender,
  jsonRequest,
  recoverVideoDownload,
  renderExpired,
} from "../video/exportClient.js";
import {
  paintFrame,
  FONT_STACK,
  createExportCanvas,
} from "../presentation/frameRenderer.js";
import { sceneCues, validateCues } from "../video/alignment.js";
import { timingSignature } from "../video/timeline.js";
import ServiceStatus from "./ServiceStatus.jsx";
export default function VideoStudioPanel({
  project,
  ai,
  onTimingChange,
  onProjectChange = () => {},
  autoPrepareRequest,
  onStart,
  onFrame,
  hidden,
  pauseRef,
  transportRef,
  onPlaybackChange,
  onPreviewFrame,
}) {
  const [rendererReady, setRendererReady] = useState(false),
    [checkingRenderer, setCheckingRenderer] = useState(false);
  const [musicAsset, setMusicAsset] = useState(null);
  const mixedUrls = useRef(new Set());
  useEffect(
    () => () => {
      for (const url of mixedUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );
  const [aligning, setAligning] = useState(false),
    [confirmAlign, setConfirmAlign] = useState(false),
    [draft, setDraft] = useState([]),
    [draftDirty, setDraftDirty] = useState(false);
  const alignmentBusy = useRef(false);
  const [source, setSource] = useState("article"),
    [prepared, setPrepared] = useState(null),
    [imported, setImported] = useState(null),
    [error, setError] = useState(""),
    [preparing, setPreparing] = useState(false),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [progress, setProgress] = useState(null),
    [result, setResult] = useState(null),
    [exportFailed, setExportFailed] = useState(false),
    [pendingDownload, setPendingDownload] = useState(null),
    [recoveringDownload, setRecoveringDownload] = useState(false),
    [clock, setClock] = useState(Date.now);
  const audio = useRef(null),
    inspector = useRef(null),
    startingInspector = useRef(false),
    canvas = useRef(null),
    cursor = useRef(0),
    controller = useRef(null),
    job = useRef(null),
    fileInput = useRef(null),
    importedUrl = useRef(null),
    exportImage = useRef(null),
    timelineRef = useRef(null),
    busyRef = useRef(false),
    alignmentContext = useRef(null),
    importEpoch = useRef(0),
    importController = useRef(null),
    inputContext = useRef(null),
    pendingSeek = useRef(null),
    confirmedDraft = useRef([]),
    playEpoch = useRef(0),
    prepareEpoch = useRef(0),
    prepareController = useRef(null),
    recoveryLock = useRef(false),
    recoveryController = useRef(null);
  inputContext.current = JSON.stringify([
    project.english,
    project.scenes.map((s) => s.english),
    ai.speed,
  ]);
  alignmentContext.current = JSON.stringify([
    imported?.fingerprint,
    project.scenes.map((s) => s.english),
    project.english,
    ai.speed,
  ]);
  const currentAssets = useRef(ai.assets);
  currentAssets.current = ai.assets;
  const preparationContext = useRef(null);
  const preparationKey = JSON.stringify([
    source,
    project.cover?.enabled,
    project.cover?.duration,
    JSON.stringify(project.music),
    musicAsset?.id,
    inputContext.current,
    imported?.fingerprint,
    project.scenes.map((s) => s.id),
  ]);
  if (preparationContext.current !== preparationKey) {
    preparationContext.current = preparationKey;
    prepareEpoch.current++;
  }
  useEffect(() => () => prepareController.current?.abort(), [preparationKey]);
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
  const { timeline, timingError } = useMemo(() => {
    try {
      assertPreparedAudio(prepared, ai.assets, ai.speed, source === "imported");
      const result = prepared
        ? buildVideoTimeline(
            project,
            prepared.assets,
            prepared.speed,
            prepared.source,
            measure,
            prepared.mixed,
          )
        : null;
      if (
        result &&
        (result.requiresMix ||
          (prepared.mixed &&
            prepared.mixKey !==
              mixKey(project, result.originalAudios, musicAsset)))
      )
        throw Error(
          "封面时长、音乐或校准时间已变化，请点击“准备完整视频”重新进行本地混音，不会调用付费API。",
        );
      return { timeline: result, timingError: "" };
    } catch (err) {
      return { timeline: null, timingError: err.message };
    }
  }, [project, prepared, measure, ai.assets, ai.speed, source, musicAsset]);
  const loadImage = useMemo(() => {
    const cache = new Map();
    return (src) => {
      if (!cache.has(src)) {
        const promise = new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => {
            cache.delete(src);
            reject(Error("分镜图片无法解码，请重新上传。"));
          };
          image.src = src;
        });
        cache.set(src, promise);
        if (cache.size > 3) cache.delete(cache.keys().next().value);
      }
      return cache.get(src);
    };
  }, []);
  timelineRef.current = timeline;
  const frame = timeline ? frameAt(timeline, time) : null;
  const pause = () => {
    playEpoch.current++;
    audio.current?.pause();
    if (!startingInspector.current) inspector.current?.pause();
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
      audio.current?.pause();
      inspector.current?.pause();
      controller.current?.abort();
      recoveryController.current?.abort();
      alignmentContext.current = null;
      importEpoch.current++;
      prepareEpoch.current++;
      prepareController.current?.abort();
      importController.current?.abort();
      if (pendingSeek.current)
        audio.current?.removeEventListener(
          "loadedmetadata",
          pendingSeek.current,
        );
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
    ai.speed,
  ]);
  useEffect(() => {
    if (!frame || !canvas.current) return;
    let cancelled = false;
    const ctx = canvas.current.getContext("2d");
    ctx.clearRect(0, 0, 1080, 1920);
    onFrame?.(frame.sceneIndex);
    async function draw() {
      try {
        const image = await loadImage(frame.plan.scene.imageRef.dataUrl);
        const next = project.scenes[frame.sceneIndex + 1]?.imageRef?.dataUrl;
        if (next) loadImage(next).catch(() => {});
        if (cancelled) return;
        paintFrame(ctx, frame.plan, frame.page, image);
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
    frame?.plan.scene.english,
    frame?.plan.scene.chinese,
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
  useEffect(() => {
    if (!playing) return;
    let id;
    const tick = () => {
      timeUpdate();
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing]);
  useEffect(() => {
    onPreviewFrame?.(frame);
  }, [frame, onPreviewFrame]);
  useEffect(() => {
    onPlaybackChange?.({
      ready: !!timeline,
      playing,
      rendering: !!progress && progress.percent < 100,
      pendingDownload: !!pendingDownload,
      timingDraftDirty: draftDirty,
    });
  }, [
    !!timeline,
    playing,
    !!progress && progress.percent < 100,
    onPlaybackChange,
    !!pendingDownload,
    draftDirty,
  ]);
  useEffect(() => {
    if (!transportRef) return;
    transportRef.current = {
      seekScene(index) {
        const range = timelineRef.current?.ranges[index];
        if (range) {
          pause();
          seek(range.start + (timelineRef.current?.coverDuration || 0), false);
        }
      },
      toggle() {
        if (playing) pause();
        else if (timelineRef.current)
          seek(time >= timelineRef.current.duration ? 0 : time, true);
      },
    };
    return () => {
      transportRef.current = null;
    };
  });
  useEffect(() => {
    const suspend = () => {
      timeUpdate();
      pause();
    };
    const visibility = () => {
      setClock(Date.now());
      if (document.visibilityState === "hidden") suspend();
      else timeUpdate();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", timeUpdate);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", timeUpdate);
    };
  }, []);
  useEffect(() => {
    if (hidden) pause();
  }, [hidden]);
  function resetPlaybackClock() {
    if (pendingSeek.current)
      audio.current?.removeEventListener("loadedmetadata", pendingSeek.current);
    pendingSeek.current = null;
    try {
      if (audio.current) audio.current.currentTime = 0;
    } catch {}
    cursor.current = 0;
    setTime(0);
  }
  function resetTimingDraft(cues) {
    confirmedDraft.current = cues.map((c) => ({ ...c }));
    setDraft(confirmedDraft.current);
    setDraftDirty(false);
  }
  function saveCues(cues, source = "manual") {
    if (!isFresh(imported, project.english, ai.speed))
      throw Error(
        "英文或语速已变化，请重新导入当前 MP3 后再校准；原时间轴未覆盖。",
      );
    if (
      !imported ||
      !validateCues(cues, project.scenes.length, imported.duration)
    )
      throw Error(
        "请填写全部分镜的开始和结束时间：不能重叠、倒序或超过 MP3 总时长，每镜至少一帧。",
      );
    const assets = { article: imported };
    const signature = timingSignature(project, assets, ai.speed, "article");
    pause();
    onTimingChange({ signature, cues, source });
    resetTimingDraft(cues);
    setPrepared({ assets, speed: ai.speed, source: "article" });
    resetPlaybackClock();
    setError("");
  }
  async function alignImported() {
    if (alignmentBusy.current || !imported) return;
    alignmentBusy.current = true;
    setAligning(true);
    setConfirmAlign(false);
    setError("");
    const original = imported;
    const context = alignmentContext.current;
    const transcript = project.scenes.map((s) => s.english).join("\n");
    try {
      if (original.blob.size > 3000000)
        throw Error(
          "当前 Vercel 对齐上传上限为 3 MB。请压缩为 128kbps MP3 后重试，或手动填写时间轴；原 MP3 可保留用于导出。",
        );
      const encoded = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(Error("MP3 读取失败。"));
        r.onload = () => resolve(r.result.split(",")[1]);
        r.readAsDataURL(original.blob);
      });
      const response = await fetch("/api/align-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: encoded,
          text: transcript,
          confirmed: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error?.message || "音频对齐失败。");
      if (context !== alignmentContext.current)
        throw Error(
          "对齐期间英文或音频已变化，结果未覆盖当前项目，请重新对齐。",
        );
      const cues = sceneCues(project.scenes, data.words, original.duration);
      saveCues(cues, "forced");
      setDraft(cues);
    } catch (err) {
      setError(err.message || "音频对齐网络请求失败。");
    } finally {
      alignmentBusy.current = false;
      setAligning(false);
    }
  }
  const handledAutoPrepare = useRef(null);
  useEffect(() => {
    if (
      !autoPrepareRequest ||
      handledAutoPrepare.current === autoPrepareRequest.id
    )
      return;
    if (source !== autoPrepareRequest.source) {
      setSource(autoPrepareRequest.source);
      return;
    }
    handledAutoPrepare.current = autoPrepareRequest.id;
    prepare();
  }, [autoPrepareRequest, source]);
  async function prepare() {
    if (preparing || prepareController.current || draftDirty) return;
    const request = new AbortController();
    prepareController.current = request;
    pause();
    const epoch = ++prepareEpoch.current;
    setPreparing(true);
    setError("");
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
          duration: await audioDuration(assets[key], {
            signal: request.signal,
          }),
        };
      }
      if (epoch !== prepareEpoch.current) return;
      if (
        source !== "imported" &&
        keys.some((key) => assets[key].url !== currentAssets.current[key]?.url)
      )
        throw Error("读取期间配音已替换，请重新准备视频。");
      const preparedTimeline = buildVideoTimeline(
        project,
        assets,
        ai.speed,
        mode,
        measure,
      );
      resetTimingDraft(
        preparedTimeline.ranges.map((r) => ({
          start: r.start,
          end: Math.min(r.end, preparedTimeline.narrationDuration),
        })),
      );
      let mixed;
      if (preparedTimeline.requiresMix) {
        mixed = await mixVideoAudio(project, preparedTimeline, musicAsset, {
          signal: request.signal,
        });
        if (epoch !== prepareEpoch.current) {
          URL.revokeObjectURL(mixed.url);
          return;
        }
        mixedUrls.current.add(mixed.url);
      }
      if (prepared?.mixed) {
        URL.revokeObjectURL(prepared.mixed.url);
        mixedUrls.current.delete(prepared.mixed.url);
      }
      setPrepared({
        assets,
        speed: ai.speed,
        source: mode,
        mixed,
        mixKey: mixKey(project, preparedTimeline.originalAudios, musicAsset),
      });
      resetPlaybackClock();
    } catch (err) {
      if (epoch === prepareEpoch.current && err.name !== "AbortError")
        setError(err.message);
    } finally {
      if (prepareController.current === request)
        prepareController.current = null;
      setPreparing(false);
    }
  }
  async function importMp3(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    pause();
    prepareEpoch.current++;
    prepareController.current?.abort();
    const epoch = ++importEpoch.current,
      context = inputContext.current;
    importController.current?.abort();
    const importRequest = new AbortController();
    importController.current = importRequest;
    let url;
    try {
      if (
        file.size > 50 * 1024 * 1024 ||
        !file.name.toLowerCase().endsWith(".mp3")
      )
        throw Error("请导入 50 MB 内的 MP3 文件。");
      const fingerprint = await audioFingerprint(file);
      if (epoch !== importEpoch.current) return;
      url = URL.createObjectURL(file);
      const asset = {
        blob: file,
        url,
        text: project.english.trim(),
        speed: ai.speed,
        duration: null,
        external: true,
        fingerprint,
      };
      try {
        asset.duration = await audioDuration(asset, {
          signal: importRequest.signal,
        });
        if (asset.duration > 600)
          throw Error("当前 MP4 流程最多支持 10 分钟 MP3。");
      } catch (err) {
        URL.revokeObjectURL(url);
        throw err;
      }
      if (epoch !== importEpoch.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (context !== inputContext.current) {
        URL.revokeObjectURL(url);
        setError("读取期间英文或语速已变化，MP3 未替换，请重新导入。");
        return;
      }
      audio.current?.removeAttribute("src");
      audio.current?.load();
      setTime(0);
      if (importedUrl.current) URL.revokeObjectURL(importedUrl.current);
      importedUrl.current = url;
      setImported(asset);
      ai.restoreArticle?.(asset);
      const signature = timingSignature(
        project,
        { article: asset },
        ai.speed,
        "article",
      );
      resetTimingDraft(
        project.videoTiming?.signature === signature && project.videoTiming.cues
          ? project.videoTiming.cues
          : project.scenes.map(() => ({ start: "", end: "" })),
      );
      setSource("imported");
      setPrepared(null);
      setError(
        "已导入 MP3。请先逐句音频对齐，或填写全部分镜起止时间；不会自动猜测切换时间。",
      );
    } catch (err) {
      if (url && url !== importedUrl.current) URL.revokeObjectURL(url);
      if (epoch === importEpoch.current && err.name !== "AbortError")
        setError(err.message);
    } finally {
      if (importController.current === importRequest)
        importController.current = null;
    }
  }
  function seek(value, play = false) {
    const t = timelineRef.current;
    if (!t) return;
    const target = audioAt(t, value);
    cursor.current = target.index;
    const element = audio.current,
      a = t.audios[target.index];
    if (!element) return;
    if (pendingSeek.current)
      element.removeEventListener("loadedmetadata", pendingSeek.current);
    pendingSeek.current = null;
    const changed = element.getAttribute("src") !== a.url;
    if (changed) {
      element.src = a.url;
      element.load();
    }
    const position = () => {
      if (element.getAttribute("src") !== a.url) return;
      try {
        element.currentTime = target.offset;
      } catch {}
    };
    position();
    if (changed || element.readyState < 1) {
      pendingSeek.current = position;
      element.addEventListener("loadedmetadata", position, { once: true });
    }
    setTime(value);
    if (play) {
      onStart?.();
      const epoch = ++playEpoch.current;
      element.play().catch(() => {
        if (
          epoch !== playEpoch.current ||
          element.getAttribute("src") !== a.url
        )
          return;
        setPlaying(false);
        setError("浏览器阻止播放，请点击继续。进度已保留。");
      });
    }
  }
  function timeUpdate() {
    const t = timelineRef.current;
    if (
      !t ||
      audio.current?.getAttribute("src") !== t.audios[cursor.current]?.url
    )
      return;
    const start = t.audios
      .slice(0, cursor.current)
      .reduce((n, a) => n + a.duration, 0);
    setTime(Math.min(t.duration, start + (audio.current?.currentTime || 0)));
  }
  function ended() {
    const t = timelineRef.current;
    if (
      !t ||
      audio.current?.getAttribute("src") !== t.audios[cursor.current]?.url
    )
      return;
    const next = cursor.current + 1;
    if (next < t.audios.length) {
      const start = t.audios.slice(0, next).reduce((n, a) => n + a.duration, 0);
      seek(start + 0.0001, true);
    } else {
      setTime(t.duration);
      setPlaying(false);
    }
  }
  async function checkRenderer() {
    setCheckingRenderer(true);
    setError("");
    setRendererReady(false);
    try {
      const status = await jsonRequest("/api/renderer-status", {
        method: "POST",
      });
      if (
        (project.cover?.enabled || project.music?.enabled) &&
        status.capabilities?.pcmWav !== true
      )
        throw Error(
          "当前Render版本不支持V4封面/音乐混音，请先部署feat/story-studio-v4的renderer代码。",
        );
      setRendererReady(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setCheckingRenderer(false);
    }
  }
  useEffect(() => {
    if (!result && !pendingDownload) return;
    const tick = () => setClock(Date.now());
    const timer = setInterval(tick, 30000);
    window.addEventListener("pageshow", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pageshow", tick);
    };
  }, [result, pendingDownload]);
  async function restoreDownload() {
    if (!pendingDownload || recoveryLock.current || busyRef.current) return;
    recoveryLock.current = true;
    setRecoveringDownload(true);
    setError("");
    const request = new AbortController();
    recoveryController.current = request;
    try {
      const verified = await recoverVideoDownload(pendingDownload, {
        signal: request.signal,
      });
      setResult(verified);
      setPendingDownload(null);
      setExportFailed(false);
      setProgress({
        percent: 100,
        message: "已恢复下载检查，实际 MP4 可下载；没有重新渲染。",
      });
    } catch (e) {
      if (e.terminalDownload) {
        setPendingDownload(null);
        setExportFailed(true);
      }
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      recoveryLock.current = false;
      setRecoveringDownload(false);
      recoveryController.current = null;
    }
  }
  async function exportMp4() {
    if (!timeline || busyRef.current || recoveryLock.current) return;
    if (draftDirty) {
      setError("有未应用的起止时间，请先应用或放弃修改，再导出。");
      return;
    }
    if (timeline.precision === "estimated") {
      setError(
        "整篇配音尚无可验证时间戳，不能按估算时间导出。请确认全部起止时间，或下载 MP3 后导入并执行逐句对齐，也可使用逐镜 MP3。",
      );
      return;
    }
    if (
      project.assistant?.adopted &&
      !window.confirm(
        "将提交1个Render视频渲染任务。计算费用取决于你的Render服务方案；本次不会调用OpenAI或ElevenLabs。是否确认导出？",
      )
    ) return;
    pause();
    onStart?.();
    busyRef.current = true;
    setExportFailed(false);
    setError("");
    setProgress({ percent: 0, message: "正在创建渲染任务…" });
    const c = new AbortController();
    controller.current = c;
    job.current = null;
    const snapshot = timeline;
    const temp = createExportCanvas();
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
      const ctx = temp.getContext("2d");
      if (!ctx)
        throw Error(
          "画布内存不足或浏览器无法编码，请先备份项目，减小插画尺寸后重试。",
        );
      paintFrame(ctx, f.plan, f.page, image);
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
      setPendingDownload(null);
      setProgress({
        percent: 100,
        message: "MP4 已完成并通过 H.264 / AAC 验证。",
      });
    } catch (err) {
      if (err.recoverableVideo) setPendingDownload(err.recoverableVideo);
      setError(
        err.name === "AbortError"
          ? "导出已取消，项目与音频未删除。"
          : err.message,
      );
      setProgress(null);
      setExportFailed(err.name !== "AbortError");
    } finally {
      busyRef.current = false;
      controller.current = null;
      exportImage.current = null;
      temp.remove();
    }
  }
  function editTiming(index, field, value) {
    pause();
    setDraftDirty(true);
    setError("");
    setDraft((previous) =>
      project.scenes.map((_, i) =>
        i === index
          ? { ...previous[i], [field]: value }
          : previous[i] || { start: "", end: "" },
      ),
    );
  }
  function applyTimingDraft() {
    try {
      const cues = parseTimingDraft(
        draft,
        project.scenes.length,
        source === "imported" ? imported.duration : timeline.narrationDuration,
      );
      if (source === "imported") saveCues(cues);
      else {
        pause();
        onTimingChange({
          signature: timeline.signature,
          cues,
          source: "manual",
        });
        resetTimingDraft(cues);
        setError("");
      }
    } catch (error) {
      setError(error.message);
    }
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
      {(source === "imported" ? imported : ai.assets.article)?.url &&
        source !== "scenes" && (
          <a
            href={(source === "imported" ? imported : ai.assets.article).url}
            download="story-narration.mp3"
          >
            下载原始旁白 MP3 备份（不含音乐与封面）
          </a>
        )}
      <MusicSettings
        settings={project.music}
        asset={musicAsset}
        onUpload={(asset) => {
          pause();
          setMusicAsset(asset);
        }}
        onChange={(music) => {
          pause();
          onProjectChange({ music });
        }}
      />
      <p>
        <a
          href="https://github.com/wangfengjiao456-gif/ai-story-video-studio/blob/feat/story-studio-v4/V4_GUIDE.md"
          target="_blank"
          rel="noreferrer"
        >
          V4 iPad 操作与首次配置指南
        </a>
      </p>
      <div className="note">
        <p>
          MP4 服务：
          {rendererReady ? "已验证连接、密钥和当前来源" : "尚未验证，请先检查"}
        </p>
        <button disabled={checkingRenderer} onClick={checkRenderer}>
          {checkingRenderer ? "检查中…" : "检查 MP4 服务连接（不调用 AI）"}
        </button>
        <p>
          首次使用需部署仓库 render.yaml 中的 Docker 服务；具体配置见
          DEPLOYMENT.md。仅在检查成功后开放导出。
        </p>
      </div>
      <label className="field">
        <span>视频音频来源</span>
        <select
          value={source}
          disabled={aligning || (!!progress && progress.percent < 100)}
          onChange={(e) => {
            pause();
            setSource(e.target.value);
            resetTimingDraft([]);
            setPrepared(null);
          }}
        >
          <option value="article">当前整篇 ElevenLabs MP3</option>
          <option value="scenes">全部逐分镜 MP3（连续）</option>
          <option value="imported">导入的整篇 MP3（真实对齐/手动）</option>
        </select>
      </label>
      <div className="ai-actions">
        <button disabled={aligning} onClick={() => fileInput.current.click()}>
          导入已有 MP3
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept="audio/mpeg,.mp3"
          onChange={importMp3}
        />
        <button
          disabled={preparing || busyRef.current || draftDirty}
          onClick={prepare}
        >
          {preparing
            ? "读取真实时长…"
            : prepared
              ? "重新准备完整视频"
              : "准备完整视频"}
        </button>
      </div>
      {source === "imported" && imported && (
        <section className="note">
          <p>
            MP3 真实时长：{imported.duration.toFixed(3)}{" "}
            秒。对齐不生成或修改音频。
          </p>
          <button disabled={aligning} onClick={() => setConfirmAlign(true)}>
            {aligning
              ? "正在对齐，请勿重复提交…"
              : "逐句音频对齐（ElevenLabs）"}
          </button>
          {confirmAlign && (
            <div role="alertdialog" aria-label="确认音频对齐费用">
              <p>
                将此 MP3 和全部英文分镜发送至 ElevenLabs Forced
                Alignment，可能消耗账户额度。仅执行本次对齐，不重新配音。是否继续？
              </p>
              <button disabled={aligning} onClick={alignImported}>
                确认并对齐一次
              </button>
              <button onClick={() => setConfirmAlign(false)}>取消</button>
            </div>
          )}
          <details>
            <summary>手动填写 / 校对每镜开始与结束时间</summary>
            <audio
              ref={inspector}
              aria-label="手动校准试听（仅音频）"
              controls
              playsInline
              src={imported.url}
              preload="metadata"
              onPlay={() => {
                startingInspector.current = true;
                try {
                  onStart?.();
                  audio.current?.pause();
                  setPlaying(false);
                } finally {
                  startingInspector.current = false;
                }
              }}
            />
            {project.scenes.map((scene, i) => (
              <div className="field" key={scene.id}>
                <span>
                  分镜 {i + 1} · {scene.english}
                </span>
                {["start", "end"].map((k) => (
                  <label key={k}>
                    {k === "start" ? "开始（秒）" : "结束（秒）"}
                    <input
                      disabled={aligning}
                      type="number"
                      min="0"
                      max={imported.duration}
                      step="0.01"
                      value={draft[i]?.[k] ?? ""}
                      onChange={(e) => editTiming(i, k, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            ))}
            <button disabled={aligning} onClick={applyTimingDraft}>
              确认并保存全部起止时间
            </button>
          </details>
        </section>
      )}
      <p className="muted">
        每镜必须已有图片和对应文字。生成新音频后请重新准备。预览和导出使用准备时音频快照，字幕样式和图片使用当前配置；导出开始后是固定快照。
      </p>
      <p className="muted">
        项目 JSON 包含文章、分镜、封面、图片、音乐设置和时间轴，不包含
        MP3。成功生成的配音可尝试从同网址本机媒体备份免费恢复，仍请另行保留 MP3
        原文件；刷新后重新导入同一文件可恢复对齐。浏览器本地存档最多 5
        MB；较大项目可导出最多 50 MB 的 JSON
        文件并重新导入。保存失败不会覆盖旧存档，刷新前请先完成文件备份。
      </p>
      {draftDirty && (
        <section className="note" role="status">
          <p>
            有未应用的起止时间。预览仍使用上次确认的时轴，导出已暂停；请应用或放弃修改。
          </p>
          <button
            onClick={() => {
              setDraft(confirmedDraft.current);
              setDraftDirty(false);
              setError("");
            }}
          >
            放弃时间修改
          </button>
        </section>
      )}
      {(error || timingError) && (
        <p className="validation-error" role="alert">
          {error || timingError}
        </p>
      )}
      <audio
        ref={audio}
        preload="metadata"
        onTimeUpdate={timeUpdate}
        onSeeked={timeUpdate}
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
            {timeline.precision === "forced"
              ? "ElevenLabs 逐词强制对齐（请试听校对）"
              : timeline.precision === "aligned"
                ? "ElevenLabs API 字符对齐"
                : timeline.precision === "clips"
                  ? "逐镜真实音频边界"
                  : timeline.precision === "manual"
                    ? "手动微调时轴"
                    : "估算同步 · 按真实总时长和英文词数分配"}{" "}
            · 长字幕翻页按本镜时间比例估算 · 30fps 精度
          </p>
          {timeline.frames.some(
            (f) => !f.plan.scene.english && !f.plan.scene.chinese,
          ) && (
            <p className="muted">
              时轴包含无字幕区间，期间保留图片。请试听确认这些区间确实无需字幕；可调整每镜起止时间。
            </p>
          )}
          {timeline.precision === "estimated" && (
            <p className="validation-error">
              当前仅为估算预览。导出前请在下方逐句校准，并点击「确认当前全部起止时间」；或导入
              MP3 执行强制对齐。不会自动消耗 API 额度。
            </p>
          )}
          {timeline.manualStale && (
            <p className="tip">
              已有手动时轴与当前音频或文字不符，已停用，请重新微调。
            </p>
          )}
          <div className="ai-actions">
            <button onClick={() => seek(0, true)}>
              {timeline.coverDuration ? "从封面00重播" : "从第 1 镜重播"}
            </button>
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
            {timeline.ranges.map((range, i) => (
              <div className="field" key={i}>
                <span>分镜 {i + 1}</span>
                {["start", "end"].map((field) => (
                  <label key={field}>
                    {field === "start" ? "开始（秒）" : "结束（秒）"}
                    <input
                      disabled={aligning}
                      type="number"
                      min="0"
                      max={timeline.narrationDuration}
                      step="0.01"
                      value={draft[i]?.[field] ?? range[field]}
                      onChange={(e) => editTiming(i, field, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            ))}
            <button
              disabled={aligning || busyRef.current || !draftDirty}
              onClick={applyTimingDraft}
            >
              应用起止时间
            </button>
            {timeline.precision === "estimated" && (
              <button onClick={applyTimingDraft}>
                确认当前全部起止时间（请先试听校准）
              </button>
            )}
            <button
              onClick={() => {
                if (
                  source === "imported" &&
                  !window.confirm(
                    "清除当前已确认的时轴？之后需要重新对齐或手动校准，MP3 保留。",
                  )
                )
                  return;
                pause();
                onTimingChange(null);
                resetTimingDraft([]);
                setPrepared(null);
              }}
            >
              {source === "imported" ? "清除时轴并重新校准" : "恢复自动时轴"}
            </button>
          </details>
          <button
            className="primary"
            disabled={
              busyRef.current ||
              recoveringDownload ||
              !rendererReady ||
              draftDirty
            }
            onClick={exportMp4}
          >
            {exportFailed && !busyRef.current
              ? "重试导出 MP4（H.264 + AAC）"
              : "导出真实 MP4（H.264 + AAC）"}
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
      {pendingDownload && (
        <section className="note" role="status">
          <p>
            视频已编码，但下载检查未完成。已完成文件没有删除，可仅恢复下载检查，不重新上传或渲染。请先恢复检查并下载；刷新或关闭页面会丢失本次任务入口。
          </p>
          <button
            disabled={
              recoveringDownload ||
              busyRef.current ||
              renderExpired(pendingDownload, clock)
            }
            onClick={restoreDownload}
          >
            {recoveringDownload ? "检查下载中…" : "恢复下载检查（不重新渲染）"}
          </button>
          {renderExpired(pendingDownload, clock) && (
            <p>此任务已过期，请重新导出。</p>
          )}
        </section>
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
          {renderExpired(result, clock) ? (
            <p className="validation-error">
              此视频下载已过期，请重新导出。项目与原音频未删除。
            </p>
          ) : (
            <a
              href={result.download}
              target="_blank"
              rel="noreferrer"
              referrerPolicy="no-referrer"
            >
              下载标准 MP4
            </a>
          )}
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
