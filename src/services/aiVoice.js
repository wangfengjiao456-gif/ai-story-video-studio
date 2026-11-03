import { validateSpeechInput } from "../voiceConfig.js";
export async function generateSpeech(
  text,
  speed,
  { signal, fetchImpl = fetch } = {},
) {
  const input = validateSpeechInput(text, speed);
  let response;
  try {
    response = await fetchImpl("/api/elevenlabs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw Error("网络请求失败，请检查网络后重试。");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error(
      "配音服务不可用。请使用 Vercel 预览或 vercel dev；普通 Vite 静态服务不运行 API。",
    );
  }
  if (!response.ok)
    throw Error(data?.error?.message || "配音生成失败，请稍后重试。");
  if (typeof data?.audio_base64 !== "string" || !data.audio_base64.length)
    throw Error("配音生成失败：未收到音频。");
  let binary;
  try {
    binary = atob(data.audio_base64);
  } catch {
    throw Error("配音生成失败：音频数据无效，请重试。");
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return {
    blob: new Blob([bytes], { type: "audio/mpeg" }),
    alignment: data.alignment,
    normalizedAlignment: data.normalized_alignment,
  };
}
export function isFresh(asset, text, speed) {
  return !!asset && asset.text === text.trim() && asset.speed === speed;
}
const compact = (text) => text.replace(/\s+/g, "");
function validAlignment(a, text, duration) {
  if (
    !a ||
    !Array.isArray(a.characters) ||
    !a.characters.every((c) => typeof c === "string" && c.length > 0) ||
    a.characters.join("") !== text
  )
    return false;
  const starts = a.character_start_times_seconds,
    ends = a.character_end_times_seconds;
  if (
    !Array.isArray(starts) ||
    !Array.isArray(ends) ||
    starts.length !== a.characters.length ||
    ends.length !== starts.length ||
    !starts.length
  )
    return false;
  return (
    starts.every(
      (s, i) =>
        Number.isFinite(s) &&
        Number.isFinite(ends[i]) &&
        s >= 0 &&
        ends[i] >= s &&
        ends[i] <= duration + 0.25 &&
        (!i || (s >= starts[i - 1] && ends[i] >= ends[i - 1])),
    ) && ends.at(-1) > 0
  );
}
export function articleTimeline(text, scenes, asset) {
  if (
    !asset ||
    !Number.isFinite(asset.duration) ||
    asset.duration <= 0 ||
    !scenes.length
  )
    return { mode: "unavailable", ranges: [] };
  const duration = asset.duration;
  const matching =
    scenes.every((s) => s.english.trim()) &&
    compact(scenes.map((s) => s.english).join("")) === compact(text);
  const a = [asset.alignment, asset.normalizedAlignment].find((a) =>
    validAlignment(a, text, duration),
  );
  if (matching && a) {
    const chars = a.characters;
    const positions = [];
    for (let i = 0; i < chars.length; i++) {
      for (const c of chars[i]) {
        if (!/\s/.test(c)) positions.push(i);
      }
    }
    let cursor = 0;
    const ranges = scenes.map((scene, i) => {
      const length = [...compact(scene.english)].length;
      const first = positions[cursor];
      cursor += length;
      const last = positions[cursor - 1];
      return {
        index: i,
        start: i === 0 ? 0 : a.character_start_times_seconds[first],
        end: a.character_end_times_seconds[last],
      };
    });
    if (
      ranges.every(
        (r, i) =>
          r.end > r.start && (!i || r.start >= ranges[i - 1].end - 0.01),
      )
    ) {
      ranges.forEach(
        (r, i) =>
          (r.end = i + 1 < ranges.length ? ranges[i + 1].start : duration),
      );
      return { mode: "aligned", ranges };
    }
  }
  const weights = scenes.map((s) =>
    Math.max(1, s.english.trim().split(/\s+/).filter(Boolean).length),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return {
    mode: "estimated",
    reason: matching
      ? "未获得可验证的字符对齐数据"
      : "文章与分镜英文不完全对应",
    ranges: weights.map((weight, index) => {
      const start = cursor;
      cursor += (weight / total) * duration;
      return {
        index,
        start,
        end: index === weights.length - 1 ? duration : cursor,
      };
    }),
  };
}
export function indexAtTime(ranges, time) {
  return (
    ranges.find((r) => time >= r.start && time < r.end)?.index ??
    ranges.at(-1)?.index ??
    0
  );
}
