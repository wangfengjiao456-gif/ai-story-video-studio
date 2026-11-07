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
    throw Error("图片生成网络请求失败，请检查网络后手动重试。");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error("图片服务暂不可用，请使用 Vercel Preview 或 vercel dev。");
  }
  if (!response.ok)
    throw Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : "图片生成失败，请手动重试。",
    );
  if (!data?.imageRef || data.imageRef.kind !== "generated")
    throw Error("服务未返回有效生成图片。");
  validateImageRef(data.imageRef);
  return data.imageRef;
}
