import test from "node:test";
import assert from "node:assert/strict";
import {
  sentences,
  splitArticle,
  initialProject,
  parseProject,
} from "../src/model.js";
test("英文与中文标点分句及空输入", () => {
  assert.deepEqual(sentences("Hello! How are you?"), [
    "Hello!",
    "How are you?",
  ]);
  assert.deepEqual(sentences("你好！再见。", "zh"), ["你好！", "再见。"]);
  assert.deepEqual(sentences(""), []);
});
test("按句序配对并保留未匹配中文", () => {
  const s = splitArticle("Hello.", "你好。再见。");
  assert.equal(s.length, 2);
  assert.equal(s[1].english, "");
  assert.equal(s[1].chinese, "再见。");
  assert.notEqual(s[0].id, s[1].id);
});
test("项目 JSON 往返保留用户内容并重新分配唯一 ID", () => {
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  const result = parseProject(JSON.stringify(p));
  assert.equal(result.title, p.title);
  assert.equal(result.scenes[0].english, p.scenes[0].english);
  assert.notEqual(result.scenes[0].id, p.scenes[0].id);
});
test("拒绝错误版本、超限时长、空对象和无效设置", () => {
  const p = initialProject();
  for (const bad of [
    {},
    { ...p, version: 2 },
    { ...p, ratio: "bad" },
    { ...p, rate: 10 },
    {
      ...p,
      scenes: [{ english: "x", chinese: "", description: "", duration: 0 }],
    },
  ])
    assert.throws(() => parseProject(bad));
  assert.throws(() => parseProject("{"));
});

test("拒绝超过 500 个分镜且不修改原对象", () => {
  const p = initialProject();
  p.scenes = Array.from({ length: 501 }, () => ({
    english: "a",
    chinese: "",
    description: "",
    duration: 5,
  }));
  assert.throws(() => parseProject(p));
  assert.equal(p.scenes.length, 501);
});
