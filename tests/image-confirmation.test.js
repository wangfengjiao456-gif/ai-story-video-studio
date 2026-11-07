import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { initialProject, splitArticle } from "../src/model.js";
const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(join(root, "work"), { recursive: true });
const dir = mkdtempSync(join(root, "work", "image-confirmation-"));
await build({
  entryPoints: [join(root, "src/components/SceneImageSettings.jsx")],
  outfile: join(dir, "component.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  external: ["react"],
  logLevel: "silent",
});
const Component = (await import(pathToFileURL(join(dir, "component.mjs"))))
  .default;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test("检查配置后仅出现一次页内确认，双击确认只生成一次", async () => {
  const original = globalThis.fetch;
  let renderer,
    calls = 0,
    finish;
  globalThis.fetch = async () => Response.json({ openai: true });
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  try {
    await act(async () => {
      renderer = create(
        React.createElement(Component, {
          project: p,
          scene: p.scenes[0],
          onChange() {},
          onSetStandard() {},
          generation: {
            busy: null,
            generate: () => {
              calls++;
              return new Promise((resolve) => (finish = resolve));
            },
          },
        }),
      );
    });
    const button = renderer.root
      .findAllByType("button")
      .find((b) => b.children.join("") === "AI 生成配图");
    await act(async () => button.props.onClick());
    assert.equal(
      renderer.root.findAllByProps({ role: "alertdialog" }).length,
      1,
    );
    const confirm = renderer.root
      .findAllByType("button")
      .find((b) => b.children.join("") === "确认生成这一张");
    let promise;
    await act(async () => {
      promise = confirm.props.onClick();
      confirm.props.onClick();
    });
    assert.equal(calls, 1);
    assert.equal(
      renderer.root.findAllByProps({ role: "alertdialog" }).length,
      0,
    );
    await act(async () => {
      finish();
      await promise;
    });
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.fetch = original;
  }
});
test.after(() => rmSync(dir, { recursive: true, force: true }));
