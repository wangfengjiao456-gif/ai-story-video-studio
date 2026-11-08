import { PLAN_SCHEMA, validatePlan, cleanPlan } from "../creation/planSchema.js";
const TEMPLATES = ["Global Voice Daily", "Easy English Lab", "英语绘本"];
const string = { type: "string" };
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const TOPICS_SCHEMA = object({ topics: { type: "array", items: object({ title: string, englishTitle: string, direction: string, reason: string, hook: string }) } });
const PAIR_SCHEMA = object({ english: string, chinese: string });
const CONTENT_SCHEMA = object({ pairs: { type: "array", items: PAIR_SCHEMA }, plan: PLAN_SCHEMA });
const text = (v, n, empty = false) => typeof v === "string" && v.length <= n && (empty || !!v.trim());
function cleanPair(p) {
  if (!p || !text(p.english, 1e3) || !text(p.chinese, 1e3)) throw Error("每组英文与中文均需填写，且各不超过1000字符。");
  return { english: p.english, chinese: p.chinese };
}
function cleanContent(v) {
  if (!v || !Array.isArray(v.pairs) || !v.pairs.length || v.pairs.length > 30) throw Error("文章需包含1–30组双语句子。");
  const pairs = v.pairs.map(cleanPair);
  if (pairs.reduce((n, p) => n + p.english.length, 0) > 12e3 || pairs.reduce((n, p) => n + p.chinese.length, 0) > 12e3) throw Error("文章各语言不能超过12000字符。");
  return { pairs, plan: cleanPlan(validatePlan(v.plan, pairs.length)) };
}
function cleanTopics(v) {
  if (!v || !Array.isArray(v.topics) || v.topics.length !== 10) throw Error("话题结果需包含10个完整候选。");
  return v.topics.map((t) => {
    if (!t || !text(t.title, 120) || !text(t.englishTitle, 120, true) || !["direction", "reason", "hook"].every((k) => text(t[k], 500))) throw Error("话题内容缺失或过长。");
    return Object.fromEntries(["title", "englishTitle", "direction", "reason", "hook"].map((k) => [k, t[k]]));
  });
}
function cleanAssistant(a) {
  if (!a || !text(a.request, 6e3, true) || !TEMPLATES.includes(a.template) || (a.adoptedSignature !== undefined && !/^adopt:[a-f0-9]{64}$/.test(a.adoptedSignature)) || (a.adopted !== undefined && typeof a.adopted !== "boolean") || (a.mode !== undefined && !["topics","article","full"].includes(a.mode))) throw Error("创作助手输入无效或超过6000字符。");
  return { request: a.request, template: a.template,
    mode: a.mode || "full", ...(a.adoptedSignature ? {adoptedSignature:a.adoptedSignature}:{}), ...a.adopted === true ? { adopted: true } : {}, ...a.topics !== undefined ? { topics: cleanTopics({ topics: a.topics }) } : {}, ...a.content !== undefined ? { content: cleanContent(a.content) } : {} };
}
export {
  CONTENT_SCHEMA,
  PAIR_SCHEMA,
  TEMPLATES,
  TOPICS_SCHEMA,
  cleanAssistant,
  cleanContent,
  cleanPair,
  cleanTopics
};
// Independent creation must not inherit or upload an unrelated existing work.
export function assistantContext(project, request, mode) {
  if (mode === 'rewrite' || !/(这篇|当前|现有|已有|上面|原文|本文|根据文章|基于文章|\b(?:this|current|existing|above)\s+(?:article|story|text)\b)/i.test(request)) return undefined;
  if (project.english.length > 12000 || project.chinese.length > 12000) throw Error('当前文章各语言超过12000字符的参考上限，本次尚未发送请求。请在需求框粘贴要处理的片段，或改为独立创作；原文章不必删除。');
  return { english: project.english, chinese: project.chinese };
}
