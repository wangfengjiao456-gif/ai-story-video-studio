import {
  framePlan,
  paintFrame,
  FONT_STACK,
} from "../presentation/frameRenderer.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { normalizePresentation } from "../presentation/settings.js";
import {
  frameGeometry,
  subtitlePages,
  pageAtTime,
} from "../presentation/layout.js";
export default function StoryFrame({
  project,
  overrideFrame,
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
    [page, setPage] = useState(0);
  const measure = useMemo(() => {
    if (typeof document === "undefined") return undefined;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return undefined;
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
  const canvasRef = useRef(null),
    decoded = useRef(null),
    [ready, setReady] = useState(null),
    [renderError, setRenderError] = useState("");
  const basePlan = useMemo(
    () => framePlan(project, scene, measure),
    [
      project.ratio,
      project.videoTemplate,
      project.subtitles,
      JSON.stringify(project.subtitleStyle),
      project.subtitlePosition,
      scene,
      measure,
    ],
  );
  const plan = overrideFrame?.plan || basePlan,
    activePage = overrideFrame?.page ?? page,
    activeScene = plan.scene;
  const renderVersion = useMemo(() => ({}), [plan, activePage]);
  useEffect(() => {
    let cancelled = false;
    setRenderError("");
    async function paint() {
      try {
        let image = null;
        if (activeScene?.imageRef) {
          const src = activeScene.imageRef.dataUrl;
          if (decoded.current?.src === src) image = decoded.current.image;
          else {
            image = new Image();
            await new Promise((resolve, reject) => {
              image.onload = resolve;
              image.onerror = () => reject(Error("图片无法解码，请替换图片。"));
              image.src = src;
            });
            if (cancelled) return;
            decoded.current = { src, image };
          }
        }
        if (cancelled) return;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) throw Error("当前浏览器不支持画面渲染。");
        paintFrame(ctx, plan, activePage, image);
        setReady(renderVersion);
      } catch (err) {
        if (!cancelled) setRenderError(err.message);
      }
    }
    paint();
    return () => {
      cancelled = true;
    };
  }, [renderVersion]);
  function exportFrame() {
    if (ready !== renderVersion) return;
    canvasRef.current.toBlob((blob) => {
      if (!blob) {
        setRenderError("画面导出失败，请重试。");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `scene-${index + 1}-page-${page + 1}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, "image/png");
  }
  const immersive = p.videoTemplate === "immersive";
  return (
    <>
      <div
        ref={host}
        className="v3-frame-shell"
        style={{ aspectRatio: `${plan.outputWidth} / ${plan.outputHeight}` }}
        aria-label={`模板 ${immersive ? "B" : "A"} 视频预览`}
      >
        <canvas
          ref={canvasRef}
          className="v31-frame-canvas"
          style={{ visibility: ready === renderVersion ? "visible" : "hidden" }}
          width={plan.outputWidth}
          height={plan.outputHeight}
          aria-label="当前分镜画面与字幕"
        />
        {p.subtitleSafeArea && (
          <div
            className="safe-area-guide"
            aria-label="编辑辅助安全区，不属于视频画面"
          >
            <span>平台安全区域 · 仅供参考</span>
          </div>
        )}
      </div>
      {renderError && (
        <p className="validation-error" role="alert">
          {renderError}
        </p>
      )}
      <button
        disabled={ready !== renderVersion || !!renderError}
        onClick={exportFrame}
      >
        导出当前字幕页 PNG
      </button>
      <div className="frame-legend">
        {scene?.imageRef
          ? scene.imageRef.kind === "generated"
            ? "OpenAI 生成配图"
            : "本分镜上传图片"
          : "演示占位画面 · 非 AI 生成"}
        {p.ratio === "16:9" ? " · 横屏教学" : ""}
      </div>
      {!overrideFrame && layout.pages.length > 1 && (
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
