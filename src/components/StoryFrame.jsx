import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  normalizePresentation,
  safeTextColor,
} from "../presentation/settings.js";
import {
  frameGeometry,
  subtitlePages,
  pageAtTime,
} from "../presentation/layout.js";
export default function StoryFrame({
  project,
  scene,
  index,
  audioRef,
  audioRange,
  audioSelected,
}) {
  const p = normalizePresentation(project),
    s = p.subtitleStyle,
    geometry = frameGeometry(s, p.subtitlePosition, p.ratio),
    host = useRef(null),
    [width, setWidth] = useState(260),
    [page, setPage] = useState(0);
  const measure = useMemo(() => {
    if (typeof document === "undefined") return undefined;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return undefined;
    const cache = new Map();
    return (ch, size) => {
      const key = ch + size;
      if (!cache.has(key)) {
        ctx.font = `600 ${size}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
        cache.set(key, ctx.measureText(ch).width);
      }
      return cache.get(key);
    };
  }, []);
  const layout = useMemo(
    () =>
      subtitlePages(
        scene?.english || "",
        scene?.chinese || "",
        p.subtitles,
        s,
        geometry,
        measure,
      ),
    [
      scene?.english,
      scene?.chinese,
      p.subtitles,
      JSON.stringify(s),
      geometry.textHeight,
      measure,
    ],
  );
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const update = () => setWidth(element.getBoundingClientRect().width || 260);
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    setPage(0);
  }, [index, scene?.id, scene?.english, scene?.chinese, layout.pages.length]);
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio || !audioSelected) return;
    const update = () => {
      const start = audioRange?.start ?? 0,
        end = audioRange?.end ?? audio.duration;
      setPage(pageAtTime(layout.pages.length, audio.currentTime, start, end));
    };
    const events = [
      "timeupdate",
      "seeked",
      "play",
      "pause",
      "ended",
      "loadedmetadata",
    ];
    events.forEach((e) => audio.addEventListener(e, update));
    update();
    return () => events.forEach((e) => audio.removeEventListener(e, update));
  }, [
    audioRef,
    audioSelected,
    index,
    audioRange?.start,
    audioRange?.end,
    layout.pages.length,
  ]);
  const current = layout.pages[Math.min(page, layout.pages.length - 1)];
  const immersive = p.videoTemplate === "immersive",
    background = immersive ? "#081812" : s.backgroundColor;
  const enColor = safeTextColor(
    s.englishColor,
    background,
    s.opacity,
    immersive ? "#ffffff" : "#173e2e",
  );
  const zhColor = safeTextColor(
    s.chineseColor,
    background,
    s.opacity,
    immersive ? "#ffffff" : "#173e2e",
  );
  const hexToRgb = (color) =>
    color
      .slice(1)
      .match(/../g)
      .map((x) => parseInt(x, 16))
      .join(",");
  const lines = (values, size, lineHeight, color) => (
    <div
      style={{ fontSize: size, lineHeight: `${size * lineHeight}px`, color }}
    >
      {values.map((line, i) => (
        <div
          className="subtitle-line"
          key={i}
          style={{ height: size * lineHeight }}
        >
          {line.replace(/\n$/, "")}
        </div>
      ))}
    </div>
  );
  return (
    <>
      <div
        ref={host}
        className="v3-frame-shell"
        style={{ aspectRatio: `1080 / ${geometry.height}` }}
        aria-label={`模板 ${immersive ? "B" : "A"} 视频预览`}
      >
        <div
          className={`v3-frame-content ${immersive ? "immersive" : "picturebook"}`}
          style={{
            width: 1080,
            height: geometry.height,
            transform: `scale(${width / 1080})`,
          }}
        >
          <div
            className="v3-art"
            style={{
              height: immersive
                ? "100%"
                : geometry.height - geometry.panelHeight,
            }}
          >
            {scene?.imageRef ? (
              <img
                src={scene.imageRef.dataUrl}
                alt="当前分镜上传图片"
                style={{
                  objectFit: scene.imageFit || "cover",
                  objectPosition: `${scene.imagePosition?.x ?? 50}% ${scene.imagePosition?.y ?? 50}%`,
                  transform: `scale(${scene.imageScale ?? 1})`,
                  transformOrigin: `${scene.imagePosition?.x ?? 50}% ${scene.imagePosition?.y ?? 50}%`,
                }}
              />
            ) : (
              <>
                <div className="sun" />
                <div className="hill hill-back" />
                <div className="hill hill-front" />
                <div className="tree tree-one" />
                <div className="tree tree-two" />
                <div className="traveler">♟</div>
              </>
            )}
          </div>
          {immersive ? (
            <div
              className="v3-subtitle-backdrop"
              style={{
                height: geometry.panelHeight + 220,
                background: `linear-gradient(to bottom, transparent 0%, rgba(8,24,18,${s.opacity}) 220px, rgba(8,24,18,${s.opacity}) 100%)`,
              }}
            />
          ) : (
            <div
              className="v3-subtitle-backdrop"
              style={{
                height: geometry.panelHeight,
                background: `rgba(${hexToRgb(background)},${s.opacity})`,
              }}
            />
          )}
          <div
            className="v3-subtitle-text"
            style={{
              left: geometry.left,
              bottom: geometry.bottom,
              width: geometry.textWidth,
              textAlign: s.align,
              textShadow: immersive ? "0 2px 6px rgba(0,0,0,.8)" : "none",
            }}
          >
            {lines(
              current.english,
              layout.englishSize,
              s.englishLineHeight,
              enColor,
            )}
            {!!current.english.length && !!current.chinese.length && (
              <div style={{ height: s.gap }} />
            )}
            {lines(
              current.chinese,
              layout.chineseSize,
              s.chineseLineHeight,
              zhColor,
            )}
            {!scene && (
              <div style={{ fontSize: 48, color: enColor }}>
                添加分镜，开始你的故事
              </div>
            )}
          </div>
        </div>
        {p.subtitleSafeArea && (
          <div
            className="safe-area-guide"
            aria-label="编辑辅助安全区，不属于视频画面"
          >
            <span>字幕安全区 · 仅编辑辅助</span>
          </div>
        )}
      </div>
      <div className="frame-legend">
        {scene?.imageRef ? "本分镜上传图片" : "演示占位画面 · 非 AI 生成"}
        {p.ratio === "16:9" ? " · 横屏兼容布局" : ""}
      </div>
      {layout.pages.length > 1 && (
        <div className="subtitle-pages">
          <button
            aria-label="上一字幕页"
            disabled={page === 0}
            onClick={() => setPage(Math.max(0, page - 1))}
          >
            上一页
          </button>
          <span>
            长句分页 {Math.min(page + 1, layout.pages.length)} /{" "}
            {layout.pages.length}
            <small>按本镜进度估算翻页</small>
          </span>
          <button
            aria-label="下一字幕页"
            disabled={page >= layout.pages.length - 1}
            onClick={() => setPage(Math.min(layout.pages.length - 1, page + 1))}
          >
            下一页
          </button>
        </div>
      )}
    </>
  );
}
