// Component lifecycle tests with simulated media metadata, not live MP3 decoding.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { initialProject, splitArticle } from "../src/model.js";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const dir = resolve("work");
mkdirSync(dir, { recursive: true });
const temp = mkdtempSync(join(dir, "video-panel-"));
await build({
  entryPoints: ["src/components/VideoStudioPanel.jsx"],
  outfile: join(temp, "Panel.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["react"],
  logLevel: "silent",
});
const Panel = (await import(pathToFileURL(join(temp, "Panel.mjs")))).default;
test("latest MP3 import wins; unmount revokes its URL without late callbacks or undefined cleanup state", async () => {
  const original = {
    document: globalThis.document,
    Audio: globalThis.Audio,
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };
  const pending = new Map(),
    revoked = [];
  class AudioMock {
    duration = 2;
    paused = true;
    readyState = 1;
    currentTime = 0;
    set src(value) {
      this.url = value;
      pending.set(value, () => this.onloadedmetadata?.());
    }
    get src() {
      return this.url;
    }
    getAttribute() {
      return this.url;
    }
    removeAttribute() {
      this.url = "";
    }
    load() {}
    pause() {
      this.paused = true;
    }
    removeEventListener() {}
  }
  globalThis.Audio = AudioMock;
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({ measureText: () => ({ width: 10 }) }),
    }),
  };
  URL.createObjectURL = (file) => `blob:${file.name}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  let renderer;
  try {
    const project = initialProject();
    project.scenes = splitArticle(project.english, project.chinese);
    await act(async () => {
      renderer = create(
        React.createElement(Panel, {
          project,
          ai: { assets: {}, speed: 0.8, pause() {} },
          onTimingChange() {},
          onFrame() {},
        }),
        {
          createNodeMock: (e) =>
            e.type === "audio" ? new AudioMock() : { click() {} },
        },
      );
    });
    const input = renderer.root
      .findAllByType("input")
      .find((x) => x.props.accept === "audio/mpeg,.mp3");
    const event = (name) => ({
      target: { files: [new File(["ID3 fixture"], name)], value: "" },
    });
    const wait = async (key) => {
      for (let i = 0; i < 100 && !pending.has(key); i++)
        await new Promise((r) => setTimeout(r, 1));
      assert.ok(pending.has(key));
    };
    let first, second;
    await act(async () => {
      first = input.props.onChange(event("first.mp3"));
      await wait("blob:first.mp3");
    });
    await act(async () => {
      second = input.props.onChange(event("second.mp3"));
      await wait("blob:second.mp3");
      pending.get("blob:second.mp3")();
      await second;
    });
    await act(async () => {
      pending.get("blob:first.mp3")();
      await first;
    });
    const inspector = renderer.root
      .findAllByType("audio")
      .find((x) => x.props.controls);
    assert.equal(inspector.props.src, "blob:second.mp3");
    assert.ok(revoked.includes("blob:first.mp3"));
    await act(async () => renderer.unmount());
    renderer = null;
    assert.ok(revoked.includes("blob:second.mp3"));
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.document = original.document;
    globalThis.Audio = original.Audio;
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  }
});
test.after(() => rmSync(temp, { recursive: true, force: true }));
