const string = { type: "string" };
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const PLAN_SCHEMA = object({
  title: string,
  englishTitle: string,
  style: string,
  mood: string,
  musicRecommendation: string,
  characters: {
    type: "array",
    items: object({ name: string, appearance: string, clothing: string }),
  },
  coverPrompt: string,
  beats: {
    type: "array",
    items: object({
      index: { type: "integer" },
      scene: string,
      action: string,
      expression: string,
      camera: string,
      prompt: string,
    }),
  },
});
export function validatePlan(plan, count) {
  const text = (x, max) =>
    typeof x === "string" && x.trim().length > 0 && x.length <= max;
  if (
    !plan ||
    !text(plan.title, 120) ||
    typeof plan.englishTitle !== "string" ||
    plan.englishTitle.length > 120 ||
    !text(plan.style, 100) ||
    !text(plan.mood, 200) ||
    !text(plan.musicRecommendation, 200) ||
    !text(plan.coverPrompt, 3000) ||
    !Array.isArray(plan.characters) ||
    !plan.characters.length ||
    plan.characters.length > 8 ||
    !plan.characters.every(
      (c) =>
        c && ["name", "appearance", "clothing"].every((k) => text(c[k], 2000)),
    ) ||
    !Array.isArray(plan.beats) ||
    plan.beats.length !== count ||
    !plan.beats.every(
      (b, i) =>
        b &&
        b.index === i + 1 &&
        ["scene", "action", "expression", "camera"].every((k) =>
          text(b[k], 1000),
        ) &&
        text(b.prompt, 3000),
    )
  )
    throw Error("规划结果缺失、过长或与分镜数量不一致，原项目未修改。");
  return plan;
}

export function cleanPlan(plan) {
  return {
    title: plan.title,
    englishTitle: plan.englishTitle,
    style: plan.style,
    mood: plan.mood,
    musicRecommendation: plan.musicRecommendation,
    coverPrompt: plan.coverPrompt,
    characters: plan.characters.map((c) => ({
      name: c.name,
      appearance: c.appearance,
      clothing: c.clothing,
    })),
    beats: plan.beats.map((b) => ({
      index: b.index,
      scene: b.scene,
      action: b.action,
      expression: b.expression,
      camera: b.camera,
      prompt: b.prompt,
    })),
  };
}
