import React, { useEffect, useRef, useState } from "react";
import { imageDefaults } from "../presentation/settings.js";
import { IMAGE_MODEL, IMAGE_QUALITY, imageSize } from "../imageConfig.js";
import { uploadImage } from "../services/images.js";
export default function SceneImageSettings({
  scene,
  onChange,
  project,
  generation,
  onSetStandard,
}) {
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
        <span className="muted">
          {s.imageRef?.kind === "generated"
            ? "OpenAI 生成图片"
            : "本地上传 · 非 AI 生成"}
        </span>
      </div>
      {s.imageRef && (
        <img
          className="uploaded-thumb"
          src={s.imageRef.dataUrl}
          alt="本分镜已上传图片"
        />
      )}
      <div className="ai-actions">
        <button
          disabled={!!generation?.busy || busy}
          onClick={() => {
            if (
              window.confirm(
                `预计操作：仅为本分镜${s.imageRef ? "重新生成" : "生成"} 1 张插画。模型 ${IMAGE_MODEL}，${imageSize(project.ratio)}，${IMAGE_QUALITY}。${project.character.referenceImage ? "将向 OpenAI 发送人物参考图，并产生额外输入费用。" : ""}按输入与输出 token 计费，生成前无法精确报价；以 OpenAI 账单为准。失败/超时也可能已计费，不自动重试。是否继续？`,
              )
            )
              generation.generate(s.id);
          }}
        >
          {generation?.busy === s.id
            ? "AI 生成中…"
            : s.imageRef
              ? "AI 重新生成配图"
              : "AI 生成配图"}
        </button>
        {s.imageRef && (
          <>
            <button onClick={() => onSetStandard(s.imageRef)}>
              设为人物标准形象
            </button>
            <a href={s.imageRef.dataUrl} download="scene-original-image">
              下载原始图片
            </a>
          </>
        )}
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
        支持 JPG / PNG / WebP，最多 8 MB、1,600
        万像素。保留上传原始字节；画幅、缩放和焦点只改变显示，不会反复裁剪或重编码。项目总量仍限
        5 MB，大图会导致保存超限，请使用较小原图或下载图片备份。
      </p>
      <p className="muted">
        AI
        操作每次只生成一张，需要确认费用。无文字、水印和人物一致性均需人工检查。
        <a
          href="https://developers.openai.com/api/docs/pricing"
          target="_blank"
          rel="noreferrer"
        >
          查看官方价格
        </a>
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
