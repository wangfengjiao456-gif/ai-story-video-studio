export const config = { maxDuration: 60 };
export function createRendererStatus({
  getConfig = () => ({
    url: process.env.RENDERER_URL,
    key: process.env.RENDERER_API_KEY,
  }),
  fetchImpl = fetch,
} = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const fail = (status, message) =>
      res.status(status).json({ error: { message } });
    if (req.method !== "POST") return fail(405, "仅支持 POST。");
    try {
      if (
        !req.headers.origin ||
        new URL(req.headers.origin).host !== req.headers.host
      )
        return fail(403, "请从本站检查服务。");
    } catch {
      return fail(403, "来源无效。");
    }
    const { url, key } = getConfig();
    if (!url || !key)
      return fail(
        503,
        "尚未部署渲染服务：请按 DEPLOYMENT.md 部署 Render Docker 服务，然后配置当前 Vercel Preview 的 RENDERER_URL、RENDERER_API_KEY 并重新部署。",
      );
    try {
      const base = new URL(url);
      if (
        base.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(base.hostname)
      )
        return fail(503, "渲染服务需要 HTTPS。");
      const response = await fetchImpl(new URL("/check", base), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ origin: req.headers.origin }),
        signal: AbortSignal.timeout(45000),
      });
      const body = await response.json();
      if (!response.ok)
        return fail(
          response.status,
          response.status === 403
            ? `渲染服务未允许当前来源：${new URL(req.headers.origin).origin}。请在 Render 的 ALLOWED_ORIGINS 原有内容后，用英文逗号追加该来源，不带末尾斜杠；保留其他域名，保存后重新部署 Render。`
            : typeof body.error === "string"
              ? body.error
              : "渲染服务检查失败。",
        );
      if (body.ok !== true) return fail(502, "渲染服务响应异常。");
      return res.status(200).json({ ok: true });
    } catch {
      return fail(
        502,
        "无法连接渲染服务：请确认服务已启动、HTTPS 正常；Render 冷启动后请重试。",
      );
    }
  };
}
export default createRendererStatus();
