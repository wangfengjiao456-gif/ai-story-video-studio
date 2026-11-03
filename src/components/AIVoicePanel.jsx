import React from "react";
import { Sparkles, Download, Play, Pause, RotateCcw } from "lucide-react";
import {
  VOICE_ID,
  MODEL_ID,
  MIN_SPEED,
  MAX_SPEED,
  TTS_TEXT_LIMIT,
} from "../voiceConfig.js";
import { isFresh } from "../services/aiVoice.js";
export default function AIVoicePanel({ project, studio, hidden }) {
  const { assets, speed, busy, current, selected } = studio;
  const download = (asset, name) => {
    const a = document.createElement("a");
    a.href = asset.url;
    a.download = `${name}.mp3`;
    a.click();
  };
  const card = (key, label, text) => {
    const asset = assets[key],
      fresh = isFresh(asset, text, speed),
      invalid = !text.trim() || text.trim().length > TTS_TEXT_LIMIT;
    return (
      <section className="scene-card ai-clip" key={key}>
        <div className="section-heading">
          <strong>{label}</strong>
          <span className="badge">
            {busy === key
              ? "生成中…"
              : asset
                ? fresh
                  ? "已生成"
                  : "需要重新生成"
                : "未生成"}
          </span>
        </div>
        <p className="clip-text">{text || "（英文为空）"}</p>
        <p className="muted">
          {text.trim().length.toLocaleString()} / 5,000 字符
          {asset?.duration ? ` · 真实音频 ${asset.duration.toFixed(1)} 秒` : ""}
        </p>
        {asset && !fresh && (
          <p className="validation-error" role="status">
            对应英文或语速已修改，此音频需要重新生成。原 MP3 仍可下载。
          </p>
        )}
        <div className="ai-actions">
          <button
            className="primary"
            disabled={!!busy || invalid}
            onClick={() => studio.generate(key)}
          >
            <Sparkles size={16} />
            {busy === key
              ? "生成中，请稍候"
              : asset
                ? "重新生成"
                : "生成英文配音"}
          </button>
          <button disabled={!fresh} onClick={() => studio.start(key, true)}>
            <Play size={16} />
            试听
          </button>
          {asset && (
            <button
              onClick={() =>
                download(
                  asset,
                  `${key === "article" ? "article" : `scene-${project.scenes.findIndex((s) => s.id === key) + 1}`}${fresh ? "" : "-旧版本"}`,
                )
              }
            >
              <Download size={16} />
              下载 MP3
            </button>
          )}
        </div>
        {invalid && text.trim().length > TTS_TEXT_LIMIT && (
          <p className="validation-error">
            Eleven v3 单次上限 5,000 字符，请缩短文章或按分镜生成。
          </p>
        )}
      </section>
    );
  };
  return (
    <section
      hidden={hidden}
      className="ai-voice-panel"
      aria-label="AI 配音工作台"
    >
      <div className="intro">
        <Sparkles size={24} />
        <div>
          <strong>ElevenLabs AI 英文慢速配音</strong>
          <p>使用固定声音生成真实 MP3，适合英语跟读练习。</p>
        </div>
      </div>
      <div className="voice-config">
        <span>
          声音 Voice ID <code>{VOICE_ID}</code>
        </span>
        <span>
          模型 <strong>Eleven v3</strong> <code>{MODEL_ID}</code>
        </span>
        <span>语言 English · en</span>
      </div>
      <label className="field">
        <span>
          AI 生成语速 <em>{speed.toFixed(1)}× · 默认 0.8</em>
        </span>
        <input
          type="range"
          min={MIN_SPEED}
          max={MAX_SPEED}
          step="0.1"
          value={speed}
          disabled={!!busy}
          onChange={(e) => studio.setSpeed(Number(e.target.value))}
        />
      </label>
      <p className="tip">
        每次生成或重新生成会消耗 ElevenLabs 额度。目标为 45–60
        秒，最终时长以真实音频为准；模型与声音不会自动切换。API Key
        仅由服务器读取。
      </p>
      {studio.error && (
        <div className="validation-error" role="alert">
          {studio.error}
        </div>
      )}
      <div className="ai-player">
        <strong>音频与字幕预览</strong>
        <p className="muted">
          {current
            ? `${selected === "article" ? "整篇文章" : `分镜 ${project.scenes.findIndex((s) => s.id === selected) + 1}`} · ${current.duration ? `${current.duration.toFixed(1)} 秒` : "正在读取真实时长"}`
            : "生成后点击试听；可在播放器暂停、继续或拖动进度。"}
        </p>
        <audio
          ref={studio.audioRef}
          src={current?.url}
          controls
          preload="metadata"
          {...studio.audioProps}
          aria-label="AI 配音播放器"
        />
        <div className="ai-actions">
          <button disabled={!current} onClick={studio.restart}>
            <RotateCcw size={16} />
            从头播放
          </button>
          <button disabled={!current} onClick={studio.toggle}>
            {studio.playing ? <Pause size={16} /> : <Play size={16} />}{" "}
            {studio.playing ? "暂停" : "继续播放"}
          </button>
          <button disabled={!project.scenes.length} onClick={studio.allScenes}>
            顺序播放分镜音频
          </button>
        </div>
        {current && (
          <p className="sync-label">
            {studio.timeline.mode === "aligned"
              ? "API 字符时间戳同步 · 请试听校对"
              : studio.timeline.mode === "estimated"
                ? `估算同步 · ${studio.timeline.reason}；依据真实音频总时长按英文词数分配`
                : studio.timeline.mode === "unavailable"
                  ? "暂不能同步：等待真实音频时长或添加分镜"
                  : "单镜音频同步 · 按真实音频结束事件切换"}
            。字幕跟随右侧预览，支持中英双语。
          </p>
        )}
      </div>
      {card("article", "整篇文章", project.english)}
      <div className="toolbar">
        <strong>逐个分镜生成</strong>
        <span className="muted">共 {project.scenes.length} 镜</span>
      </div>
      {project.scenes.map((s, i) =>
        card(s.id, `分镜 ${String(i + 1).padStart(2, "0")}`, s.english),
      )}
      <div className="note">
        <strong>保存与备用方案</strong>
        <p>
          音频仅保留在当前页面内存中，不写入 localStorage 或项目
          JSON。刷新或导入项目会清除音频，请及时下载
          MP3。“配音与字幕”中的浏览器英文朗读仍可免费使用。文章与分镜不一致时仅估算切镜；中文字幕沿用人工译文，不做逐词对齐。
        </p>
      </div>
    </section>
  );
}
