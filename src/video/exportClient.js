export async function jsonRequest(url, options, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw Error("网络请求失败，请检查渲染服务 HTTPS 与允许的 Preview 域名。");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error("服务响应不可读，请确认 Vercel API 路由和渲染服务已部署。");
  }
  if (!response.ok)
    throw Error(
      typeof data.error === "string"
        ? data.error
        : data.error?.message || "请求失败。",
    );
  return data;
}
export async function renderVideo(
  timeline,
  makeFrame,
  { signal, onProgress = () => {}, fetchImpl = fetch, onJob = () => {} } = {},
) {
  const job = await jsonRequest(
    "/api/video-jobs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(timeline.manifest),
      signal,
    },
    fetchImpl,
  );
  onJob(job);
  const base = `${job.baseUrl}/jobs/${job.jobId}`,
    headers = { Authorization: `Bearer ${job.token}` };
  let count = 0;
  const total = timeline.frames.length + timeline.audios.length;
  for (let i = 0; i < timeline.frames.length; i++) {
    const png = await makeFrame(timeline.frames[i]);
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    await jsonRequest(
      `${base}/frame-${i}.png`,
      { method: "PUT", headers, body: png, signal },
      fetchImpl,
    );
    onProgress({
      percent: Math.round((++count / total) * 45),
      message: `上传字幕画面 ${i + 1}/${timeline.frames.length}`,
    });
  }
  for (let i = 0; i < timeline.audios.length; i++) {
    await jsonRequest(
      `${base}/audio-${i}.mp3`,
      { method: "PUT", headers, body: timeline.audios[i].blob, signal },
      fetchImpl,
    );
    onProgress({
      percent: Math.round((++count / total) * 45),
      message: `上传音频 ${i + 1}/${timeline.audios.length}`,
    });
  }
  await jsonRequest(
    `${base}/start`,
    { method: "POST", headers, signal },
    fetchImpl,
  );
  for (;;) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const state = await jsonRequest(base, { headers, signal }, fetchImpl);
    onProgress({
      percent: 45 + Math.round((state.progress || 0) * 0.55),
      message: "FFmpeg 正在合成 H.264 / AAC…",
    });
    if (state.state === "error") throw Error(state.error || "MP4 合成失败。");
    if (state.state === "complete")
      return {
        url: `${base}/video?token=${encodeURIComponent(job.token)}`,
        download: `${base}/video?token=${encodeURIComponent(job.token)}&download=1`,
        expiresAt: job.expiresAt,
        result: state.result,
      };
    await new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, 1500);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}
export function cancelRender(job) {
  if (job)
    fetch(`${job.baseUrl}/jobs/${job.jobId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${job.token}` },
    }).catch(() => {});
}
export async function audioDuration(asset) {
  if (Number.isFinite(asset.duration) && asset.duration > 0)
    return asset.duration;
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    let timer;
    const clean = () => {
      clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      clean();
      Number.isFinite(d) && d > 0
        ? resolve(d)
        : reject(Error("无法读取 MP3 真实时长，请重新下载或导入。"));
    };
    audio.onerror = () => {
      clean();
      reject(Error("MP3 无法解码，请重新生成或导入标准 MP3。"));
    };
    timer = setTimeout(() => {
      clean();
      reject(Error("读取音频时长超时。"));
    }, 20000);
    audio.src = asset.url;
  });
}
