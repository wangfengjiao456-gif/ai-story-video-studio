// React hook tests with a mocked audio element and mocked API. Not a Safari or live API test.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import useVoiceStudio from "../src/hooks/useVoiceStudio.js";
import { isFresh } from "../src/services/aiVoice.js";
const originalFetch = globalThis.fetch;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
const project = () => ({
  english: "Hello. Goodbye.",
  scenes: [
    { id: "s1", english: "Hello.", chinese: "你好。" },
    { id: "s2", english: "Goodbye.", chinese: "再见。" },
  ],
});
const mockResponse = () =>
  Response.json({ audio_base64: Buffer.from("ID3 mock").toString("base64") });
async function mount(p = project()) {
  let studio, renderer;
  const frames = [];
  const Harness = ({ project }) => {
    studio = useVoiceStudio(project, {
      onStart: () => {},
      onFrame: (i) => frames.push(i),
    });
    return null;
  };
  await act(async () => {
    renderer = create(React.createElement(Harness, { project: p }));
  });
  const audio = {
    src: "",
    currentTime: 0,
    duration: 50,
    paused: true,
    ended: false,
    playCalls: 0,
    getAttribute(key) {
      return key === "src" ? this.src : null;
    },
    removeAttribute() {
      this.src = "";
    },
    load() {},
    pause() {
      this.paused = true;
    },
    async play() {
      this.playCalls++;
      this.paused = false;
      studio.audioProps.onPlay();
    },
  };
  studio.audioRef.current = audio;
  return {
    get studio() {
      return studio;
    },
    audio,
    frames,
    async update(p) {
      await act(async () =>
        renderer.update(React.createElement(Harness, { project: p })),
      );
    },
    async cleanup() {
      await act(async () => renderer.unmount());
      globalThis.fetch = originalFetch;
    },
    async generate(key) {
      await act(async () => studio.generate(key));
      audio.src = studio.current.url;
      await act(async () => studio.audioProps.onLoadedMetadata());
    },
  };
}
test("模拟播放支持真实时长、按音频 currentTime 切镜、暂停继续和从头播放", async () => {
  globalThis.fetch = async () => mockResponse();
  const h = await mount();
  try {
    await h.generate("article");
    assert.equal(h.studio.current.duration, 50);
    assert.equal(h.studio.speed, 0.8);
    await act(async () => h.studio.start("article", true));
    assert.equal(h.studio.playing, true);
    h.audio.currentTime = 30;
    await act(async () => h.studio.audioProps.onTimeUpdate());
    assert.equal(h.frames.at(-1), 1);
    await act(async () => h.studio.pause());
    assert.equal(h.studio.playing, false);
    assert.equal(h.audio.currentTime, 30);
    await act(async () => h.studio.toggle());
    assert.equal(h.audio.currentTime, 30);
    assert.equal(h.studio.playing, true);
    await act(async () => h.studio.restart());
    assert.equal(h.audio.currentTime, 0);
  } finally {
    await h.cleanup();
  }
});
test("英文修改后保留旧 MP3、停止播放且禁止旧音频继续", async () => {
  globalThis.fetch = async () => mockResponse();
  const h = await mount();
  try {
    await h.generate("article");
    const old = h.studio.current;
    await act(async () => h.studio.start("article"));
    const changed = project();
    changed.english = "Changed article.";
    await h.update(changed);
    assert.equal(h.studio.playing, false);
    assert.equal(h.studio.current.url, old.url);
    await act(async () => h.studio.start("article"));
    assert.match(h.studio.error, /重新生成/);
    assert.equal(h.studio.playing, false);
  } finally {
    await h.cleanup();
  }
});
test("生成失败保留上一次成功的音频，并显示真实错误", async () => {
  globalThis.fetch = async () => mockResponse();
  const h = await mount();
  try {
    await h.generate("article");
    const old = h.studio.current.url;
    globalThis.fetch = async () =>
      Response.json({ error: { message: "API 配额不足" } }, { status: 402 });
    await act(async () => h.studio.generate("article"));
    assert.equal(h.studio.current.url, old);
    assert.match(h.studio.error, /配额不足/);
    assert.equal(h.studio.busy, null);
  } finally {
    await h.cleanup();
  }
});
test("分镜顺序播放按 ended 切换，暂停后从原进度继续", async () => {
  globalThis.fetch = async () => mockResponse();
  const h = await mount();
  try {
    await h.generate("s1");
    await h.generate("s2");
    await act(async () => h.studio.allScenes());
    assert.equal(h.studio.selected, "s1");
    h.audio.currentTime = 7;
    await act(async () => h.studio.pause());
    await act(async () => h.studio.toggle());
    assert.equal(h.audio.currentTime, 7);
    await act(async () => h.studio.audioProps.onEnded());
    assert.equal(h.studio.selected, "s2");
    assert.equal(h.frames.at(-1), 1);
  } finally {
    await h.cleanup();
  }
});
test("生成期间编辑文本，返回结果标记过期，不绑定到新文字", async () => {
  let resolve;
  globalThis.fetch = () =>
    new Promise((r) => {
      resolve = r;
    });
  const h = await mount();
  let pending;
  try {
    await act(async () => {
      pending = h.studio.generate("article");
    });
    const changed = project();
    changed.english = "Different.";
    await h.update(changed);
    await act(async () => {
      resolve(mockResponse());
      await pending;
    });
    assert.equal(h.studio.current.text, "Hello. Goodbye.");
    assert.equal(isFresh(h.studio.current, changed.english, 0.8), false);
  } finally {
    await h.cleanup();
  }
});
test("导入重置会取消旧请求，迟到响应不能污染新项目", async () => {
  let resolve;
  globalThis.fetch = () =>
    new Promise((r) => {
      resolve = r;
    });
  const h = await mount();
  let pending;
  try {
    await act(async () => {
      pending = h.studio.generate("article");
    });
    await act(async () => h.studio.reset());
    await act(async () => {
      resolve(mockResponse());
      await pending;
    });
    assert.deepEqual(h.studio.assets, {});
    assert.equal(h.studio.selected, null);
  } finally {
    await h.cleanup();
  }
});
