import { imageInput } from "../imageConfig.js";
import { prepareReference, validateImageRef } from "./images.js";
export function generationSignature(project, scene) {
  return JSON.stringify([
    imageInput(project, scene),
    project.character.referenceImage?.dataUrl ?? null,
    scene.imageRef?.dataUrl ?? null,
  ]);
}
export async function generateSceneImage(
  project,
  scene,
  { signal, fetchImpl = fetch } = {},
) {
  const input = imageInput(project, scene);
  const reference = project.character.referenceImage
    ? await prepareReference(project.character.referenceImage)
    : null;
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  let response;
  try {
    response = await fetchImpl("/api/openai-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ ...input, reference, confirmed: true }),
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw Error(
      "图片生成网络请求中断，无法确认服务端是否已生成或计费；不会自动重试，请先检查 OpenAI 用量，避免立即重复生成。",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error(
      response.status === 429
        ? "网站或部署平台返回 HTTP 429，未获得 OpenAI 的可识别错误响应。不能确认是 OpenAI 限制；请稍后检查部署日志，不要连续重试。"
        : `图片服务响应不可读（HTTP ${response.status}），无法确认是否已生成或计费；请检查 Vercel 部署日志，不会自动重试。`,
    );
  }
  if (!response.ok)
    throw Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : response.status === 429
          ? "网站或部署平台返回 HTTP 429，未获得 OpenAI 的可识别错误详情；请检查部署日志，不要连续重试。"
          : "图片生成失败，请检查部署日志后决定是否手动重试。",
    );
  if (!data?.imageRef || data.imageRef.kind !== "generated")
    throw Error("服务未返回有效生成图片。");
  validateImageRef(data.imageRef);
  return data.imageRef;
}
