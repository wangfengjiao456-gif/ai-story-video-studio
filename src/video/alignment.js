// Forced alignment validates the supplied transcript; it never estimates speech boundaries.
export const tokens = (text) =>
  (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []
  ).map((x) => x.replaceAll("’", "'"));
export function sceneCues(scenes, words, duration) {
  if (!Array.isArray(words) || !words.length)
    throw Error("对齐服务未返回词时间戳。");
  let previous = 0;
  const actual = words.flatMap((w) => {
    if (!w || typeof w.text !== "string")
      throw Error("服务返回的对齐文本无效，请手动校准。");
    const parts = tokens(w.text);
    if (!parts.length) return [];
    if (
      !Number.isFinite(w.start) ||
      !Number.isFinite(w.end) ||
      w.start < previous ||
      w.end <= w.start ||
      w.end > duration + 0.001
    )
      throw Error("服务返回的时间戳无效，请手动校对。");
    previous = w.end;
    return parts.map((text) => ({ text, start: w.start, end: w.end }));
  });
  let cursor = 0;
  const cues = scenes.map((s, i) => {
    const expected = tokens(s.english);
    if (!expected.length) throw Error(`分镜 ${i + 1} 缺少英文。`);
    const part = actual.slice(cursor, cursor + expected.length);
    if (
      part.length !== expected.length ||
      part.some((w, j) => w.text !== expected[j])
    )
      throw Error(`分镜 ${i + 1} 与返回的对齐文本不一致，请检查 MP3 与英文。`);
    cursor += expected.length;
    return { start: part[0].start, end: part.at(-1).end };
  });
  if (cursor !== actual.length)
    throw Error("音频对齐文本多于分镜，请检查文章与分镜。");
  if (!validateCues(cues, scenes.length, duration))
    throw Error("逐句对齐时间过短、重叠或超出音频，请手动校准。");
  return cues;
}
export function validateCues(cues, count, duration = 600) {
  return (
    Array.isArray(cues) &&
    cues.length === count &&
    Array.from(cues).every(
      (c, i) =>
        c &&
        typeof c === "object" &&
        Number.isFinite(c.start) &&
        Number.isFinite(c.end) &&
        c.start >= 0 &&
        c.end - c.start >= 1 / 30 &&
        c.end <= duration + 0.001 &&
        (!i || c.start >= cues[i - 1].end),
    )
  );
}
