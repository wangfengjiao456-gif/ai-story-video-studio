export function createVideoJobHandler({
  getConfig = () => ({
    url: process.env.RENDERER_URL,
    key: process.env.RENDERER_API_KEY,
  }),
  fetchImpl = fetch,
} = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const fail = (s, message) => res.status(s).json({ error: { message } });
    if (req.method !== "POST") return fail(405, "仅支持 POST。");
    try {
      if (
        !req.headers.origin ||
        new URL(req.headers.origin).host !== req.headers.host
      )
        return fail(403, "请从本站发起视频导出。");
    } catch {
      return fail(403, "请求来源无效。");
    }
    const { url, key } = getConfig();
    if (!url || !key)
      return fail(
        503,
        "MP4 渲染服务尚未部署。请按 README 部署 renderer，并在当前 Vercel Preview 设置 RENDERER_URL 与 RENDERER_API_KEY；浏览器会继续保留图片和音频。",
      );
    try {
      const base = new URL(url);
      if (
        base.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(base.hostname)
      )
        return fail(503, "渲染服务必须使用 HTTPS。");
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (JSON.stringify(body).length > 100000)
        return fail(400, "视频任务过大，请减少字幕分页。");
      const response = await fetchImpl(new URL("/jobs", base), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ ...body, origin: req.headers.origin }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok)
        return fail(
          response.status,
          typeof result.error === "string"
            ? result.error
            : "渲染任务创建失败。",
        );
      if (
        !/^[a-f0-9]{32}$/.test(result.jobId) ||
        typeof result.token !== "string"
      )
        return fail(502, "渲染服务响应异常。");
      return res
        .status(200)
        .json({
          jobId: result.jobId,
          token: result.token,
          baseUrl: base.origin,
          expiresAt: result.expiresAt,
        });
    } catch {
      return fail(
        502,
        "无法连接渲染服务，请检查 HTTPS、服务密钥、允许来源与网络。未调用付费 AI。",
      );
    }
  };
}
export default createVideoJobHandler();
