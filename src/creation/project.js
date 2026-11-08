import { cleanAssistant } from "../assistant/schema.js";
import { validatePlan, cleanPlan } from "./planSchema.js";
import { validateImageRef, imageRecord } from "../services/images.js";
export { SIGNATURE_STYLE, STYLE_PROMPT } from "./style.js";
export const musicDefaults = () => ({
  enabled: false,
  volume: 0.1,
  duck: 0.25,
  fade: 2,
  recommendation: "轻柔、无歌词的原声或钢琴",
});
export const coverDefaults = () => ({
  enabled: false,
  title: "",
  englishTitle: "",
  prompt: "",
  duration: 3,
  imageFit: "contain",
  imageScale: 1,
  imagePosition: { x: 50, y: 50 },
});
export function coverScene(p) {
  return {
    ...coverDefaults(),
    ...p.cover,
    id: "cover-00",
    english: p.cover?.englishTitle || "",
    chinese: p.cover?.title || p.title,
    description: p.cover?.prompt || "",
    duration: p.cover?.duration || 3,
  };
}
export function validateCreation(p) {
  if (p.assistant !== undefined) cleanAssistant(p.assistant);
  if (
    p.voiceRecords !== undefined &&
    (!Array.isArray(p.voiceRecords) ||
      p.voiceRecords.length > 100 ||
      !p.voiceRecords.every(
        (r) =>
          r &&
          typeof r.key === "string" &&
          r.key.length < 100 &&
          typeof r.text === "string" &&
          r.text.length <= 100000 &&
          Number.isFinite(r.speed) &&
          r.speed >= 0.7 &&
          r.speed <= 1.2 &&
          typeof r.fingerprint === "string" &&
          /^[a-f0-9]{64}$/.test(r.fingerprint),
      ))
  )
    throw Error("音频恢复记录无效。");
  if (p.creationDraft !== undefined) {
    const d = p.creationDraft;
    if (
      !d ||
      !["local", "ai"].includes(d.source) ||
      typeof d.signature !== "string" ||
      d.signature.length > 8 * 1024 * 1024 ||
      !Array.isArray(d.plan?.beats) ||
      !d.plan.beats.length ||
      d.plan.beats.length > 30
    )
      throw Error("规划草稿无效。");
    validatePlan(d.plan, d.plan.beats.length);
  }

  const text = (x, max = 3000) => typeof x === "string" && x.length <= max;
  if (p.cover !== undefined) {
    const c = p.cover;
    if (
      !c ||
      typeof c.enabled !== "boolean" ||
      !text(c.title, 120) ||
      !text(c.englishTitle, 120) ||
      !text(c.prompt) ||
      !Number.isFinite(c.duration) ||
      c.duration < 1 ||
      c.duration > 10 ||
      !["contain", "cover"].includes(c.imageFit) ||
      !Number.isFinite(c.imageScale) ||
      c.imageScale < 1 ||
      c.imageScale > 2 ||
      !c.imagePosition ||
      !["x", "y"].every(
        (k) =>
          Number.isFinite(c.imagePosition[k]) &&
          c.imagePosition[k] >= 0 &&
          c.imagePosition[k] <= 100,
      )
    )
      throw Error("封面设置无效。");
    validateImageRef(c.imageRef);
  }
  if (p.music !== undefined) {
    const m = p.music;
    if (
      !m ||
      typeof m.enabled !== "boolean" ||
      !Number.isFinite(m.volume) ||
      m.volume < 0 ||
      m.volume > 0.4 ||
      !Number.isFinite(m.duck) ||
      m.duck < 0 ||
      m.duck > 1 ||
      !Number.isFinite(m.fade) ||
      m.fade < 0 ||
      m.fade > 5 ||
      !text(m.recommendation, 200)
    )
      throw Error("背景音乐设置无效。");
  }
  if (p.creation !== undefined) {
    const c = p.creation;
    if (
      !c ||
      !["local", "ai"].includes(c.source) ||
      !Array.isArray(c.characters) ||
      c.characters.length > 8 ||
      !c.characters.every(
        (x) =>
          x &&
          ["name", "appearance", "clothing"].every((k) => text(x[k], 2000)),
      ) ||
      !text(c.mood, 200) ||
      !Array.isArray(c.beats) ||
      c.beats.length > 100 ||
      !c.beats.every(
        (x) =>
          x &&
          ["scene", "action", "expression", "camera"].every((k) =>
            text(x[k], 1000),
          ),
      )
    )
      throw Error("智能规划数据无效。");
  }
}
export function creationRecord(p) {
  return {
    ...(p.assistant ? {assistant:cleanAssistant(p.assistant)} : {}),
    ...(p.voiceRecords
      ? {
          voiceRecords: p.voiceRecords.map((r) => ({
            key: r.key,
            text: r.text,
            speed: r.speed,
            fingerprint: r.fingerprint,
          })),
        }
      : {}),
    ...(p.creationDraft
      ? {
          creationDraft: {
            source: p.creationDraft.source,
            signature: p.creationDraft.signature,
            plan: cleanPlan(p.creationDraft.plan),
          },
        }
      : {}),
    ...(p.cover
      ? {
          cover: {
            ...coverDefaults(),
            enabled: p.cover.enabled,
            title: p.cover.title,
            englishTitle: p.cover.englishTitle,
            prompt: p.cover.prompt,
            duration: p.cover.duration,
            imageFit: p.cover.imageFit,
            imageScale: p.cover.imageScale,
            imagePosition: { ...p.cover.imagePosition },
            ...imageRecord(p.cover),
          },
        }
      : {}),
    ...(p.music
      ? {
          music: {
            enabled: p.music.enabled,
            volume: p.music.volume,
            duck: p.music.duck,
            fade: p.music.fade,
            recommendation: p.music.recommendation,
          },
        }
      : {}),
    ...(p.creation
      ? {
          creation: {
            source: p.creation.source,
            mood: p.creation.mood,
            characters: p.creation.characters.map((c) => ({
              name: c.name,
              appearance: c.appearance,
              clothing: c.clothing,
            })),
            beats: p.creation.beats.map((b) => ({
              scene: b.scene,
              action: b.action,
              expression: b.expression,
              camera: b.camera,
            })),
          },
        }
      : {}),
  };
}
