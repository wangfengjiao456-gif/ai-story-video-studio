import React from "react";
import {
  templateDefaults,
  STYLE_LIMITS,
  normalizePresentation,
  safeTextColor,
} from "../presentation/settings.js";
export default function TemplateSettings({ project, onChange }) {
  const p = normalizePresentation(project),
    s = p.subtitleStyle;
  const change = (patch) => onChange({ subtitleStyle: { ...s, ...patch } });
  const range = (key, label) => {
    const [min, max, step] = STYLE_LIMITS[key];
    return (
      <label className="field template-range" key={key}>
        <span>
          {label}
          <em>{key === "opacity" ? `${Math.round(s[key] * 100)}%` : s[key]}</em>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={s[key]}
          onChange={(e) => change({ [key]: Number(e.target.value) })}
        />
      </label>
    );
  };
  const background =
    p.videoTemplate === "immersive" ? "#081812" : s.backgroundColor;
  const colorNotice = ["englishColor", "chineseColor"].some(
    (key) =>
      safeTextColor(
        s[key],
        background,
        s.opacity,
        p.videoTemplate === "immersive" ? "#ffffff" : "#173e2e",
      ) !== s[key],
  );
  return (
    <section className="template-settings" aria-label="视频画面模板">
      <div className="toolbar">
        <strong>视频画面模板</strong>
        <span className="badge">V3 · 9:16</span>
      </div>
      <div className="template-choices">
        {[
          ["picturebook", "模板 A · 独立字幕区", "适合教材与英语跟读"],
          ["immersive", "模板 B · 渐变字幕遮罩", "适合成长与绘本故事"],
        ].map(([id, label, description]) => (
          <button
            key={id}
            aria-pressed={p.videoTemplate === id}
            className={p.videoTemplate === id ? "chosen" : ""}
            onClick={() =>
              onChange({
                videoTemplate: id,
                subtitleStyle: templateDefaults(id),
                subtitlePosition: 6,
                ratio: "9:16",
              })
            }
          >
            <span className={`template-thumb ${id}`}>
              <span>
                Once upon a time…<small>故事，从这里开始。</small>
              </span>
            </span>
            <strong>{label}</strong>
            <small>{description}</small>
          </button>
        ))}
      </div>
      <p className="muted">
        选择模板会应用该模板默认样式并切为竖屏；人物、图片、文字与已有配音保留。
      </p>
      <div className="style-control-grid">
        {range("englishSize", "英文字号（1080p）")}
        {range("chineseSize", "中文字号（1080p）")}
        {range("englishLineHeight", "英文行距")}
        {range("chineseLineHeight", "中文行距")}
        {range("height", "字幕区高度（%）")}
        {range(
          "opacity",
          p.videoTemplate === "immersive" ? "遮罩强度" : "字幕背景不透明度",
        )}
        {range("gap", "中英文间距（1080p）")}
        <label className="field template-range">
          <span>
            距底部安全边距<em>{p.subtitlePosition}%</em>
          </span>
          <input
            type="range"
            min="6"
            max="12"
            step="1"
            value={p.subtitlePosition}
            onChange={(e) =>
              onChange({ subtitlePosition: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <div className="color-controls">
        {[
          ["englishColor", "英文颜色"],
          ["chineseColor", "中文颜色"],
          ...(p.videoTemplate === "picturebook"
            ? [["backgroundColor", "字幕背景"]]
            : []),
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="color"
              value={s[key]}
              onChange={(e) => change({ [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label className="field">
        <span>字幕对齐</span>
        <select
          value={s.align}
          onChange={(e) => change({ align: e.target.value })}
        >
          <option value="center">居中</option>
          <option value="left">左对齐</option>
        </select>
      </label>
      <label className="field">
        <span>字幕显示模式</span>
        <select
          value={p.subtitles}
          onChange={(e) => onChange({ subtitles: e.target.value })}
        >
          <option value="both">英文 + 中文 · 双语字幕</option>
          <option value="en">英文字幕</option>
          <option value="zh">中文字幕</option>
        </select>
      </label>
      <label className="safe-toggle">
        <input
          type="checkbox"
          checked={p.subtitleSafeArea}
          onChange={(e) => onChange({ subtitleSafeArea: e.target.checked })}
        />
        显示字幕安全区域（仅编辑辅助）
      </label>
      {colorNotice && (
        <p className="tip" role="status">
          所选文字颜色对比度不足，预览将自动使用可读颜色保护字幕。
        </p>
      )}
      <button
        onClick={() =>
          onChange({
            subtitleStyle: templateDefaults(p.videoTemplate),
            subtitlePosition: 6,
          })
        }
      >
        恢复当前模板默认样式
      </button>
      <p className="tip">
        长句会先自动缩放到可读字号，仍放不下时分页完整展示。分页按本镜音频进度估算，不能当作逐词对齐。字体、模板、颜色及图片调整不会调用
        ElevenLabs。
      </p>
    </section>
  );
}
