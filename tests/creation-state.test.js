// Mock network only. Async UI guards must not issue paid requests after leaving the workflow.
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
const dir = mkdtempSync("work/v4-state-");
await build({
  entryPoints: ["src/components/CreationStudio.jsx"],
  outfile: join(dir, "component.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  external: ["react"],
  logLevel: "silent",
});
const Component = (
  await import(pathToFileURL(join(process.cwd(), dir, "component.mjs")))
).default;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const button = (r, name) =>
  r.root.findAllByType("button").find((b) => b.children.join("") === name);
const project = () => {
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  return p;
};
test("late paid planning response cannot overwrite an imported project after component unmount", async () => {
  const original = globalThis.fetch,
    p = project();
  let resolve,
    calls = 0,
    applied = 0,
    r;
  globalThis.fetch = async () => {
    calls++;
    return new Promise((done) => (resolve = done));
  };
  try {
    await act(async () => {
      r = create(
        React.createElement(Component, {
          project: p,
          onProject: () => applied++,
          generation: {},
          ai: { assets: {}, speed: 0.8 },
          onVideo() {},
        }),
      );
    });
    await act(async () => button(r, "AI 智能制作").props.onClick());
    await act(async () => button(r, "AI 智能规划（付费）").props.onClick());
    let pending;
    await act(async () => {
      pending = button(r, "确认规划一次").props.onClick();
    });
    assert.equal(calls, 1);
    await act(async () => r.unmount());
    r = null;
    await act(async () => {
      resolve(Response.json({ plan: localPlan(p) }));
      await pending;
    });
    assert.equal(applied, 0);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    if (r) await act(async () => r.unmount());
  }
});
test("leaving a confirmed batch lets the current image finish but stops later image/voice calls", async () => {
  const p = project();
  let r,
    finish,
    images = 0,
    voices = 0,
    navigated = 0;
  const props = {
    project: p,
    onProject() {},
    onVideo() {
      navigated++;
    },
    generation: {
      restoreMissing: async () => 0,
      generate: async () => {
        images++;
        return new Promise((resolve) => (finish = resolve));
      },
    },
    ai: {
      assets: {},
      speed: 0.8,
      restoreCached: async () => 0,
      generate: async () => {
        voices++;
        return { mediaSaved: true };
      },
    },
  };
  try {
    await act(async () => {
      r = create(React.createElement(Component, props));
    });
    await act(async () => button(r, "AI 智能制作").props.onClick());
    await act(async () => button(r, "审核并继续未完成的生成").props.onClick());
    let pending;
    await act(async () => {
      pending = button(r, "确认本次预计请求并开始").props.onClick();
    });
    assert.equal(images, 1);
    await act(async () => r.unmount());
    r = null;
    await act(async () => {
      finish({ mediaSaved: true });
      await pending;
    });
    assert.equal(images, 1);
    assert.equal(voices, 0);
    assert.equal(navigated, 0);
  } finally {
    if (r) await act(async () => r.unmount());
  }
});

test("changing the article during the final voice call never advances an obsolete batch to preview", async () => {
  const p = project();
  p.scenes.forEach(
    (s) =>
      (s.imageRef = {
        kind: "upload",
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1UAAAAASUVORK5CYII=",
      }),
  );
  let r,
    finish,
    voices = 0,
    navigated = 0;
  const props = {
    project: p,
    onProject() {},
    onVideo() {
      navigated++;
    },
    generation: { restoreMissing: async () => 0 },
    ai: {
      assets: {},
      speed: 0.8,
      restoreCached: async () => 0,
      generate: async () => {
        voices++;
        return new Promise((resolve) => (finish = resolve));
      },
    },
  };
  try {
    await act(async () => {
      r = create(React.createElement(Component, props));
    });
    await act(async () => button(r, "AI 智能制作").props.onClick());
    await act(async () => button(r, "审核并继续未完成的生成").props.onClick());
    let pending;
    await act(async () => {
      pending = button(r, "确认本次预计请求并开始").props.onClick();
    });
    assert.equal(voices, 1);
    await act(async () =>
      r.update(
        React.createElement(Component, {
          ...props,
          project: { ...p, english: "A changed article." },
        }),
      ),
    );
    await act(async () => {
      finish({ mediaSaved: true });
      await pending;
    });
    assert.equal(navigated, 0);
    assert.match(JSON.stringify(r.toJSON()), /内容发生变化/);
  } finally {
    if (r) await act(async () => r.unmount());
  }
});

test("one batch confirmation queues cover and all missing scenes in order, and double confirmation cannot duplicate charges", async () => {
  const p = project();
  p.cover = {
    enabled: true,
    title: "封面",
    englishTitle: "",
    prompt: "A gentle cover",
    duration: 3,
    imageFit: "contain",
    imageScale: 1,
    imagePosition: { x: 50, y: 50 },
  };
  let r,
    voices = 0,
    navigated = 0;
  const ids = [];
  const props = {
    project: p,
    onProject() {},
    onVideo() {
      navigated++;
    },
    generation: {
      restoreMissing: async () => 0,
      generate: async (id) => {
        ids.push(id);
        return { mediaSaved: true };
      },
    },
    ai: {
      assets: {},
      speed: 0.8,
      restoreCached: async () => 0,
      generate: async () => {
        voices++;
        return { mediaSaved: true };
      },
    },
  };
  try {
    await act(async () => {
      r = create(React.createElement(Component, props));
    });
    await act(async () => button(r, "AI 智能制作").props.onClick());
    await act(async () => button(r, "审核并继续未完成的生成").props.onClick());
    let pending;
    await act(async () => {
      const confirm = button(r, "确认本次预计请求并开始").props.onClick;
      pending = confirm();
      confirm();
    });
    await act(async () => await pending);
    assert.deepEqual(ids, ["cover-00", ...p.scenes.map((s) => s.id)]);
    assert.equal(voices, 1);
    assert.equal(navigated, 1);
  } finally {
    if (r) await act(async () => r.unmount());
  }
});
test.after(() => rmSync(dir, { recursive: true, force: true }));
test('failed immediate planning save retains editable draft and never claims applied',async()=>{
 const p=project();let r;
 try {
  await act(async()=>{r=create(React.createElement(Component,{project:p,onProject:()=>false,generation:{},ai:{assets:{},speed:.8},onVideo(){}}));});
  await act(async()=>button(r,'AI 智能制作').props.onClick());await act(async()=>button(r,'免费本地规划').props.onClick());await act(async()=>button(r,'确认内容并应用规划（免费）').props.onClick());
  assert.ok(button(r,'确认内容并应用规划（免费）'));assert.match(JSON.stringify(r.toJSON()),/草稿已保留/);assert.doesNotMatch(JSON.stringify(r.toJSON()),/规划已应用并保存/);
 }finally{if(r)await act(async()=>r.unmount());}
});
