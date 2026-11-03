export const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `scene-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function sentences(text, locale = "en") {
  if (!text.trim()) return [];
  if (typeof Intl.Segmenter === "function")
    return [
      ...new Intl.Segmenter(locale, { granularity: "sentence" }).segment(text),
    ]
      .map((x) => x.segment.trim())
      .filter(Boolean);
  return (
    text
      .match(/[^.!?。！？\n]+[.!?。！？]*(?:[”"’']*)/g)
      ?.map((x) => x.trim())
      .filter(Boolean) || []
  );
}
export function splitArticle(english, chinese) {
  const en = sentences(english),
    zh = sentences(chinese, "zh");
  return Array.from({ length: Math.max(en.length, zh.length) }, (_, i) => ({
    id: uid(),
    english: en[i] || "",
    chinese: zh[i] || "",
    description: `分镜 ${i + 1}：请填写场景、人物动作与镜头描述`,
    duration: 5,
  }));
}
export const initialProject = () => ({
  version: 1,
  title: "一场小小的冒险",
  english:
    "Every morning, Emma walked through the quiet forest. One day, she found a tiny light among the trees. She followed it and discovered a world full of wonder.",
  chinese:
    "每天清晨，艾玛都会走过宁静的森林。有一天，她在树林间发现了一点微光。她跟随着它，发现了一个充满奇迹的世界。",
  character: {
    name: "Emma / 艾玛",
    appearance: "棕色短发，明亮的眼睛，充满好奇心的女孩",
    clothing: "米色外套，深绿色背包",
  },
  style: "绘本水彩",
  ratio: "9:16",
  rate: 0.9,
  subtitles: "both",
  scenes: [],
});
export function parseProject(value) {
  const p = typeof value === "string" ? JSON.parse(value) : value;
  const str = (x) => typeof x === "string" && x.length <= 100000;
  if (
    !p ||
    p.version !== 1 ||
    !str(p.title) ||
    !str(p.english) ||
    !str(p.chinese) ||
    !p.character ||
    !["name", "appearance", "clothing"].every((k) => str(p.character[k])) ||
    !["绘本水彩", "电影质感", "温暖插画", "极简剪纸"].includes(p.style) ||
    !["9:16", "16:9"].includes(p.ratio) ||
    !["en", "zh", "both"].includes(p.subtitles) ||
    !Number.isFinite(p.rate) ||
    p.rate < 0.5 ||
    p.rate > 1.5 ||
    !Array.isArray(p.scenes) ||
    p.scenes.length > 500 ||
    !p.scenes.every(
      (s) =>
        s &&
        ["english", "chinese", "description"].every((k) => str(s[k])) &&
        Number.isInteger(s.duration) &&
        s.duration >= 1 &&
        s.duration <= 60,
    )
  )
    throw Error("项目格式不正确，请导入本工作室导出的 V1 JSON 文件。");
  return { ...p, scenes: p.scenes.map((s) => ({ ...s, id: uid() })) };
}
export function downloadProject(project) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.title.replace(/[\\/:*?"<>|]/g, "_") || "story"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
