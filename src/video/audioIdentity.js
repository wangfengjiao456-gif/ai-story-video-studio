// Content identity survives refresh; blob URLs and file lengths do not identify audio.
export async function audioFingerprint(blob) {
  const bytes = await blob.arrayBuffer();
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export function assertPreparedAudio(
  prepared,
  currentAssets,
  speed,
  external = false,
) {
  if (!prepared) return;
  if (prepared.speed !== speed)
    throw Error(
      "语速已修改，旧音频及时间轴已停用，请重新生成或导入音频并准备视频。",
    );
  if (!external) {
    const keys =
      prepared.source === "article"
        ? ["article"]
        : Object.keys(prepared.assets).filter((k) => k !== "article");
    for (const key of keys)
      if (prepared.assets[key]?.url !== currentAssets[key]?.url)
        throw Error("配音已重新生成或移除，请重新准备视频；旧音频快照已停用。");
  }
}
