import React, { useState, useRef, useEffect } from "react";
import { uploadImage } from "../services/images.js";
export default function CharacterReference({ reference, onChange }) {
  const input = useRef(null),
    revision = useRef(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );
  async function upload(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const id = ++revision.current;
    setBusy(true);
    setError("");
    try {
      const ref = await uploadImage(file);
      if (id === revision.current) onChange(ref);
    } catch (err) {
      if (id === revision.current) setError(err.message);
    } finally {
      if (id === revision.current) setBusy(false);
    }
  }
  return (
    <section className="scene-image-settings">
      <strong>人物标准形象 / 参考图</strong>
      {reference && (
        <img
          className="uploaded-thumb"
          src={reference.dataUrl}
          alt="人物标准形象参考图"
        />
      )}
      <div className="ai-actions">
        <button disabled={busy} onClick={() => input.current.click()}>
          {busy ? "正在读取…" : reference ? "更换人物参考图" : "上传人物参考图"}
        </button>
        {reference && (
          <button
            onClick={() => {
              revision.current++;
              setBusy(false);
              onChange(null);
            }}
          >
            移除参考图
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        onChange={upload}
      />
      {error && (
        <p role="alert" className="validation-error">
          {error}
        </p>
      )}
      <p className="muted">
        人物名称、发型、服装和画风将与此图一起作为后续配图参考。也可将任意分镜图设为标准形象。一致性为尽力保持，需人工检查；参考图会发送至
        OpenAI 并产生额外输入费用。
      </p>
    </section>
  );
}
