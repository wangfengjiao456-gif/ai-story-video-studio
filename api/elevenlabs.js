import {
  VOICE_ID,
  MODEL_ID,
  LANGUAGE,
  DEFAULT_SPEED,
  validateSpeechInput,
} from "../src/voiceConfig.js";
export const config = { maxDuration: 60 };
const RESPONSE_LIMIT = 4 * 1024 * 1024; // Below Vercel's 4.5 MB function response limit.
function upstreamError(status, code) {
  if (
    code === "quota_exceeded" ||
    code === "insufficient_credits" ||
    status === 402
  )
    return [402, "QUOTA", "ElevenLabs API 配额不足，请检查账户额度。"];
  if (status === 401 || code === "invalid_api_key")
    return [
      401,
      "INVALID_KEY",
      "ElevenLabs API Key 无效，请在 Vercel 中检查服务器端密钥。",
    ];
  if (status === 403)
    return [
      403,
      "FORBIDDEN",
      "该 API Key 无权使用此声音或模型，请检查声音权限、订阅及密钥的语音生成权限。",
    ];
  if (status === 429)
    return [429, "BUSY", "请求过于频繁或并发已达上限，请稍后重试。"];
  if (status === 404)
    return [
      404,
      "VOICE_NOT_FOUND",
      "固定声音或模型不可用，请确认此 Voice ID 已添加到你的 ElevenLabs 账户。",
    ];
  return [
    502,
    "GENERATION_FAILED",
    "配音生成失败，模型仍为 Eleven v3。请检查文本及账户设置后重试。",
  ];
}
// Dependency injection is used only by offline tests; the browser cannot supply a key or URL.
export function createHandler({
  fetchImpl = globalThis.fetch,
  getKey = () => process.env.ELEVENLABS_API_KEY,
  timeoutMs = 50000,
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, code, message) =>
      res.status(status).json({ error: { code, message } });
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(405, "METHOD", "仅支持 POST 请求。");
    }
    // No wildcard CORS. Reject cross-site requests before spending API credits.
    const origin = req.headers.origin;
    const host = req.headers.host;
    try {
      if (!origin || new URL(origin).host !== host)
        return send(
          403,
          "ORIGIN",
          "请求来源无效，请从本站的 AI 配音页面操作。",
        );
    } catch {
      return send(403, "ORIGIN", "请求来源无效。");
    }
    if (!(req.headers["content-type"] || "").startsWith("application/json"))
      return send(415, "CONTENT_TYPE", "请使用 JSON 请求。");
    let input;
    try {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      input = validateSpeechInput(body?.text, body?.speed ?? DEFAULT_SPEED);
    } catch (err) {
      return send(400, "INPUT", err.message);
    }
    const key = getKey();
    if (!key)
      return send(
        503,
        "NOT_CONFIGURED",
        "API Key 尚未配置。请在 Vercel 服务器端设置 ELEVENLABS_API_KEY，仍可使用浏览器英文朗读。",
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "xi-api-key": key },
          body: JSON.stringify({
            text: input.text,
            model_id: MODEL_ID,
            language_code: LANGUAGE,
            voice_settings: { speed: input.speed },
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        let code;
        try {
          const data = await response.json();
          code = data?.detail?.status;
        } catch {
          /* Never reflect upstream bodies or credentials. */
        }
        return send(...upstreamError(response.status, code));
      }
      // Stream with a byte cap to avoid oversized Vercel responses or unbounded buffering.
      const reader = response.body.getReader();
      let bytes = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > RESPONSE_LIMIT) {
          await reader.cancel();
          return send(
            502,
            "AUDIO_TOO_LARGE",
            "音频过长，无法通过当前服务返回。请缩短文章或逐个分镜生成。",
          );
        }
        chunks.push(value);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        typeof payload.audio_base64 !== "string" ||
        !payload.audio_base64.length ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.audio_base64)
      )
        return send(
          502,
          "INVALID_AUDIO",
          "配音生成失败：服务未返回有效音频。请重试。",
        );
      const result = {
        audio_base64: payload.audio_base64,
        alignment: payload.alignment ?? null,
        normalized_alignment: payload.normalized_alignment ?? null,
        voiceId: VOICE_ID,
        modelId: MODEL_ID,
        speed: input.speed,
        language: LANGUAGE,
      };
      if (Buffer.byteLength(JSON.stringify(result)) > RESPONSE_LIMIT)
        return send(502, "AUDIO_TOO_LARGE", "音频过长，请逐个分镜生成。");
      return res.status(200).json(result);
    } catch {
      return send(
        502,
        "NETWORK",
        "网络请求失败或生成超时，请稍后重试。不会自动重试或切换模型。",
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
export default createHandler();
