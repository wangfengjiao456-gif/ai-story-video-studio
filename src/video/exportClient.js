export async function jsonRequest(url, options, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (e) {
    if (e.name === "AbortError" || e.name === "TimeoutError") throw e;
    throw Object.assign(
      Error("网络请求失败，请检查渲染服务 HTTPS 与允许的 Preview 域名。"),
      { retryable: true },
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    const detail =
      response.status === 401 || response.status === 403
        ? "若为 Preview，请先登录 Vercel；若为 worker，请检查密钥和来源白名单。"
        : response.status === 404
          ? "接口不存在，请检查服务地址和当前分支部署。"
          : "请确认 Vercel API 路由和渲染服务已部署。";
    throw Object.assign(
      Error(`服务响应不可读（HTTP ${response.status}）。${detail}`),
      {
        status: response.status,
        retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
      },
    );
  }
  if (!response.ok)
    throw Object.assign(
      Error(
        typeof data?.error === "string"
          ? data.error
          : data?.error?.message || `请求失败（HTTP ${response.status}）。`,
      ),
      {
        status: response.status,
        retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
      },
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
    readRetryMs = 300,
  } = {},
) {
  if (timeline.requiresMix) throw Error("请先准备封面与音乐混音，再导出。");
  if (timeline.precision === "estimated")
    throw Error("估算时轴不能导出，请先完成真实对齐或逐句手动确认。");
  const deadline = abortScope(signal, timeoutMs),
    combined = deadline.signal;
  const request = async (url, options, raw = false) => {
    const readOnly =
      !options.method || options.method === "GET" || options.method === "HEAD";
    for (let attempt = 0; ; attempt++) {
      const scope = abortScope(combined, requestTimeoutMs);
      try {
        checkAbort(scope.signal);
        const response = raw
          ? await fetchImpl(url, { ...options, signal: scope.signal })
          : await jsonRequest(
              url,
              { ...options, signal: scope.signal },
              fetchImpl,
            );
        if (raw && [408, 429, 500, 502, 503, 504].includes(response.status))
          throw Object.assign(Error("下载检查暂时不可用。"), {
            retryable: true,
          });
        return response;
      } catch (error) {
        if (
          !readOnly ||
          attempt >= 2 ||
          combined.aborted ||
          !(
            error.retryable ||
            error.name === "TypeError" ||
            error.name === "TimeoutError"
          )
        )
          throw error;
      } finally {
        scope.dispose();
      }
      await abortable(
        new Promise((resolve) => setTimeout(resolve, readRetryMs)),
        combined,
      );
    }
  };
  let job, completedVideo;
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
      await request(
        `${base}/audio-${i}.${timeline.audios[i].encoding === "wav" ? "wav" : "mp3"}`,
        {
          method: "PUT",
          headers,
          body: timeline.audios[i].blob,
        },
      );
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
      if (!state || typeof state !== "object" || Array.isArray(state))
        throw Error("渲染服务返回无效任务状态，请检查服务版本后重试。");
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
        completedVideo = {
          url,
          download: `${url}&download=1`,
          expiresAt: job.expiresAt,
          result: r,
        };
        const file = await request(url, { method: "HEAD" }, true);
        assertVideoHeaders(file);
        return completedVideo;
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
          reject(
            combined.reason || new DOMException("Cancelled", "AbortError"),
          );
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
    if (job && !completedVideo) await cancelRender(job, { fetchImpl });
    if (completedVideo && !signal?.aborted && !error.terminalDownload) {
      error.recoverableVideo = completedVideo;
    }
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (
      combined.reason?.name === "TimeoutError" ||
      error.name === "TimeoutError"
    )
      throw Object.assign(
        Error(
          completedVideo
            ? "视频已经编码完成，但下载检查超时。文件未删除，请恢复下载检查，无需重新渲染。"
            : "视频导出或上传超时，任务已停止；项目与 MP3 保留，请检查服务后重试。",
        ),
        { recoverableVideo: completedVideo },
      );
    if (completedVideo && error.name === "TypeError")
      throw Object.assign(
        Error("视频已编码，但下载网络请求失败，文件未删除，请恢复下载检查。"),
        { recoverableVideo: completedVideo },
      );
    throw error;
  } finally {
    deadline.dispose();
  }
}
function assertVideoHeaders(file) {
  if (
    !file.ok ||
    !file.headers.get("content-type")?.includes("video/mp4") ||
    !Number.isFinite(Number(file.headers.get("content-length"))) ||
    Number(file.headers.get("content-length")) <= 0
  )
    throw Object.assign(
      Error(
        [401, 404, 410].includes(file.status)
          ? "视频任务已过期或服务已重启，请重新导出。"
          : "MP4 下载检查失败，已完成文件未删除，可恢复下载检查。",
      ),
      { terminalDownload: [401, 404, 410].includes(file.status) },
    );
}
export function renderExpired(output, now = Date.now()) {
  return Number.isFinite(output?.expiresAt) && output.expiresAt * 1000 <= now;
}
export async function recoverVideoDownload(
  output,
  { fetchImpl = fetch, signal } = {},
) {
  if (renderExpired(output))
    throw Error("视频下载已过期，请重新导出。项目与原文件仍保留。");
  const scope = abortScope(signal, 30000);
  try {
    checkAbort(scope.signal);
    const file = await fetchImpl(output.url, {
      method: "HEAD",
      signal: scope.signal,
    });
    assertVideoHeaders(file);
    return output;
  } catch (error) {
    if (error.name === "TypeError")
      throw Error("下载检查网络请求失败，文件未删除，请恢复网络后重试。");
    throw error;
  } finally {
    scope.dispose();
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
