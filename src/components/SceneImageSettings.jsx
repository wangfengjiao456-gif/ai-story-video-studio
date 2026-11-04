import React, { useEffect, useRef, useState } from "react";
import { imageDefaults } from "../presentation/settings.js";
import { uploadImage } from "../services/images.js";
export default function SceneImageSettings({ scene, onChange }) {
  const s = { ...imageDefaults(), ...scene },
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    input = useRef(null),
    version = useRef(0);
  useEffect(
    () => () => {
      version.current++;
    },
    [],
  );
  const range = (key, label, min, max, step, value, patch) => (
    <label className="field template-range" key={key}>
      <span>
        {label}
        <em>{value}</em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(patch(Number(e.target.value)))}
      />
    </label>
  );
  async function upload(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const current = ++version.current;
    setBusy(true);
    setError("");
    try {
      const imageRef = await uploadImage(file);
      if (current === version.current)
        onChange({ imageRef, ...imageDefaults() });
    } catch (err) {
      setError(err.message);
    } finally {
      if (current === version.current) setBusy(false);
    }
  }
  return (
    <section className="scene-image-settings" aria-label="分镜图片">
      <div className="toolbar">
        <strong>本镜绘本图片</strong>
        <span className="muted">本地上传 · 非 AI 生成</span>
      </div>
      {s.imageRef && (
        <img
          className="uploaded-thumb"
          src={s.imageRef.dataUrl}
          alt="本分镜已上传图片"
        />
      )}
      <div className="ai-actions">
        <button disabled={busy} onClick={() => input.current.click()}>
          {busy ? "正在检查与压缩…" : s.imageRef ? "替换图片" : "上传图片"}
        </button>
        {s.imageRef && (
          <button
            onClick={() => {
              version.current++;
              setBusy(false);
              onChange({ imageRef: null });
            }}
          >
            移除图片
          </button>
        )}
        <input
          ref={input}
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={upload}
        />
      </div>
      {error && (
        <p role="alert" className="validation-error">
          {error}
        </p>
      )}
      <p className="muted">
        支持 JPG / PNG / WebP；最大 8 MB、1,600 万像素。自动压缩为最长边
        1440px、600 KB 内的 JPG，透明区域铺奶油白。图片随项目 JSON
        保存，总项目仍限 5 MB。
      </p>
      <label className="field">
        <span>图片适配</span>
        <select
          value={s.imageFit}
          onChange={(e) => onChange({ imageFit: e.target.value })}
        >
          <option value="cover">Cover · 等比铺满并裁切</option>
          <option value="contain">Contain · 等比完整显示</option>
        </select>
      </label>
      {range("scale", "图片缩放", 1, 2, 0.05, s.imageScale, (imageScale) => ({
        imageScale,
      }))}
      {range("x", "横向裁切焦点（%）", 0, 100, 1, s.imagePosition.x, (x) => ({
        imagePosition: { ...s.imagePosition, x },
      }))}
      {range("y", "纵向裁切焦点（%）", 0, 100, 1, s.imagePosition.y, (y) => ({
        imagePosition: { ...s.imagePosition, y },
      }))}
      <button onClick={() => onChange(imageDefaults())}>重置图片构图</button>
    </section>
  );
}
