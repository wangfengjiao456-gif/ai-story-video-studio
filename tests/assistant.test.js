import test from "node:test";
import assert from "node:assert/strict";
import { initialProject, splitArticle, serializeProject, parseProject } from "../src/model.js";
import { localPlan } from "../src/creation/planning.js";
import { adoptContent, cleanAssistant, cleanContent } from "../src/assistant/model.js";
import { createAssistantHandler } from "../api/creative-assistant.js";
const content = () => {
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  return { pairs: p.scenes.map(({ english, chinese }) => ({ english, chinese })), plan: localPlan(p) };
};
const req = (mode = "content") => ({ method: "POST", headers: { host: "studio.test", origin: "https://studio.test", "content-type": "application/json" }, body: { mode, confirmed: true, request: "请创作一个成长故事", template: "Global Voice Daily", pair: { english: "Keep going.", chinese: "继续前进。" } } });
const res = () => ({ headers: {}, setHeader(k, v) {
  this.headers[k] = v;
}, status(n) {
  this.code = n;
  return this;
}, json(body) {
  this.body = body;
  return this;
} });
test("assistant draft round trips JSON without changing current story; adoption maps exact pairs and invalidates old media timing", () => {
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  const c = content();
  p.assistant = { request: "话题", template: "英语绘本", content: c };
  const saved = parseProject(serializeProject(p));
  assert.equal(saved.english, p.english);
  assert.deepEqual(saved.assistant.content, c);
  const n = adoptContent({ ...p, videoTiming: { signature: "old" }, voiceRecords: [], cover: { imageRef: { bad: true } } }, c);
  assert.equal(n.scenes.length, c.pairs.length);
  assert.equal(n.scenes[1].english, c.pairs[1].english);
  assert.equal(n.scenes[1].chinese, c.pairs[1].chinese);
  assert.equal(n.scenes[1].description, c.plan.beats[1].prompt);
  assert.equal(n.cover.duration, 3);
  assert.equal(n.videoTiming, void 0);
  assert.equal(n.voiceRecords, void 0);
  assert.equal(n.cover.imageRef, void 0);
  assert.ok(serializeProject(n));
  assert.notEqual(n.scenes[0].id, p.scenes[0].id);
});
test("assistant rejects oversized or mismatched drafts before persistence", () => {
  assert.throws(() => cleanAssistant({ request: "x".repeat(6001), template: "英语绘本" }));
  const c = content();
  c.pairs.pop();
  assert.throws(() => cleanContent(c));
  const old = initialProject();
  assert.ok(parseProject(serializeProject(old)));
});
test("assistant sends one official structured request without retries and cleans unknown fields", async () => {
  let calls = 0;
  const h = createAssistantHandler({ getKey: () => "mock", createClient: () => ({ responses: { create: async (input) => {
    calls++;
    assert.equal(input.model, "gpt-5-mini");
    assert.equal(input.store, false);
    assert.equal(input.text.format.strict, true);
    return { status: "completed", output_text: JSON.stringify({ ...content(), apiKey: "not allowed" }) };
  } } }) });
  const r = res();
  await h(req(), r);
  assert.equal(r.code, 200);
  assert.equal(calls, 1);
  assert.equal(r.body.content.apiKey, void 0);
  const r2 = res();
  await h(req(), r2);
  assert.equal(r2.code, 429);
  assert.match(r2.body.error.message, /尚未调用OpenAI/);
  assert.equal(calls, 1);
});
test("assistant blocks missing confirmation, foreign origin and key before billing", async () => {
  let calls = 0;
  const h = createAssistantHandler({ getKey: () => "", createClient: () => {
    calls++;
  } });
  const a = req();
  a.body.confirmed = false;
  const x = res();
  await h(a, x);
  assert.equal(x.code, 400);
  const b = req();
  b.headers.origin = "https://elsewhere.test";
  const y = res();
  await h(b, y);
  assert.equal(y.code, 403);
  const z = res();
  await h(req(), z);
  assert.equal(z.code, 503);
  assert.match(z.body.error.message, /Plus/);
  assert.equal(calls, 0);
});
test("assistant distinguishes quota, authentication, model permission, rate and uncertain network failure", async () => {
  for (const [err, status, match] of [[{ status: 429, code: "insufficient_quota" }, 402, /Billing/], [{ status: 401 }, 401, /密钥/], [{ status: 404 }, 403, /模型/], [{ status: 429 }, 429, /速率/], [new Error("private-secret"), 502, /可能已计费/]]) {
    let calls = 0;
    const h = createAssistantHandler({ getKey: () => "mock", createClient: () => ({ responses: { create: async () => {
      calls++;
      throw err;
    } } }) });
    const r = res();
    await h(req(), r);
    assert.equal(r.code, status);
    assert.match(r.body.error.message, match);
    assert.doesNotMatch(JSON.stringify(r.body), /private-secret/);
    assert.equal(calls, 1);
  }
});
test("topics and single pair rewrite validate independently; malformed output does not appear successful", async () => {
  for (const mode of ["topics", "rewrite", "content"]) {
    const output = mode === "topics" ? { topics: Array.from({ length: 10 }, (_, i) => ({ title: `话题${i}`, englishTitle: "", direction: "成长", reason: "共鸣", hook: "从一步开始" })) } : mode === "rewrite" ? { english: "One step.", chinese: "走一步。" } : {};
    const h = createAssistantHandler({ getKey: () => "mock", createClient: () => ({ responses: { create: async () => ({ status: "completed", output_text: JSON.stringify(output) }) } }) });
    const r = res();
    await h(req(mode), r);
    assert.equal(r.code, mode === "content" ? 502 : 200);
  }
});
test('assistant includes only bounded current-article context and supports article mode in one call', async()=>{
 let input;const h=createAssistantHandler({getKey:()=> 'mock',createClient:()=>({responses:{create:async v=>{input=JSON.parse(v.input);return {status:'completed',output_text:JSON.stringify(content())};}}})});const q=req('article');q.body.context={english:'Keep going.',chinese:'继续前进。',private:'discard'};const r=res();await h(q,r);assert.equal(r.code,200);assert.deepEqual(input.currentProject,{english:'Keep going.',chinese:'继续前进。'});assert.equal(input.mode,'article');
 const invalid=req();invalid.body.context={english:'x'.repeat(12001),chinese:''};const out=res();await h(invalid,out);assert.equal(out.code,400);
});
test('first request at clock zero is allowed; an in-flight request stays locked beyond cooldown', async()=>{
 let clock=0,finish,calls=0;const h=createAssistantHandler({getKey:()=> 'mock',now:()=>clock,createClient:()=>({responses:{create:async()=>{calls++;return new Promise(resolve=>finish=resolve);}}})});
 const r=res(),pending=h(req(),r);assert.equal(calls,1);clock=11000;const other=res();await h(req(),other);assert.equal(other.code,409);assert.equal(calls,1);finish({status:'completed',output_text:JSON.stringify(content())});await pending;assert.equal(r.code,200);
});
test('unrelated requests and pair rewrites omit oversized old articles; explicit references fail before payment', async()=>{
 const {assistantContext}=await import('../src/assistant/schema.js');const p={english:'x'.repeat(13000),chinese:'中文'};
 assert.equal(assistantContext(p,'推荐10个成长话题','topics'),undefined);
 assert.equal(assistantContext(p,'写一篇新故事','content'),undefined);
 assert.equal(assistantContext(p,'改写当前文章的这一句','rewrite'),undefined);
 assert.throws(()=>assistantContext(p,'根据这篇文章制作视频','content'),/尚未发送请求/);
 assert.deepEqual(assistantContext({english:'Go.',chinese:'走。'},'Use this article.','content'),{english:'Go.',chinese:'走。'});
});
test('adopting a one-sentence revision preserves unrelated illustrations, scene IDs and recoverable clip audio',()=>{
 const p=initialProject();p.scenes=splitArticle(p.english,p.chinese);p.assistant={request:'话题',template:'英语绘本'};const first=adoptContent(p,content());
 const pic={kind:'upload',dataUrl:'unchanged image'};first.scenes.forEach(s=>s.imageRef=pic);first.voiceRecords=[{key:'scene-1',text:first.scenes[1].english,speed:.8,fingerprint:'a'.repeat(64)},{key:'article',text:first.english,speed:.8,fingerprint:'b'.repeat(64)}];
 const revision=structuredClone(first.assistant.content);revision.pairs[0].english='Take one step.';revision.plan.beats[0].prompt='A new single scene';const next=adoptContent(first,revision);
 assert.equal(next.scenes[1].id,first.scenes[1].id);assert.equal(next.scenes[1].imageRef,pic);assert.equal(next.scenes[0].imageRef,undefined);assert.equal(next.voiceRecords.length,1);assert.equal(next.voiceRecords[0].key,'scene-1');assert.equal(first.scenes[0].imageRef,pic);
});
