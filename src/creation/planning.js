import { STYLE_OPTIONS } from "./style.js";
import {
  coverDefaults,
  musicDefaults,
  SIGNATURE_STYLE,
  STYLE_PROMPT,
} from "./project.js";
export const PLAN_MODEL = "gpt-5-mini";
export const planningSignature = (p) =>
  JSON.stringify([
    p.english,
    p.chinese,
    p.scenes.map((s) => [s.english, s.chinese, s.description]),
    [p.character.name, p.character.appearance, p.character.clothing],
    p.style,
  ]);
export { PLAN_SCHEMA, validatePlan } from "./planSchema.js";
import { validatePlan } from "./planSchema.js";
export function localPlan(p) {
  const c = {
    name: p.character.name || "Main character",
    appearance:
      p.character.appearance || "A young learner with short dark hair",
    clothing: p.character.clothing || "A cream jacket and sage-green backpack",
  };
  const identity = JSON.stringify(c),
    title =
      (p.chinese.split(/[。！？\n]/)[0] || p.title).slice(0, 24) ||
      "一步一步向前";
  return validatePlan(
    {
      title,
      englishTitle: "",
      style: p.style,
      mood: "温柔、平静",
      musicRecommendation: "轻柔、无歌词的原声或钢琴",
      characters: [c],
      coverPrompt: `Vertical picturebook cover, ${identity}. Visually summarize: ${p.english.slice(0, 600)}. Keep central lower space quiet for a separately drawn title. ${p.style === SIGNATURE_STYLE ? STYLE_PROMPT : p.style} No text, no watermark.`,
      beats: p.scenes.map((s, i) => ({
        index: i + 1,
        scene: `故事片段 ${i + 1}：${s.chinese || s.english}`,
        action: s.english,
        expression: "根据情境呈现自然、简洁的表情",
        camera:
          i % 3 === 0
            ? "Wide establishing view"
            : i % 3 === 1
              ? "Medium shot, clear character action"
              : "Close view of the key action",
        prompt: `Vertical 9:16 picturebook scene ${i + 1}. Depict this specific story beat: ${s.english}. Character identity and fixed clothes: ${identity}. ${i % 3 === 0 ? "Wide establishing view" : i % 3 === 1 ? "Medium character-action shot" : "Close view of the meaningful action"}. Story context: ${p.english.slice(0, 400)}. ${p.style === SIGNATURE_STYLE ? STYLE_PROMPT : p.style} No text, no watermark.`,
      })),
    },
    p.scenes.length,
  );
}
export function applyPlan(p, plan, source) {
  validatePlan(plan, p.scenes.length);
  return {
    ...p,
    creationDraft: undefined,
    title: plan.title,
    style: STYLE_OPTIONS.includes(plan.style) ? plan.style : p.style,
    character: { ...p.character, ...plan.characters[0] },
    creation: {
      source,
      mood: plan.mood,
      characters: plan.characters.map((c) => ({ ...c })),
      beats: plan.beats.map(({ scene, action, expression, camera }) => ({
        scene,
        action,
        expression,
        camera,
      })),
    },
    cover: {
      ...coverDefaults(),
      ...p.cover,
      enabled: true,
      title: plan.title,
      style: STYLE_OPTIONS.includes(plan.style) ? plan.style : p.style,
      englishTitle: plan.englishTitle,
      prompt: plan.coverPrompt,
    },
    music: {
      ...musicDefaults(),
      ...p.music,
      recommendation: plan.musicRecommendation,
    },
    scenes: p.scenes.map((s, i) => ({
      ...s,
      description: plan.beats[i].prompt,
    })),
  };
}
