import React, { useState } from "react";
import { jsonRequest } from "../video/exportClient.js";
export default function ServiceStatus() {
  const [status, setStatus] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    setError("");
    try {
      setStatus(await jsonRequest("/api/service-status", {}));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="note">
      <strong>当前部署与服务配置</strong>
      <p>只检查变量是否存在，不读取或显示密钥值，也不触发付费调用。</p>
      <button disabled={busy} onClick={check}>
        {busy ? "检查中…" : "检查当前分支配置"}
      </button>
      {error && <p className="validation-error">{error}</p>}
      {status && (
        <>
          <p>
            分支：{status.branch} · 环境：{status.environment}
          </p>
          <p>
            ElevenLabs：{status.elevenlabs ? "已配置" : "未配置"} · OpenAI：
            {status.openai ? "已配置" : "未配置"} · MP4 渲染服务：
            {status.renderer ? "已配置" : "未配置"}
          </p>
          <p>{status.guidance}</p>
        </>
      )}
    </section>
  );
}
