export async function jsonRequest(url, options, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (e) {
    if (e.name === "AbortError" || e.name === "TimeoutError") throw e;
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
// AbortSignal.any/timeout are absent on some iPad Safari versions. Dispose listeners per request.
function abortScope(parent, timeoutMs) {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      parent.reason || new DOMException("Cancelled", "AbortError"),
    );
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}
function checkAbort(signal) {
  if (signal.aborted)
    throw signal.reason || new DOMException("Cancelled", "AbortError");
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason || new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
export async function renderVideo(
  timeline,
  makeFrame,
  {
    signal,
    onProgress = () => {},
    fetchImpl = fetch,
    onJob = () => {},
    timeoutMs = 20 * 60 * 1000,
    requestTimeoutMs = 60000,
    pollMs = 1500,
  } = {},
) {
  if (timeline.precision === "estimated")
    throw Error("估算时轴不能导出，请先完成真实对齐或逐句手动确认。");
  const deadline = abortScope(signal, timeoutMs),
    combined = deadline.signal;
  const request = async (url, options, raw = false) => {
    const scope = abortScope(combined, requestTimeoutMs);
    try {
      checkAbort(scope.signal);
      return raw
        ? await fetchImpl(url, { ...options, signal: scope.signal })
        : await jsonRequest(
            url,
            { ...options, signal: scope.signal },
            fetchImpl,
          );
    } finally {
      scope.dispose();
    }
  };
  let job;
  try {
    job = await request("/api/video-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(timeline.manifest),
    });
    if (!job || !/^[a-f0-9]{32}$/.test(job.jobId) || !job.token || !job.baseUrl)
      throw Error("渲染任务凭证无效，请检查服务版本。");
    onJob(job);
    const base = `${job.baseUrl}/jobs/${job.jobId}`;
    const headers = { Authorization: `Bearer ${job.token}` };
    let count = 0;
    const total = timeline.frames.length + timeline.audios.length;
    for (let i = 0; i < timeline.frames.length; i++) {
      checkAbort(combined);
      const png = await abortable(makeFrame(timeline.frames[i]), combined);
      checkAbort(combined);
      await request(`${base}/frame-${i}.png`, {
        method: "PUT",
        headers,
        body: png,
      });
      onProgress({
        percent: Math.round((++count / total) * 45),
        message: `上传字幕画面 ${i + 1}/${timeline.frames.length}`,
      });
    }
    for (let i = 0; i < timeline.audios.length; i++) {
      await request(`${base}/audio-${i}.mp3`, {
        method: "PUT",
        headers,
        body: timeline.audios[i].blob,
      });
      onProgress({
        percent: Math.round((++count / total) * 45),
        message: `上传音频 ${i + 1}/${timeline.audios.length}`,
      });
    }
    // Creating/starting jobs is never retried automatically: an ambiguous response may already have started work.
    await request(`${base}/start`, { method: "POST", headers });
    for (;;) {
      checkAbort(combined);
      const state = await request(base, { headers });
      if (state.state === "error")
        throw Error(state.error || "MP4 合成失败，请重试。");
      if (state.state === "complete") {
        const r = state.result;
        if (
          !r ||
          r.videoCodec !== "h264" ||
          r.audioCodec !== "aac" ||
          r.width !== 1080 ||
          r.height !== 1920 ||
          !Number.isFinite(r.duration) ||
          Math.abs(r.duration - timeline.sourceDuration) > 1 / 30 + 0.01
        )
          throw Error(
            "输出格式或时长验证失败，未标记为成功，请更新渲染服务并重试。",
          );
        const url = `${base}/video?token=${encodeURIComponent(job.token)}`;
        const file = await request(url, { method: "HEAD" }, true);
        if (
          !file.ok ||
          !file.headers.get("content-type")?.includes("video/mp4") ||
          Number(file.headers.get("content-length")) <= 0
        )
          throw Error("MP4 文件尚不可下载或已过期，请检查渲染服务后重试。");
        return {
          url,
          download: `${url}&download=1`,
          expiresAt: job.expiresAt,
          result: r,
        };
      }
      if (!["queued", "rendering", "uploading"].includes(state.state))
        throw Error("渲染任务状态无效，请重试。");
      onProgress({
        percent: Math.min(
          99,
          45 +
            Math.round(
              Math.max(0, Math.min(100, Number(state.progress) || 0)) * 0.55,
            ),
        ),
        message: "FFmpeg 正在合成 H.264 / AAC…",
      });
      await new Promise((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(combined.reason);
        };
        const timer = setTimeout(() => {
          combined.removeEventListener("abort", abort);
          resolve();
        }, pollMs);
        combined.addEventListener("abort", abort, { once: true });
        if (combined.aborted) abort();
      });
    }
  } catch (error) {
    if (job) await cancelRender(job, { fetchImpl });
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (
      combined.reason?.name === "TimeoutError" ||
      error.name === "TimeoutError"
    )
      throw Error(
        "视频导出或上传超时，任务已停止；项目与 MP3 保留，请检查服务后重试。",
      );
    throw error;
  } finally {
    deadline.dispose();
  }
}
export async function cancelRender(job, { fetchImpl = fetch } = {}) {
  if (!job) return;
  const scope = abortScope(null, 5000);
  try {
    await fetchImpl(`${job.baseUrl}/jobs/${job.jobId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${job.token}` },
      signal: scope.signal,
    });
  } catch {
  } finally {
    scope.dispose();
  } // Cancellation is best-effort; server deadline/TTL still apply.
}
export async function audioDuration(asset, { signal } = {}) {
  if (signal?.aborted)
    throw signal.reason || new DOMException("Cancelled", "AbortError");
  if (Number.isFinite(asset.duration) && asset.duration > 0)
    return asset.duration;
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    let timer;
    const clean = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
    };
    const abort = () => {
      clean();
      reject(signal.reason || new DOMException("Cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
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
