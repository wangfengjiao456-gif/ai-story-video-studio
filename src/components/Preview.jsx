import React from "react";
import StoryFrame from "./StoryFrame.jsx";
import { Play, Pause, ChevronLeft, ChevronRight, Mountain } from "lucide-react";
export default function Preview({
  project,
  syncLabel,
  audioRef,
  audioSelected,
  audioRange,
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
      <div className="preview-stage v3-preview-stage">
        <StoryFrame
          project={project}
          scene={scene}
          index={index}
          audioRef={audioRef}
          audioRange={audioRange}
          audioSelected={audioSelected}
        />
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
          {syncLabel && <strong className="sync-label">{syncLabel}。 </strong>}
          播放按每镜时长切换。AI 音频请到“AI
          配音”控制。英文朗读请使用“逐句试听”，iPad 上需手动触发。所有画面均为
          CSS 演示占位或用户上传图片。长句分页按本镜进度估算。
        </p>
      </div>
      <div className="export-note">
        <span>MP4 视频导出</span>
        <span className="badge">到左侧“视频预览与导出”</span>
      </div>
    </aside>
  );
}
