// Free, origin-scoped local media journal. Never stores credentials or sends media to a database service.
const DB = "story-studio-paid-media-v4",
  STORE = "results";
export async function mediaKey(kind, signature) {
  const bytes = new TextEncoder().encode(signature);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `${kind}:${Array.from(new Uint8Array(hash), (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
export function mediaTransaction(
  key,
  value,
  { factory = globalThis.indexedDB, timeoutMs = 8000 } = {},
) {
  return new Promise((resolve, reject) => {
    if (!factory) {
      if (value === undefined) return resolve(null);
      return reject(
        Error("此浏览器无法使用本机媒体备份；请下载原文件和JSON。"),
      );
    }
    let db,
      tx,
      done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      db?.close();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        tx?.abort();
      } catch {}
      finish(Error("本机媒体备份超时，请先下载原文件。"));
    }, timeoutMs);
    let request;
    try {
      request = factory.open(DB, 1);
    } catch {
      return finish(Error("本机媒体存储权限不足，请下载原文件。"));
    }
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onerror = () =>
      finish(Error("无法打开本机媒体备份，请下载原文件。"));
    request.onblocked = () =>
      finish(Error("其他标签页阻止了媒体备份，请先下载原文件。"));
    request.onsuccess = () => {
      db = request.result;
      if (done) {
        db.close();
        return;
      }
      try {
        tx = db.transaction(
          STORE,
          value === undefined ? "readonly" : "readwrite",
        );
        const store = tx.objectStore(STORE);
        let result;
        const operation =
          value === undefined ? store.get(key) : store.put(value, key);
        operation.onsuccess = () => {
          result = operation.result;
        };
        tx.oncomplete = () =>
          finish(null, value === undefined ? result || null : true);
        tx.onerror = () =>
          finish(Error("本机媒体备份失败，可能空间不足；请下载原文件。"));
        tx.onabort = () => finish(Error("本机媒体备份未完成，请下载原文件。"));
      } catch {
        finish(Error("本机媒体备份失败，请下载原文件。"));
      }
    };
  });
}
export const readMedia = (key) => mediaTransaction(key);
export const writeMedia = (key, value) => mediaTransaction(key, value);
export function cachedVoiceRecord(asset) {
  const alignment = (a) =>
    a
      ? Object.fromEntries(
          Object.entries(a).filter(([key]) =>
            [
              "characters",
              "character_start_times_seconds",
              "character_end_times_seconds",
            ].includes(key),
          ),
        )
      : null;
  return {
    kind: "voice",
    blob: asset.blob,
    text: asset.text,
    speed: asset.speed,
    fingerprint: asset.fingerprint,
    alignment: alignment(asset.alignment),
    normalizedAlignment: alignment(asset.normalizedAlignment),
  };
}

export const voiceCacheKey = (asset) =>
  mediaKey(
    "voice",
    JSON.stringify([asset.fingerprint, asset.text.trim(), asset.speed]),
  );
