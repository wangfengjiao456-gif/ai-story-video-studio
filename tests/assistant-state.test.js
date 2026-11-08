import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { initialProject, splitArticle } from "../src/model.js";
import { localPlan } from "../src/creation/planning.js";
mkdirSync("work", { recursive: true });
const dir = mkdtempSync("work/assistant-test-");
await build({ entryPoints: ["src/components/CreativeAssistant.jsx"], outfile: join(dir, "component.mjs"), bundle: true, format: "esm", platform: "node", external: ["react"], logLevel: "silent" });
const Component = (await import(pathToFileURL(join(process.cwd(), dir, "component.mjs")))).default;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const button = (r, name) => r.root.findAllByType("button").find((b) => b.children.join("") === name);
const project = () => {
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  p.assistant = { request: "关于坚持的跟读文章", template: "Global Voice Daily" };
  return p;
};
const content = (p) => ({ pairs: p.scenes.map(({ english, chinese }) => ({ english, chinese })), plan: localPlan(p) });
test("assistant fee confirmation and double-click lock allow exactly one upstream request, draft never replaces article", async () => {
  const old = globalThis.fetch, p = project();
  let r, finish, calls = 0, saved;
  globalThis.fetch = async () => {
    calls++;
    return new Promise((resolve) => finish = resolve);
  };
  try {
    await act(async () => {
      r = create(React.createElement(Component, { project: p, onProject: (n) => {
        saved = n;
        return true;
      } }));
    });
    await act(async () => button(r, "生成完整内容").props.onClick());
    assert.equal(calls, 0);
    let pending;
    await act(async () => {
      const confirm = button(r, "确认一次付费创作").props.onClick;
      pending = confirm();
      confirm();
    });
    assert.equal(calls, 1);
    await act(async () => {
      finish(Response.json({ content: content(p) }));
      await pending;
    });
    assert.deepEqual(saved.assistant.content, content(p));
    assert.equal(saved.english, p.english);
    assert.equal(saved.scenes, p.scenes);
    assert.equal(saved.cover, void 0);
  } finally {
    globalThis.fetch = old;
    if (r) await act(async () => r.unmount());
  }
});
test("assistant ignores late response after unmount and never starts paid follow-up steps", async () => {
  const old = globalThis.fetch, p = project();
  let r, finish, writes = 0;
  globalThis.fetch = async () => new Promise((resolve) => finish = resolve);
  try {
    await act(async () => {
      r = create(React.createElement(Component, { project: p, onProject: () => writes++ }));
    });
    await act(async () => button(r, "生成完整内容").props.onClick());
    let pending;
    await act(async () => {
      pending = button(r, "确认一次付费创作").props.onClick();
    });
    await act(async () => r.unmount());
    r = null;
    await act(async () => {
      finish(Response.json({ content: content(p) }));
      await pending;
    });
    assert.equal(writes, 0);
  } finally {
    globalThis.fetch = old;
    if (r) await act(async () => r.unmount());
  }
});
test("assistant does not overwrite a project replaced during the request and shows uncertain billing warning", async () => {
  const old = globalThis.fetch, p = project();
  let r, finish, writes = 0;
  const props = { project: p, onProject: () => writes++ };
  globalThis.fetch = async () => new Promise((resolve) => finish = resolve);
  try {
    await act(async () => {
      r = create(React.createElement(Component, props));
    });
    await act(async () => button(r, "生成完整内容").props.onClick());
    let pending;
    await act(async () => {
      pending = button(r, "确认一次付费创作").props.onClick();
    });
    await act(async () => r.update(React.createElement(Component, { ...props, project: { ...p, english: "Different story." } })));
    await act(async () => {
      finish(Response.json({ content: content(p) }));
      await pending;
    });
    assert.equal(writes, 0);
    assert.match(JSON.stringify(r.toJSON()), /未覆盖当前内容/);
    assert.match(JSON.stringify(r.toJSON()), /可能已计费/);
  } finally {
    globalThis.fetch = old;
    if (r) await act(async () => r.unmount());
  }
});
test("assistant failed persistence is explicit and single-pair rewrite preserves every other pair", async () => {
  const old = globalThis.fetch, p = project();
  p.assistant.content = content(p);
  let r, saved;
  globalThis.fetch = async () => Response.json({ pair: { english: "Try again.", chinese: "再试一次。" } });
  try {
    await act(async () => {
      r = create(React.createElement(Component, { project: p, onProject: (n) => {
        saved = n;
        return false;
      } }));
    });
    await act(async () => button(r, "仅改写这一组").props.onClick());
    await act(async () => button(r, "确认一次付费创作").props.onClick());
    assert.equal(saved.assistant.content.pairs[0].english, "Try again.");
    assert.deepEqual(saved.assistant.content.pairs[1], p.assistant.content.pairs[1]);
    assert.deepEqual(saved.assistant.content.plan.beats[1], p.assistant.content.plan.beats[1]);
    assert.match(saved.assistant.content.plan.beats[0].prompt, /Try again/);
    assert.match(JSON.stringify(r.toJSON()), /保存失败/);
  } finally {
    globalThis.fetch = old;
    if (r) await act(async () => r.unmount());
  }
});
test.after(() => rmSync(dir, { recursive: true, force: true }));
test('large existing work never blocks unrelated generation, while explicit context is preflighted without a request',async()=>{
 const old=globalThis.fetch,p=project();p.english='x'.repeat(13000);let r,calls=0;
 globalThis.fetch=async(_url,options)=>{calls++;assert.equal(JSON.parse(options.body).context,undefined);return Response.json({content:content(project())});};
 try {
  await act(async()=>{r=create(React.createElement(Component,{project:p,onProject:()=>true}));});
  await act(async()=>button(r,'生成完整内容').props.onClick());await act(async()=>button(r,'确认一次付费创作').props.onClick());assert.equal(calls,1);
  await act(async()=>r.unmount());r=null;
  const referenced={...p,assistant:{...p.assistant,request:'根据这篇文章制作视频'}};
  await act(async()=>{r=create(React.createElement(Component,{project:referenced,onProject:()=>true}));});await act(async()=>button(r,'生成完整内容').props.onClick());assert.equal(button(r,'确认一次付费创作'),undefined);assert.equal(calls,1);assert.match(JSON.stringify(r.toJSON()),/尚未发送请求/);
 } finally {globalThis.fetch=old;if(r)await act(async()=>r.unmount());}
});
