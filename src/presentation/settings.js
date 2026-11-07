export const TEMPLATES = ["picturebook", "immersive"];
export const STYLE_LIMITS = {
  englishSize: [40, 80, 2],
  chineseSize: [30, 64, 2],
  englishLineHeight: [1.2, 1.8, 0.05],
  chineseLineHeight: [1.2, 1.8, 0.05],
  height: [25, 40, 1],
  opacity: [0.85, 1, 0.01],
  gap: [12, 32, 2],
  topMargin: [16, 96, 4],
  stroke: [0, 3, 0.5],
  shadow: [0, 12, 1],
};
export const templateDefaults = (template = "picturebook") => ({
  englishSize: 54,
  chineseSize: 40,
  englishLineHeight: 1.4,
  chineseLineHeight: 1.45,
  height: 32,
  opacity: template === "immersive" ? 0.9 : 1,
  gap: 20,
  topMargin: 48,
  stroke: template === "immersive" ? 1 : 0,
  shadow: template === "immersive" ? 6 : 0,
  englishColor: template === "immersive" ? "#ffffff" : "#173e2e",
  chineseColor: template === "immersive" ? "#f2f1df" : "#405446",
  backgroundColor: "#fff8ec",
  align: "center",
});
export const presentationDefaults = () => ({
  videoTemplate: "picturebook",
  subtitleStyle: templateDefaults(),
  subtitlePosition: 16,
  subtitleSafeArea: false,
});
export const imageDefaults = () => ({
  imageFit: "contain",
  imagePosition: { x: 50, y: 50 },
  imageScale: 1,
});
export function normalizePresentation(p) {
  const defaults = presentationDefaults();
  const template = p.videoTemplate ?? defaults.videoTemplate;
  return {
    ...p,
    videoTemplate: template,
    subtitleStyle: { ...templateDefaults(template), ...p.subtitleStyle },
    subtitlePosition: p.subtitlePosition ?? defaults.subtitlePosition,
    subtitleSafeArea: p.subtitleSafeArea ?? false,
    scenes: p.scenes.map((s) => ({
      ...imageDefaults(),
      ...s,
      imagePosition: { ...imageDefaults().imagePosition, ...s.imagePosition },
    })),
  };
}
export function validatePresentation(p) {
  const fail = () => {
    throw Error("V3 模板、字幕或图片布局设置无效，请检查数值范围后重试。");
  };
  const number = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
  const color = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  if (p.videoTemplate !== undefined && !TEMPLATES.includes(p.videoTemplate))
    fail();
  if (p.subtitlePosition !== undefined && !number(p.subtitlePosition, 4, 20))
    fail();
  if (
    p.subtitleSafeArea !== undefined &&
    typeof p.subtitleSafeArea !== "boolean"
  )
    fail();
  if (p.subtitleStyle !== undefined) {
    const s = p.subtitleStyle;
    if (!s || typeof s !== "object" || Array.isArray(s)) fail();
    for (const [key, [min, max]] of Object.entries(STYLE_LIMITS))
      if (s[key] !== undefined && !number(s[key], min, max)) fail();
    for (const key of ["englishColor", "chineseColor", "backgroundColor"])
      if (s[key] !== undefined && !color(s[key])) fail();
    if (s.align !== undefined && !["center", "left"].includes(s.align)) fail();
  }
  for (const s of p.scenes) {
    if (s.imageFit !== undefined && !["cover", "contain"].includes(s.imageFit))
      fail();
    if (s.imageScale !== undefined && !number(s.imageScale, 1, 2)) fail();
    if (
      s.imagePosition !== undefined &&
      (!s.imagePosition ||
        !number(s.imagePosition.x, 0, 100) ||
        !number(s.imagePosition.y, 0, 100))
    )
      fail();
  }
}
export function presentationRecord(project) {
  const p = normalizePresentation(project),
    s = p.subtitleStyle;
  return {
    videoTemplate: p.videoTemplate,
    subtitleStyle: Object.fromEntries(
      [
        ...Object.keys(STYLE_LIMITS),
        "englishColor",
        "chineseColor",
        "backgroundColor",
        "align",
      ].map((k) => [k, s[k]]),
    ),
    subtitlePosition: p.subtitlePosition,
    subtitleSafeArea: p.subtitleSafeArea,
  };
}
function rgb(hex) {
  return hex
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16));
}
function luminance(c) {
  return c
    .map((x) => {
      x /= 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}
export function safeTextColor(requested, background, opacity, fallback) {
  const backgrounds = [0, 255].map((under) =>
    rgb(background).map((c) => c * opacity + under * (1 - opacity)),
  );
  const works = (color) =>
    backgrounds.every((bg) => contrast(rgb(color), bg) >= 4.5);
  if (works(requested)) return requested;
  if (works(fallback)) return fallback;
  return ["#000000", "#ffffff"].sort(
    (a, b) =>
      Math.min(...backgrounds.map((bg) => contrast(rgb(b), bg))) -
      Math.min(...backgrounds.map((bg) => contrast(rgb(a), bg))),
  )[0];
}
