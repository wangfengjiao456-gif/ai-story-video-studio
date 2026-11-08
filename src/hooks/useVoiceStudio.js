import {
  writeMedia,
  readMedia,
  cachedVoiceRecord,
} from "../creation/mediaStore.js";
import { audioFingerprint } from "../video/audioIdentity.js";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_SPEED } from "../voiceConfig.js";
import {
  generateSpeech,
  isFresh,
  articleTimeline,
  indexAtTime,
} from "../services/aiVoice.js";
export default function useVoiceStudio(
  project,
  { onStart, onFrame, onSpeedChange, onAssetCreated },
) {
  const [speed, updateSpeed] = useState(project.aiSpeed ?? DEFAULT_SPEED),
    [assets, setAssets] = useState({}),
    [busy, setBusy] = useState(null),
    [error, setError] = useState(""),
    [storageWarning, setStorageWarning] = useState(""),
    [selected, setSelected] = useState(null),
    [playing, setPlaying] = useState(false);
  const audioRef = useRef(null),
    assetsRef = useRef({}),
    projectRef = useRef(project),
    callbacks = useRef({ onStart, onFrame, onSpeedChange, onAssetCreated }),
    request = useRef(null),
    sequence = useRef(null),
    selectedRef = useRef(null),
    speedRef = useRef(speed),
    raf = useRef(null),
    playEpoch = useRef(0),
    lifecycleEpoch = useRef(0);
  projectRef.current = project;
  callbacks.current = { onStart, onFrame, onSpeedChange, onAssetCreated };
  speedRef.current = speed;
  assetsRef.current = assets;
  selectedRef.current = selected;
  useEffect(() => {
    updateSpeed(project.aiSpeed ?? DEFAULT_SPEED);
  }, [project.aiSpeed]);
  function setSpeed(value) {
    updateSpeed(value);
    callbacks.current.onSpeedChange?.(value);
  }
  const textFor = (key, p = projectRef.current) =>
    key === "article"
      ? p.english
      : (p.scenes.find((s) => s.id === key)?.english ?? "");
  function pause() {
    playEpoch.current++;
    audioRef.current?.pause();
    setPlaying(false);
  }
  function release() {
    lifecycleEpoch.current++;
    setStorageWarning("");
    request.current?.abort();
    request.current = null;
    sequence.current = null;
    pause();
    for (const a of Object.values(assetsRef.current))
      URL.revokeObjectURL(a.url);
    assetsRef.current = {};
    selectedRef.current = null;
    setAssets({});
    setSelected(null);
    setBusy(null);
    setError("");
    if (audioRef.current) {
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
  }
  useEffect(
    () => () => {
      lifecycleEpoch.current++;
      request.current?.abort();
      cancelAnimationFrame(raf.current);
      for (const a of Object.values(assetsRef.current))
        URL.revokeObjectURL(a.url);
    },
    [],
  );
  // Editing, importing or reordering must not continue playing an obsolete subtitle timeline.
  const playbackSignature = JSON.stringify([
    project.english,
    project.scenes.map((s) => [s.id, s.english, s.chinese]),
    speed,
  ]);
  useEffect(() => {
    sequence.current = null;
    pause();
  }, [playbackSignature]);
  async function generate(key) {
    if (request.current) return;
    pause();
    sequence.current = null;
    setError("");
    setStorageWarning("");
    const text = textFor(key).trim(),
      requestedSpeed = speedRef.current,
      controller = new AbortController();
    request.current = controller;
    setBusy(key);
    try {
      const data = await generateSpeech(text, requestedSpeed, {
        signal: controller.signal,
      });
      const fingerprint = await audioFingerprint(data.blob);
      if (controller.signal.aborted || request.current !== controller) return;
      const asset = {
        ...data,
        fingerprint,
        url: URL.createObjectURL(data.blob),
        text,
        speed: requestedSpeed,
        duration: null,
      };
      let mediaSaved = true;
      try {
        await writeMedia(`voice:${fingerprint}`, cachedVoiceRecord(asset));
      } catch (error) {
        mediaSaved = false;
        setStorageWarning(error.message);
      }
      if (controller.signal.aborted || request.current !== controller) {
        URL.revokeObjectURL(asset.url);
        return;
      }
      const old = assetsRef.current[key];
      const next = { ...assetsRef.current, [key]: asset };
      assetsRef.current = next;
      setAssets(next);
      setSelected(key);
      selectedRef.current = key;
      if (old) URL.revokeObjectURL(old.url);
      callbacks.current.onAssetCreated?.({
        key:
          key === "article"
            ? "article"
            : `scene-${projectRef.current.scenes.findIndex((s) => s.id === key)}`,
        text: asset.text,
        speed: asset.speed,
        fingerprint: asset.fingerprint,
      });
      return { ...asset, mediaSaved };
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
      return {
        failed: true,
        error: err.message || "生成未完成，请检查后再手动继续。",
      };
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(null);
      }
    }
  }
  async function restoreCached() {
    const p = projectRef.current,
      speed = speedRef.current,
      epoch = lifecycleEpoch.current;
    let count = 0;
    for (const record of p.voiceRecords || []) {
      if (record.speed !== speed) continue;
      const key =
        record.text.trim() === p.english.trim()
          ? "article"
          : p.scenes.find((s) => s.english.trim() === record.text.trim())?.id;
      if (!key || isFresh(assetsRef.current[key], textFor(key), speed))
        continue;
      let value;
      try {
        value = await readMedia(`voice:${record.fingerprint}`);
      } catch (error) {
        setStorageWarning(error.message);
        continue;
      }
      if (epoch !== lifecycleEpoch.current) return count;
      if (
        !(value?.blob instanceof Blob) ||
        value.kind !== "voice" ||
        value.fingerprint !== record.fingerprint ||
        value.text !== record.text ||
        value.speed !== speed ||
        textFor(key).trim() !== record.text.trim() ||
        speedRef.current !== speed ||
        isFresh(assetsRef.current[key], textFor(key), speed)
      )
        continue;
      if ((await audioFingerprint(value.blob)) !== record.fingerprint) {
        setStorageWarning("本机配音备份校验失败，请重新导入原MP3。");
        continue;
      }
      if (
        epoch !== lifecycleEpoch.current ||
        textFor(key).trim() !== record.text.trim() ||
        speedRef.current !== speed
      )
        return count;
      const old = assetsRef.current[key];
      assetsRef.current = {
        ...assetsRef.current,
        [key]: {
          ...value,
          url: URL.createObjectURL(value.blob),
          duration: null,
        },
      };
      setAssets(assetsRef.current);
      if (old) URL.revokeObjectURL(old.url);
      count++;
    }
    return count;
  }
  function restoreArticle(asset) {
    if (
      !asset?.external ||
      !asset.blob ||
      !asset.fingerprint ||
      !isFresh(asset, projectRef.current.english, speedRef.current)
    )
      return;
    pause();
    const value = { ...asset, url: URL.createObjectURL(asset.blob) };
    const old = assetsRef.current.article;
    assetsRef.current = { ...assetsRef.current, article: value };
    setAssets(assetsRef.current);
    if (old) URL.revokeObjectURL(old.url);
  }
  function frame() {
    const key = selectedRef.current,
      a = assetsRef.current[key],
      audio = audioRef.current,
      p = projectRef.current;
    if (!audio || !a) return;
    if (key === "article") {
      const timeline = articleTimeline(a.text, p.scenes, a);
      if (timeline.ranges.length)
        callbacks.current.onFrame(
          indexAtTime(timeline.ranges, audio.currentTime),
        );
    } else {
      const i = p.scenes.findIndex((s) => s.id === key);
      if (i >= 0) callbacks.current.onFrame(i);
    }
  }
  async function start(key, restart = false, keepSequence = false) {
    const a = assetsRef.current[key];
    if (!isFresh(a, textFor(key), speedRef.current)) {
      setError("英文内容或语速已修改，请先重新生成对应音频。");
      return;
    }
    if (!keepSequence) sequence.current = null;
    const audio = audioRef.current;
    if (!audio) return;
    callbacks.current.onStart();
    setError("");
    const changed =
      selectedRef.current !== key || audio.getAttribute("src") !== a.url;
    selectedRef.current = key;
    setSelected(key);
    if (changed) {
      audio.src = a.url;
      audio.load();
    }
    if (changed || restart || audio.ended) audio.currentTime = 0;
    const epoch = ++playEpoch.current;
    try {
      await audio.play();
    } catch {
      if (
        epoch !== playEpoch.current ||
        selectedRef.current !== key ||
        audio.getAttribute("src") !== a.url
      )
        return;
      setPlaying(false);
      setError("无法播放音频，请再次点击播放，或下载 MP3 后试听。");
    }
  }
  function allScenes() {
    const keys = projectRef.current.scenes.map((s) => s.id);
    if (
      !keys.length ||
      !keys.every((k) =>
        isFresh(assetsRef.current[k], textFor(k), speedRef.current),
      )
    ) {
      setError("请先为每个分镜生成当前语速下的有效音频。");
      return;
    }
    sequence.current = { keys, cursor: 0 };
    start(keys[0], true, true);
  }
  function metadata() {
    const key = selectedRef.current,
      a = assetsRef.current[key],
      audio = audioRef.current;
    if (!a || !audio || audio.getAttribute("src") !== a.url) return;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      // Switching sources normally emits durationchange before metadata is ready.
      if (audio.readyState === 0) return;
      setError("无法读取真实音频时长，暂不能同步预览。可下载 MP3 检查。");
      return;
    }
    setError((previous) =>
      previous === "无法读取真实音频时长，暂不能同步预览。可下载 MP3 检查。"
        ? ""
        : previous,
    );
    const next = {
      ...assetsRef.current,
      [key]: { ...a, duration: audio.duration },
    };
    assetsRef.current = next;
    setAssets(next);
    frame();
  }
  function onPlay() {
    const key = selectedRef.current;
    if (!isFresh(assetsRef.current[key], textFor(key), speedRef.current)) {
      pause();
      setError("对应英文或语速已修改，请重新生成音频。");
      return;
    }
    callbacks.current.onStart();
    setPlaying(true);
    frame();
    cancelAnimationFrame(raf.current);
    const tick = () => {
      frame();
      if (audioRef.current && !audioRef.current.paused)
        raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }
  function ended() {
    setPlaying(false);
    cancelAnimationFrame(raf.current);
    const seq = sequence.current;
    if (seq && seq.cursor + 1 < seq.keys.length) {
      seq.cursor++;
      start(seq.keys[seq.cursor], true, true);
    } else sequence.current = null;
  }
  const current = assets[selected];
  const timeline =
    selected === "article" && current
      ? articleTimeline(current.text, project.scenes, current)
      : { mode: "scene", ranges: [] };
  return {
    speed,
    setSpeed,
    assets,
    busy,
    error,
    selected,
    playing,
    audioRef,
    generate,
    restoreArticle,
    restoreCached,
    storageWarning,
    pause,
    reset: release,
    start,
    allScenes,
    current,
    timeline,
    toggle: () =>
      playing
        ? pause()
        : selected && start(selected, false, !!sequence.current),
    restart: () =>
      sequence.current ? allScenes() : selected && start(selected, true),
    audioProps: {
      onLoadedMetadata: metadata,
      onDurationChange: metadata,
      onTimeUpdate: frame,
      onPlay,
      onPause: () => {
        setPlaying(false);
        cancelAnimationFrame(raf.current);
      },
      onEnded: ended,
      onError: () => {
        setPlaying(false);
        setError("音频加载失败，请重新生成或下载 MP3。");
      },
    },
  };
}
