import React from "react";
import { Play, Pause, ChevronLeft, ChevronRight, Mountain } from "lucide-react";
export default function Preview({
  project,
  index,
  setIndex,
  playing,
  toggle,
  stop,
}) {
  const scene = project.scenes[index];
  const change = (i) => {
    stop();
    setIndex(i);
  };
  return (
    <aside className="preview-panel">
      <div className="section-heading">
        <h2>实时预览</h2>
        <span className="badge">{project.ratio}</span>
      </div>
      <p className="muted">让文字，成为看得见的故事。</p>
      <div className="preview-stage">
        <div
          className={`canvas ${project.ratio === "16:9" ? "landscape" : ""}`}
          data-style={project.style}
        >
          <span className="demo-label">演示占位画面 · 非 AI 生成</span>
          <div className="sun" />
          <div className="hill hill-back" />
          <div className="hill hill-front" />
          <div className="tree tree-one" />
          <div className="tree tree-two" />
          <div className="traveler">♟</div>
          <div className="scene-caption">
            <span>
              {project.style} / {project.character.name || "未设置人物"}
            </span>
            <Mountain size={26} />
          </div>
          <div className="subtitles">
            {scene ? (
              <>
                {project.subtitles !== "zh" && <p>{scene.english}</p>}
                {project.subtitles !== "en" && (
                  <p className="zh">{scene.chinese}</p>
                )}
              </>
            ) : (
              <p>添加分镜，开始你的故事</p>
            )}
          </div>
        </div>
      </div>
      <div className="transport">
        <button
          aria-label="上一分镜"
          disabled={!scene || index === 0}
          onClick={() => change(index - 1)}
        >
          <ChevronLeft size={20} />
        </button>
        <button
          className="play"
          disabled={!scene}
          aria-label={playing ? "暂停预览" : "播放预览"}
          onClick={toggle}
        >
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button
          aria-label="下一分镜"
          disabled={!scene || index === project.scenes.length - 1}
          onClick={() => change(index + 1)}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="preview-count">
        分镜 {scene ? String(index + 1).padStart(2, "0") : "00"}{" "}
        <span>/ {String(project.scenes.length).padStart(2, "0")}</span>
      </div>
      <div className="timeline">
        {project.scenes.map((s, i) => (
          <button
            key={s.id}
            className={i === index ? "current" : ""}
            aria-label={`预览分镜 ${i + 1}`}
            onClick={() => change(i)}
          >
            {String(i + 1).padStart(2, "0")}
          </button>
        ))}
      </div>
      <div className="note">
        <strong>预览说明</strong>
        <p>
          播放按每镜时长切换。英文朗读请使用“逐句试听”，iPad
          上需手动触发。所有画面均为 CSS 演示占位。
        </p>
      </div>
      <div className="export-note">
        <span>MP4 视频导出</span>
        <span className="badge">待开发</span>
      </div>
    </aside>
  );
}
