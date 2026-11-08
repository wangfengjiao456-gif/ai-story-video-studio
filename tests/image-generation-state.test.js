import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act } from "react-test-renderer";
import useImageGeneration from "../src/hooks/useImageGeneration.js";
import { initialProject, splitArticle } from "../src/model.js";
import { IMAGE_MODEL } from "../src/imageConfig.js";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalFetch = globalThis.fetch;
const jpeg = Buffer.from([
  255, 216, 255, 192, 0, 17, 8, 0, 2, 0, 2, 3, 1, 17, 0, 2, 17, 1, 3, 17, 1,
  255, 217,
]).toString("base64");
const ref = {
  kind: "generated",
  dataUrl: `data:image/jpeg;base64,${jpeg}`,
  model: IMAGE_MODEL,
  referenceUsed: false,
};
function project() {
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  return p;
}
async function mount(p) {
  let api, renderer;
  const applied = [];
  function Harness({ p }) {
    api = useImageGeneration(p, (id, image) => applied.push({ id, image }));
    return null;
  }
  await act(async () => {
    renderer = create(React.createElement(Harness, { p }));
  });
  return {
    get api() {
      return api;
    },
    applied,
    async update(p) {
      await act(async () =>
        renderer.update(React.createElement(Harness, { p })),
      );
    },
    async close() {
      await act(async () => renderer.unmount());
      globalThis.fetch = originalFetch;
    },
  };
}
test("只有显式请求才调用图片 API，并仅应用对应分镜", async () => {
  const p = project();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ imageRef: ref });
  };
  const h = await mount(p);
  try {
    assert.equal(calls, 0);
    await h.update({ ...p, ratio: "4:5" });
    assert.equal(calls, 0);
    await act(async () => h.api.generate(p.scenes[1].id));
    assert.equal(calls, 1);
    assert.equal(h.applied.length, 1);
    assert.equal(h.applied[0].id, p.scenes[1].id);
    assert.deepEqual(h.applied[0].image, ref);
  } finally {
    await h.close();
  }
});
test("生成失败不覆盖原图、不自动重试", async () => {
  const p = project();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { message: "额度不足" } }, { status: 402 });
  };
  const h = await mount(p);
  try {
    await act(async () => h.api.generate(p.scenes[0].id));
    assert.equal(h.applied.length, 0);
    assert.equal(calls, 1);
    assert.match(h.api.error, /额度不足/);
  } finally {
    await h.close();
  }
});
test("生成期间修改英文时保留未应用结果，禁止迟到响应覆盖新内容", async () => {
  const p = project();
  let resolve;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    return new Promise((r) => (resolve = r));
  };
  const h = await mount(p);
  let pending;
  try {
    await act(async () => {
      pending = h.api.generate(p.scenes[0].id);
    });
    const changed = {
      ...p,
      scenes: p.scenes.map((s, i) =>
        i === 0 ? { ...s, english: "New story." } : s,
      ),
    };
    await h.update(changed);
    await act(async () => {
      resolve(Response.json({ imageRef: ref }));
      await pending;
    });
    assert.equal(h.applied.length, 0);
    assert.equal(h.api.pending.id, p.scenes[0].id);
    const retained = h.api.pending;
    await act(async () => h.api.generate(p.scenes[1].id));
    assert.equal(calls, 1);
    assert.equal(h.api.pending, retained);
    assert.match(h.api.error, /原结果已保留/);
    await act(async () => h.api.applyPending());
    assert.equal(h.applied.length, 1);
  } finally {
    await h.close();
  }
});
