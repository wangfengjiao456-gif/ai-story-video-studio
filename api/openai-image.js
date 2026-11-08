import OpenAI, { toFile } from "openai";
import {
  IMAGE_MODEL,
  IMAGE_QUALITY,
  imageSize,
  imagePrompt,
  validateImageInput,
} from "../src/imageConfig.js";
import {
  validateImageRef,
  MAX_REFERENCE_BYTES,
  inspectImage,
} from "../src/services/images.js";
export const config = { maxDuration: 120 };
export function createImageHandler({
  getKey = () => process.env.OPENAI_API_KEY,
  createClient = (key) =>
    new OpenAI({
      apiKey: key,
      baseURL: "https://api.openai.com/v1",
      maxRetries: 0,
      timeout: 105000,
    }),
} = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const fail = (status, code, message) =>
      res.status(status).json({ error: { code, message } });
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return fail(405, "METHOD", "仅支持 POST 请求。");
    }
    try {
      if (
        !req.headers.origin ||
        new URL(req.headers.origin).host !== req.headers.host
      )
        return fail(403, "ORIGIN", "请从本站图片生成按钮操作。");
    } catch {
      return fail(403, "ORIGIN", "请求来源无效。");
    }
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return fail(415, "TYPE", "请使用 JSON 请求。");
    let input, reference, body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      input = validateImageInput(body);
      if (body.confirmed !== true)
        throw Error("请先确认单张生成操作及费用提示。");
      reference = body.reference ?? null;
      if (reference) {
        validateImageRef(reference);
        if (reference.dataUrl.length > (MAX_REFERENCE_BYTES * 4) / 3 + 40)
          throw Error("人物参考图过大，请重新处理参考图。");
      }
    } catch (err) {
      return fail(400, "INPUT", err.message);
    }
    const key = getKey();
    if (!key)
      return fail(
        503,
        "NOT_CONFIGURED",
        "OpenAI 图片 API 尚未配置，请在 Vercel 服务端设置 OPENAI_API_KEY。其他功能仍可使用。",
      );
    try {
      const client = createClient(key),
        options = {
          model: IMAGE_MODEL,
          prompt: imagePrompt(input),
          n: 1,
          quality: IMAGE_QUALITY,
          size: imageSize(input.ratio),
          output_format: "jpeg",
          output_compression: 80,
        };
      let result;
      if (reference) {
        const parts = reference.dataUrl.split(",");
        const bytes = Buffer.from(parts[1], "base64");
        const mime = parts[0].slice(5, parts[0].indexOf(";"));
        result = await client.images.edit({
          ...options,
          image: await toFile(
            bytes,
            "character." + (mime === "image/jpeg" ? "jpg" : mime.split("/")[1]),
            { type: mime },
          ),
        });
      } else result = await client.images.generate(options);
      const b64 = result?.data?.[0]?.b64_json;
      if (
        typeof b64 !== "string" ||
        !b64.length ||
        b64.length > 3 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)
      )
        return fail(
          502,
          "INVALID_IMAGE",
          "生成结果为空或过大，请稍后手动重试。原图片未被替换。",
        );
      const bytes = Buffer.from(b64, "base64");
      const info = inspectImage(bytes);
      if (info.mime !== "image/jpeg")
        return fail(
          502,
          "INVALID_FORMAT",
          "图片返回格式异常，原图片未被替换。",
        );
      return res.status(200).json({
        imageRef: {
          kind: "generated",
          dataUrl: `data:image/jpeg;base64,${b64}`,
          model: IMAGE_MODEL,
          referenceUsed: !!reference,
        },
      });
    } catch (err) {
      // Classify provider metadata only; never reflect raw messages, headers or keys.
      const codes = [err.code, err.type, err.error?.code, err.error?.type];
      const has = (...values) => codes.some((code) => values.includes(code));
      if (
        has(
          "insufficient_quota",
          "billing_hard_limit_reached",
          "billing_not_active",
          "usage_limit_reached",
        ) ||
        err.status === 402
      )
        return fail(
          402,
          "QUOTA",
          "OpenAI API 额度或账单限制：请检查此密钥所属项目的 API 余额、预算及账单状态。ChatGPT 订阅不等于 API 额度；仅等待通常不能解决。网站未自动重试。",
        );
      if (err.status === 401)
        return fail(401, "KEY", "OPENAI_API_KEY 无效，请检查服务端密钥。");
      if (
        err.status === 404 ||
        has("model_not_found", "invalid_model", "unsupported_model")
      )
        return fail(
          404,
          "MODEL_UNAVAILABLE",
          "OpenAI 图片模型不存在或当前项目无权访问该模型。请检查模型权限及组织验证；等待或重复点击通常无效，不会自动更换模型。",
        );
      if (err.status === 403)
        return fail(
          403,
          "PERMISSION",
          "图片模型权限不足或模型不可用，请检查项目权限及组织验证。不会自动更换模型。",
        );
      if (err.status === 429) {
        const retry = err.headers?.get?.("retry-after");
        const numeric =
          typeof retry === "string" && /^\d+(?:\.\d+)?$/.test(retry.trim())
            ? Number(retry)
            : NaN;
        const seconds =
          Number.isFinite(numeric) && numeric > 0 && numeric <= 86400
            ? Math.ceil(numeric)
            : null;
        if (seconds) res.setHeader("Retry-After", String(seconds));
        const detail = has("rate_limit_exceeded")
          ? "OpenAI 返回项目或模型速率限制（429）。共享项目的其他请求或低速率配额也可能让首次请求失败，并非判定你重复点击。"
          : "OpenAI 返回 429，但未提供可识别的限制类型；无法确认是临时速率限制还是账户额度限制，并非网站判定你重复点击。";
        return fail(
          429,
          has("rate_limit_exceeded")
            ? "OPENAI_RATE_LIMIT"
            : "OPENAI_429_UNKNOWN",
          `${detail}${seconds ? `服务建议至少等待 ${seconds} 秒后手动重试。` : "请先检查 OpenAI 项目的 Limits 和 Billing，再决定是否等待后手动重试。"}网站不会自动重试，请勿连续点击。`,
        );
      }
      if (err.code === "content_policy_violation" || err.status === 400)
        return fail(
          400,
          "REJECTED",
          "图片请求未被接受，请检查描述或参考图后重试。",
        );
      return fail(
        502,
        "FAILED",
        "图片生成失败或网络超时。原图片保留，不会自动重试；超时请求仍可能计费。",
      );
    }
  };
}
export default createImageHandler();
