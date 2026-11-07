export const config = { maxDuration: 120 };
export function createAlignmentHandler({
  getKey = () => process.env.ELEVENLABS_API_KEY,
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
        return fail(403, "请从本站确认音频对齐。");
    } catch {
      return fail(403, "请求来源无效。");
    }
    const key = getKey();
    if (!key)
      return fail(
        503,
        "API Key 尚未配置，请为当前 Vercel Preview 设置 ELEVENLABS_API_KEY 并重新部署。",
      );
    try {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (
        !b ||
        b.confirmed !== true ||
        typeof b.text !== "string" ||
        !b.text.trim() ||
        b.text.length > 100000 ||
        typeof b.audio !== "string" ||
        b.audio.length > 4000000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(b.audio)
      )
        return fail(
          400,
          "对齐需要有效英文与 3 MB 内 MP3；较大文件请先压缩为 128kbps MP3，或手动设置时间轴。",
        );
      const form = new FormData();
      form.append(
        "file",
        new Blob([Buffer.from(b.audio, "base64")], { type: "audio/mpeg" }),
        "audio.mp3",
      );
      form.append("text", b.text);
      const response = await fetchImpl(
        "https://api.elevenlabs.io/v1/forced-alignment",
        {
          method: "POST",
          headers: { "xi-api-key": key },
          body: form,
          signal: AbortSignal.timeout(105000),
        },
      );
      if (!response.ok) {
        let code;
        try {
          code = (await response.json())?.detail?.status;
        } catch {}
        if (
          code === "quota_exceeded" ||
          code === "insufficient_credits" ||
          response.status === 402
        )
          return fail(402, "ElevenLabs 对齐额度不足，请检查账户额度后重试。");
        if (response.status === 401)
          return fail(401, "ElevenLabs API Key 无效。");
        if (response.status === 403) return fail(403, "密钥缺少音频对齐权限。");
        if (response.status === 429)
          return fail(429, "音频对齐请求过于频繁或并发已满，请稍后重试。");
        if (response.status === 400 || response.status === 422)
          return fail(
            422,
            "音频或英文无法对齐，请检查 MP3 是否损坏、是否与分镜英文一致；可手动校准。",
          );
        return fail(
          502,
          "ElevenLabs 音频对齐服务异常，请稍后重试，原时间轴未修改。",
        );
      }
      const data = await response.json();
      if (
        !Array.isArray(data.words) ||
        !data.words.length ||
        data.words.length > 50000 ||
        data.words.some(
          (w) =>
            !w ||
            typeof w.text !== "string" ||
            !Number.isFinite(w.start) ||
            !Number.isFinite(w.end) ||
            w.start < 0 ||
            w.end < w.start,
        )
      )
        return fail(502, "对齐服务未返回有效时间戳。");
      return res.status(200).json({
        words: data.words.map((w) => ({
          text: w.text,
          start: w.start,
          end: w.end,
        })),
      });
    } catch {
      return fail(502, "音频对齐网络请求失败或超时，未修改原时间轴。");
    }
  };
}
export default createAlignmentHandler();
