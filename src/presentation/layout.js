// Final-frame coordinates, independent of device width. Long content is paginated, never clipped.
export const FRAME_WIDTH = 1080;
export function frameGeometry(style, position, ratio = "9:16") {
  const height = ratio === "16:9" ? 607.5 : ratio === "4:5" ? 1350 : 1920;
  const bottom = (height * position) / 100;
  const top = style.topMargin ?? 48;
  const panelHeight = Math.min(
    height,
    Math.max((height * style.height) / 100, bottom + top + 180),
  );
  return {
    width: FRAME_WIDTH,
    height,
    panelHeight,
    bottom,
    top,
    textWidth: FRAME_WIDTH * 0.8,
    textHeight: panelHeight - bottom - top,
    left: FRAME_WIDTH * 0.1,
  };
}
export function wrapText(text, width, size, measure) {
  if (!text) return [];
  text = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const chars = [...text],
    lines = [];
  let line = "",
    lineWidth = 0,
    lastBreak = -1;
  const charWidth = (c) =>
    measure
      ? measure(c, size) * 1.06
      : (/[\u0000-\u007f]/.test(c) ? 0.66 : 1.08) * size;
  for (const ch of chars) {
    if (ch === "\n") {
      lines.push(line + "\n");
      line = "";
      lineWidth = 0;
      lastBreak = -1;
      continue;
    }
    while (line && lineWidth + charWidth(ch) > width) {
      if (lastBreak >= 0) {
        lines.push(line.slice(0, lastBreak + 1));
        line = line.slice(lastBreak + 1);
        lineWidth = [...line].reduce((n, c) => n + charWidth(c), 0);
      } else {
        lines.push(line);
        line = "";
        lineWidth = 0;
      }
      lastBreak = -1;
    }
    line += ch;
    lineWidth += charWidth(ch);
    if (/\s/.test(ch)) lastBreak = line.length - 1;
  }
  if (line) lines.push(line);
  return lines;
}
export function subtitlePages(
  english,
  chinese,
  mode,
  style,
  geometry,
  measure,
) {
  const en = mode === "zh" ? "" : english,
    zh = mode === "en" ? "" : chinese;
  let englishSize = style.englishSize,
    chineseSize = style.chineseSize;
  let enLines, zhLines, enHeight, zhHeight, total;
  for (;;) {
    enLines = wrapText(en, geometry.textWidth, englishSize, measure);
    zhLines = wrapText(zh, geometry.textWidth, chineseSize, measure);
    enHeight = englishSize * style.englishLineHeight;
    zhHeight = chineseSize * style.chineseLineHeight;
    total =
      enLines.length * enHeight +
      zhLines.length * zhHeight +
      (enLines.length && zhLines.length ? style.gap : 0);
    if (
      total <= geometry.textHeight ||
      (englishSize <= 40 && chineseSize <= 30)
    )
      break;
    englishSize = Math.max(40, englishSize - 2);
    chineseSize = Math.max(30, chineseSize - 2);
  }
  const pages = [];
  let e = 0,
    z = 0;
  while (e < enLines.length || z < zhLines.length) {
    let enCount = e < enLines.length ? 1 : 0,
      zhCount = z < zhLines.length ? 1 : 0;
    let used =
      enCount * enHeight +
      zhCount * zhHeight +
      (enCount && zhCount ? style.gap : 0);
    for (;;) {
      const canEn =
        e + enCount < enLines.length && used + enHeight <= geometry.textHeight;
      const canZh =
        z + zhCount < zhLines.length && used + zhHeight <= geometry.textHeight;
      if (!canEn && !canZh) break;
      if (
        canEn &&
        (!canZh ||
          (enLines.length - e - enCount) * enHeight >=
            (zhLines.length - z - zhCount) * zhHeight)
      ) {
        enCount++;
        used += enHeight;
      } else {
        zhCount++;
        used += zhHeight;
      }
    }
    pages.push({
      english: enLines.slice(e, e + enCount),
      chinese: zhLines.slice(z, z + zhCount),
      height: used,
    });
    e += enCount;
    z += zhCount;
  }
  return {
    pages: pages.length ? pages : [{ english: [], chinese: [], height: 0 }],
    englishSize,
    chineseSize,
  };
}
export function pageAtTime(count, time, start, end) {
  return !Number.isFinite(end) || end <= start
    ? 0
    : Math.max(
        0,
        Math.min(
          count - 1,
          Math.floor(((time - start) / (end - start)) * count),
        ),
      );
}
