import { validateCues } from "./video/alignment.js";
import {
  normalizePresentation,
  validatePresentation,
  presentationRecord,
  imageDefaults,
  presentationDefaults,
} from "./presentation/settings.js";
import { validateImageRef, imageRecord } from "./services/images.js";
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
  ...presentationDefaults(),
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
// All limits use UTF-16 code units, matching JavaScript strings and editor counts.
export const TEXT_LIMIT = 100000;
export const TITLE_LIMIT = 120;
export const PROJECT_BYTES_LIMIT = 5 * 1024 * 1024;
export function textError(value, label, limit = TEXT_LIMIT) {
  if (typeof value !== "string") return `${label}必须是文本。`;
  if (value.length > limit)
    return `${label}超过 ${limit.toLocaleString("en-US")} 字符限制（当前 ${value.length.toLocaleString("en-US")}），请缩短后再保存或导出。`;
  return "";
}
export function validateProject(p, { recovery = false } = {}) {
  const str = (value, label, limit) => {
    const error = textError(value, label, recovery ? Infinity : limit);
    if (error) throw Error(error);
  };
  if (
    !p ||
    typeof p !== "object" ||
    p.version !== 1 ||
    !p.character ||
    !Array.isArray(p.scenes) ||
    p.scenes.length > 500 ||
    !["绘本水彩", "电影质感", "温暖插画", "极简剪纸"].includes(p.style) ||
    !["9:16", "16:9", "4:5"].includes(p.ratio) ||
    !["en", "zh", "both"].includes(p.subtitles) ||
    !Number.isFinite(p.rate) ||
    p.rate < 0.5 ||
    p.rate > 1.5
  )
    throw Error("项目格式不正确，请导入本工作室导出的 V1 JSON 文件。");
  str(p.title, "项目名称", TITLE_LIMIT);
  str(p.english, "英文文章", TEXT_LIMIT);
  str(p.chinese, "中文译文", TEXT_LIMIT);
  for (const [key, label] of [
    ["name", "人物名称"],
    ["appearance", "外貌特征"],
    ["clothing", "固定服装"],
  ])
    str(p.character[key], label, TEXT_LIMIT);
  p.scenes.forEach((scene, i) => {
    if (
      !scene ||
      !Number.isInteger(scene.duration) ||
      scene.duration < 1 ||
      scene.duration > 60
    )
      throw Error(`分镜 ${i + 1} 的时长必须为 1–60 秒的整数。`);
    for (const [key, label] of [
      ["english", "英文"],
      ["chinese", "中文"],
      ["description", "画面描述"],
    ])
      str(scene[key], `分镜 ${i + 1} ${label}`, TEXT_LIMIT);
  });
  if (p.videoTiming !== undefined && p.videoTiming !== null) {
    const t = p.videoTiming;
    const valid = t.cues
      ? Array.isArray(t.cues) &&
        t.cues.length > 0 &&
        t.cues.length <= 500 &&
        validateCues(t.cues, t.cues.length)
      : Array.isArray(t.boundaries) &&
        t.boundaries.length === p.scenes.length + 1 &&
        t.boundaries[0] === 0 &&
        t.boundaries.every(
          (v, i) =>
            Number.isFinite(v) &&
            v >= 0 &&
            v <= 600 &&
            (!i || v > t.boundaries[i - 1]),
        );
    if (
      typeof t.signature !== "string" ||
      t.signature.length > 100 ||
      !valid ||
      (t.source !== undefined && !["forced", "manual"].includes(t.source))
    )
      throw Error("手动视频时间轴无效。");
  }
  validatePresentation(p);
  for (const scene of p.scenes) validateImageRef(scene.imageRef);
  validateImageRef(p.character.referenceImage);
  return p;
}
export function serializeProject(project) {
  validateProject(project);
  // Persist supported V1–V3 content. Scene IDs are editor identity, regenerated on import.
  const {
    version,
    title,
    english,
    chinese,
    character,
    style,
    ratio,
    rate,
    subtitles,
    scenes,
  } = project;
  const raw = JSON.stringify({
    ...presentationRecord(project),
    ...(project.videoTiming
      ? {
          videoTiming: {
            signature: project.videoTiming.signature,
            ...(project.videoTiming.cues
              ? {
                  cues: project.videoTiming.cues.map((c) => ({
                    start: c.start,
                    end: c.end,
                  })),
                  source: project.videoTiming.source,
                }
              : { boundaries: project.videoTiming.boundaries }),
          },
        }
      : {}),
    version,
    title,
    english,
    chinese,
    character: {
      name: character.name,
      appearance: character.appearance,
      clothing: character.clothing,
      ...(character.referenceImage
        ? {
            referenceImage: imageRecord({ imageRef: character.referenceImage })
              .imageRef,
          }
        : {}),
    },
    style,
    ratio,
    rate,
    subtitles,
    scenes: scenes.map((scene) => ({
      english: scene.english,
      chinese: scene.chinese,
      description: scene.description,
      duration: scene.duration,
      ...imageRecord(scene),
      imageFit: scene.imageFit ?? imageDefaults().imageFit,
      imagePosition: {
        x: scene.imagePosition?.x ?? 50,
        y: scene.imagePosition?.y ?? 50,
      },
      imageScale: scene.imageScale ?? 1,
    })),
  });
  if (new TextEncoder().encode(raw).byteLength > PROJECT_BYTES_LIMIT)
    throw Error("项目总大小超过 5 MB，请缩短文本或减少分镜后再保存或导出。");
  return raw;
}
export function parseProject(value) {
  if (
    typeof value === "string" &&
    new TextEncoder().encode(value).byteLength > PROJECT_BYTES_LIMIT
  )
    throw Error("项目总大小超过 5 MB，请缩短文本或减少分镜后再保存或导出。");
  let p;
  try {
    p = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw Error("JSON 无法解析，原有内容未被修改。");
  }
  serializeProject(p);
  return normalizePresentation({
    ...p,
    scenes: p.scenes.map((s) => ({ ...s, id: uid() })),
  });
}
// Recovery only: retain over-limit legacy text in the editor without permitting a save.
export function recoverProject(raw) {
  try {
    const p = validateProject(JSON.parse(raw), { recovery: true });
    return normalizePresentation({
      ...p,
      scenes: p.scenes.map((s) => ({ ...s, id: uid() })),
    });
  } catch {
    return null;
  }
}
export function downloadText(raw, filename) {
  const url = URL.createObjectURL(
    new Blob([raw], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function downloadProject(project) {
  const raw = serializeProject(project);
  downloadText(
    raw,
    `${project.title.replace(/[\\/:*?"<>|]/g, "_") || "story"}.json`,
  );
}
