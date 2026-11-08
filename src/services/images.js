import { IMAGE_MODEL } from "../imageConfig.js";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_REFERENCE_BYTES = 600 * 1024;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
function dimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
  )
    return {
      mime: "image/png",
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1];
      offset += 2;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      )
        return {
          mime: "image/jpeg",
          width: view.getUint16(offset + 5),
          height: view.getUint16(offset + 3),
        };
      offset += length;
    }
  }
  if (
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    const type = String.fromCharCode(...bytes.slice(12, 16));
    if (type === "VP8X")
      return {
        mime: "image/webp",
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    if (
      type === "VP8 " &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    )
      return {
        mime: "image/webp",
        width: view.getUint16(26, true) & 16383,
        height: view.getUint16(28, true) & 16383,
      };
    if (type === "VP8L" && bytes[20] === 47)
      return {
        mime: "image/webp",
        width: 1 + (((bytes[22] & 63) << 8) | bytes[21]),
        height:
          1 +
          (((bytes[24] & 15) << 10) |
            (bytes[23] << 2) |
            ((bytes[22] & 192) >> 6)),
      };
  }
  throw Error(
    "图片格式无法识别。仅支持真实的 JPG、PNG、WebP，不支持 SVG、GIF 或远程链接。",
  );
}
export function inspectImage(bytes) {
  const info = dimensions(bytes);
  if (
    !info.width ||
    !info.height ||
    info.width > 12000 ||
    info.height > 12000 ||
    info.width * info.height > 16000000
  )
    throw Error("图片尺寸过大（最多 1,600 万像素），请先缩小图片。");
  return info;
}
export function validateImageRef(ref) {
  if (ref === undefined || ref === null) return;
  if (
    !["upload", "generated"].includes(ref.kind) ||
    typeof ref.dataUrl !== "string" ||
    ref.dataUrl.length > (MAX_IMAGE_BYTES * 4) / 3 + 40
  )
    throw Error("图片引用无效或超过 8 MB，请重新上传图片。");
  if (
    ref.kind === "generated" &&
    (ref.model !== IMAGE_MODEL || typeof ref.referenceUsed !== "boolean")
  )
    throw Error("生成图片元数据无效。");
  const match = ref.dataUrl.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!match)
    throw Error("只允许项目内嵌 JPG、PNG 或 WebP 图片，禁止外部 URL 和 SVG。");
  let bytes;
  try {
    bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  } catch {
    throw Error("图片数据无法解码，请重新上传。");
  }
  const info = inspectImage(bytes);
  if (info.mime !== match[1] || bytes.length > MAX_IMAGE_BYTES)
    throw Error("图片内容与声明格式不一致，或超过 8 MB。");
}
export function imageRecord(scene) {
  return scene.imageRef
    ? {
        imageRef: {
          kind: scene.imageRef.kind,
          dataUrl: scene.imageRef.dataUrl,
          ...(scene.imageRef.kind === "generated"
            ? {
                model: scene.imageRef.model,
                referenceUsed: !!scene.imageRef.referenceUsed,
              }
            : {}),
        },
      }
    : {};
}
export async function prepareReferenceFile(file) {
  if (!file || file.size > MAX_UPLOAD_BYTES)
    throw Error("图片文件最多 8 MB，请先压缩或缩小。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  inspectImage(bytes);
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () =>
        reject(Error("图片无法解码，请换一张 JPG、PNG 或 WebP。"));
      image.src = url;
    });
    if (image.naturalWidth * image.naturalHeight > 16000000)
      throw Error("图片像素过大，请先缩小。");
    const scale = Math.min(
      1,
      1440 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("浏览器暂不支持图片处理。");
    ctx.fillStyle = "#fff8ec";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const ref = { kind: "upload", dataUrl };
      try {
        validateImageRef(ref);
        if (dataUrl.length > (MAX_REFERENCE_BYTES * 4) / 3 + 40)
          throw Error("参考图仍然过大");
        return ref;
      } catch {
        /* Try lower JPEG quality; never bypass validation. */
      }
    }
    throw Error("压缩后图片仍超过 8 MB，请选择更简单或更小的图片。");
  } finally {
    URL.revokeObjectURL(url);
  }
}
// V4 integration point: providers may later return a validated imageRef; no AI image generation exists in V3.

export async function decodeUploadedImage(file) {
  const url = URL.createObjectURL(file),
    image = new Image();
  let timer;
  try {
    await new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          Error(
            "图片无法解码，原图片未替换。请使用完整的 JPG、PNG 或 WebP 文件。",
          ),
        );
      timer = setTimeout(
        () => reject(Error("图片解码超时，原图片未替换，请换较小图片。")),
        15000,
      );
      image.src = url;
    });
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 16000000
    )
      throw Error("图片实际尺寸无效或过大，原图片未替换。");
  } finally {
    clearTimeout(timer);
    image.onload = null;
    image.onerror = null;
    image.src = "";
    URL.revokeObjectURL(url);
  }
}
export async function uploadImage(file, { decode = decodeUploadedImage } = {}) {
  if (!file || file.size > MAX_UPLOAD_BYTES) throw Error("图片文件最多 8 MB。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = inspectImage(bytes);
  await decode(file);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.slice(i, i + 32768));
  const ref = {
    kind: "upload",
    dataUrl: `data:${info.mime};base64,${btoa(binary)}`,
  };
  validateImageRef(ref);
  return ref;
}
export async function prepareReference(ref) {
  validateImageRef(ref);
  const [header, base64] = ref.dataUrl.split(",");
  const type = header.slice(5, header.indexOf(";"));
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (bytes.length <= MAX_REFERENCE_BYTES) return ref;
  return prepareReferenceFile(new Blob([bytes], { type }));
}

export async function verifyProjectImages(
  project,
  { isCurrent = () => true, decode = decodeUploadedImage } = {},
) {
  const entries = project.scenes.map((scene, i) => ({
    ref: scene.imageRef,
    label: `分镜 ${i + 1}`,
  }));
  if (project.cover?.imageRef)
    entries.push({ ref: project.cover.imageRef, label: "封面00" });
  if (project.character.referenceImage)
    entries.push({
      ref: project.character.referenceImage,
      label: "人物参考图",
    });
  const seen = new Set();
  for (const { ref, label } of entries) {
    if (!isCurrent()) return false;
    if (!ref || seen.has(ref.dataUrl)) continue;
    seen.add(ref.dataUrl);
    const [header, base64] = ref.dataUrl.split(",");
    try {
      await decode(
        new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], {
          type: header.slice(5, header.indexOf(";")),
        }),
      );
    } catch (error) {
      throw Error(`${label}图片无法读取，原项目未替换。${error.message}`);
    }
  }
  return isCurrent();
}
