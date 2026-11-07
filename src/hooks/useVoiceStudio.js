import { audioFingerprint } from "../video/audioIdentity.js";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_SPEED } from "../voiceConfig.js";
import {
  generateSpeech,
  isFresh,
  articleTimeline,
  indexAtTime,
} from "../services/aiVoice.js";
export default function useVoiceStudio(project, { onStart, onFrame }) {
  const [speed, setSpeed] = useState(DEFAULT_SPEED),
    [assets, setAssets] = useState({}),
    [busy, setBusy] = useState(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [playing, setPlaying] = useState(false);
  const audioRef = useRef(null),
    assetsRef = useRef({}),
    projectRef = useRef(project),
    callbacks = useRef({ onStart, onFrame }),
    request = useRef(null),
    sequence = useRef(null),
    selectedRef = useRef(null),
    speedRef = useRef(speed),
    raf = useRef(null);
  projectRef.current = project;
  callbacks.current = { onStart, onFrame };
  speedRef.current = speed;
  assetsRef.current = assets;
  selectedRef.current = selected;
  const textFor = (key, p = projectRef.current) =>
    key === "article"
      ? p.english
      : (p.scenes.find((s) => s.id === key)?.english ?? "");
  function pause() {
    audioRef.current?.pause();
    setPlaying(false);
  }
  function release() {
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
      const old = assetsRef.current[key];
      const next = { ...assetsRef.current, [key]: asset };
      assetsRef.current = next;
      setAssets(next);
      setSelected(key);
      selectedRef.current = key;
      if (old) URL.revokeObjectURL(old.url);
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(null);
      }
    }
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
    try {
      await audio.play();
    } catch {
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
      setError("无法读取真实音频时长，暂不能同步预览。可下载 MP3 检查。");
      return;
    }
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
