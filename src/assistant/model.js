import { applyPlan } from "../creation/planning.js";
import { uid } from "../model.js";
import { cleanContent, cleanAssistant, TEMPLATES } from "./schema.js";
export * from "./schema.js";
function adoptContent(project, content) {
  const c = cleanContent(content);
  const p = applyPlan({ ...project, english: c.pairs.map((p2) => p2.english).join("\n"), chinese: c.pairs.map((p2) => p2.chinese).join("\n"), scenes: c.pairs.map((p2) => ({ ...p2, id: uid(), description: "", duration: 5 })), character: { name: "", appearance: "", clothing: "" }, cover: void 0, creationDraft: void 0, videoTiming: void 0, voiceRecords: void 0 }, c.plan, "ai");
  return { ...p, ratio: "9:16", assistant: cleanAssistant({request:"",template:TEMPLATES[0], ...project.assistant, content: c, adopted: true }) };
}
export {
  adoptContent
};
