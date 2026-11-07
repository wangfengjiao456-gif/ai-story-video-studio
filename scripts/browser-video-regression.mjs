// Offline browser test. Alignment responses are MOCKS; FFmpeg and MP4 download are REAL.
// Start Vite :5173 and renderer :8099 using the test-only key below. Generate fixtures first.
// PLAYWRIGHT_MODULE may point to a locally installed playwright-core index.mjs.
import assert from "node:assert/strict";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import { readFileSync, writeFileSync } from "node:fs";
const studioURL = process.env.STUDIO_URL || "http://localhost:5173";
const rendererBase = process.env.RENDERER_BASE || "http://localhost:8099";
const p = JSON.parse(
  readFileSync("work/mp4-regression/sample-project.json", "utf8"),
);
const fixtureManifest = JSON.parse(
  readFileSync("work/mp4-regression/manifest.json", "utf8"),
);
let elapsed = 0;
const knownCues = fixtureManifest.audios.map((a) => {
  const start = elapsed;
  elapsed += a.duration;
  return { start, end: elapsed };
});
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 820, height: 1180 },
  isMobile: true,
  hasTouch: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript((project) => {
  if (!localStorage.getItem("story-studio-v1"))
    localStorage.setItem("story-studio-v1", JSON.stringify(project));
}, p);
// Exercise actual Vercel handlers in-process; only the paid provider is mocked.
const { createVideoJobHandler } = await import("../api/video-jobs.js");
const { createRendererStatus } = await import("../api/renderer-status.js");
const { createAlignmentHandler } = await import("../api/align-audio.js");
const getConfig = () => ({
  url: rendererBase,
  key: "offline-browser-key-0123456789",
});
async function routeHandler(route, handler) {
  const headers = {};
  let status = 200,
    body;
  const res = {
    setHeader(k, v) {
      headers[k] = v;
    },
    status(n) {
      status = n;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
  await handler(
    {
      method: route.request().method(),
      headers: { origin: studioURL, host: new URL(studioURL).host },
      body: route.request().postDataJSON(),
    },
    res,
  );
  await route.fulfill({
    status,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
await page.route("**/api/renderer-status", (route) =>
  routeHandler(route, createRendererStatus({ getConfig })),
);
let failNextJob = true;
await page.route("**/api/video-jobs", async (route) => {
  if (failNextJob) {
    failNextJob = false;
    await route.fulfill({
      status: 503,
      json: { error: { message: "离线测试：渲染服务暂时不可用，请重试。" } },
    });
    return;
  }
  await routeHandler(route, createVideoJobHandler({ getConfig }));
});
let alignmentRequests = 0;
await page.route("**/api/align-audio", (route) =>
  routeHandler(
    route,
    createAlignmentHandler({
      getKey: () => "offline-paid-provider-mock",
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://api.elevenlabs.io/v1/forced-alignment");
        assert.equal(
          options.headers["xi-api-key"],
          "offline-paid-provider-mock",
        );
        alignmentRequests++;
        const total = p.scenes.length;
        const words = p.scenes.flatMap((scene, i) => {
          const parts = scene.english.match(
            /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu,
          );
          return parts.map((text, j) => ({
            text,
            start:
              knownCues[i].start +
              0.05 +
              (j * (knownCues[i].end - knownCues[i].start - 0.1)) /
                parts.length,
            end:
              knownCues[i].start +
              0.05 +
              ((j + 1) * (knownCues[i].end - knownCues[i].start - 0.1)) /
                parts.length,
          }));
        });
        return Response.json({ words });
      },
    }),
  ),
);
await page.goto(studioURL);
await page.getByRole("button", { name: "视频预览与导出", exact: true }).click();
await page
  .locator('input[type=file][accept="audio/mpeg,.mp3"]')
  .setInputFiles("work/mp4-regression/uploaded-test.mp3");
await page.getByText("MP3 真实时长：", { exact: false }).waitFor();
await page.getByRole("button", { name: "准备完整视频", exact: true }).click();
await page.getByRole("alert").filter({ hasText: "必须先完成" }).waitFor();
assert.equal(alignmentRequests, 0);
await page
  .getByRole("button", { name: "逐句音频对齐（ElevenLabs）", exact: true })
  .click();
assert.equal(alignmentRequests, 0); // confirmation must precede requests
await page.getByRole("button", { name: "确认并对齐一次", exact: true }).click();
await page
  .getByText("ElevenLabs 逐词强制对齐（请试听校对）", { exact: false })
  .waitFor();
assert.equal(alignmentRequests, 1);
await page
  .getByText("手动填写 / 校对每镜开始与结束时间", { exact: true })
  .click();
const imported = page
  .locator("section.note")
  .filter({ hasText: "MP3 真实时长：" });
const inputs = imported.locator("input[type=number]");
const duration = await imported.locator("audio").evaluate((a) => a.duration);
for (let i = 0; i < 10; i++) {
  await inputs.nth(2 * i).fill(String(knownCues[i].start));
  await inputs.nth(2 * i + 1).fill(String(knownCues[i].end));
}
await page.getByRole("button", { name: "确认并保存全部起止时间" }).click();
await page.locator(".full-video-frame canvas").waitFor();
const slider = page.getByRole("slider", { name: "完整视频进度" });
await slider.evaluate((e, d) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(e, d);
  e.dispatchEvent(new Event("input", { bubbles: true }));
  e.dispatchEvent(new Event("change", { bubbles: true }));
}, knownCues[1].start + 0.1);
await page.getByRole("button", { name: "预览分镜 2", exact: true }).waitFor();
await page.waitForFunction(() =>
  document
    .querySelector('button[aria-label="预览分镜 2"]')
    .classList.contains("current"),
);
// Manual calibration audio and full preview must not play over each other.
await page.getByLabel("手动校准试听（仅音频）").evaluate((a) => a.play());
assert.equal(
  await page.locator(".video-studio > audio").evaluate((a) => a.paused),
  true,
);
await page.getByRole("button", { name: "继续播放", exact: true }).click();
assert.equal(
  await page.getByLabel("手动校准试听（仅音频）").evaluate((a) => a.paused),
  true,
);
await page.getByRole("button", { name: "暂停", exact: true }).click();
const stopped = Number(await slider.inputValue());
await page.waitForTimeout(180);
assert.ok(
  Math.abs(Number(await slider.inputValue()) - stopped) < 0.05,
  "paused clock drift",
);
// The right preview uses the same plan/page and seeks the actual MP3.
for (const i of [8, 1, 9, 0]) {
  await page
    .getByRole("button", { name: `预览分镜 ${i + 1}`, exact: true })
    .click();
  await page.waitForFunction(
    (expected) =>
      Math.abs(
        document.querySelector(".video-studio > audio").currentTime - expected,
      ) < 0.05,
    knownCues[i].start,
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".full-video-frame canvas").toDataURL() ===
      document.querySelector(".preview-panel canvas").toDataURL(),
  );
}
await page.getByRole("button", { name: "保存项目", exact: true }).click();
const saved = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("story-studio-v1")),
);
assert.equal(saved.videoTiming.cues.length, 10);
assert.equal(saved.videoTiming.source, "manual");
assert.equal(errors.length, 0);
// Refresh keeps timing data; re-import the identical MP3 to restore its binding.
await page.reload();
await page.getByRole("button", { name: "视频预览与导出", exact: true }).click();
await page
  .locator('input[type=file][accept="audio/mpeg,.mp3"]')
  .setInputFiles(resolve("work/mp4-regression/uploaded-test.mp3"));
await page.getByText("MP3 真实时长：", { exact: false }).waitFor();
await page.getByRole("button", { name: "准备完整视频", exact: true }).click();
await page.locator(".full-video-frame canvas").waitFor();
await page
  .getByRole("button", { name: "检查 MP4 服务连接（不调用 AI）" })
  .click();
await page.getByText("已验证连接、密钥和当前来源", { exact: false }).waitFor();
await page.getByRole("button", { name: "导出真实 MP4（H.264 + AAC）" }).click();
await page
  .getByRole("alert")
  .filter({ hasText: "离线测试：渲染服务暂时不可用" })
  .waitFor();
assert.equal(
  await page.getByRole("link", { name: "下载标准 MP4", exact: true }).count(),
  0,
);
await page.getByRole("button", { name: "重试导出 MP4（H.264 + AAC）" }).click();
await page
  .getByRole("link", { name: "下载标准 MP4", exact: true })
  .waitFor({ timeout: 180000 });
const video = page.locator("video.completed-video").first();
const url = await video.getAttribute("src");
const response = await fetch(url);
const bytes = Buffer.from(await response.arrayBuffer());
writeFileSync("work/mp4-regression/browser-export.mp4", bytes);
if (response.status !== 200 || !bytes.includes(Buffer.from("ftyp")))
  throw Error("invalid MP4");
await page.getByRole("button", { name: "继续播放", exact: true }).click();
await page
  .locator('input[type=file][accept="audio/mpeg,.mp3"]')
  .setInputFiles("work/mp4-regression/audio-0.mp3");
await page.waitForFunction(() => !document.querySelector(".full-video-frame"));
assert.equal(
  await page.locator(".video-studio > audio").evaluate((a) => a.paused),
  true,
);
await page.getByRole("button", { name: "准备完整视频", exact: true }).click();
await page.getByRole("alert").filter({ hasText: "必须先完成" }).waitFor();
assert.equal(
  await page.getByRole("link", { name: "下载标准 MP4", exact: true }).count(),
  1,
  "completed download must survive later editing",
);
if (errors.length) throw Error(errors.join("\n"));
console.log(
  JSON.stringify({
    result: "PASS",
    viewport: "820x1180 touch",
    scenes: 10,
    mp3Duration: duration,
    downloadBytes: bytes.length,
    mp4URL: url.replace(/token=.*/, "token=REDACTED"),
    browserErrors: errors,
  }),
);
await browser.close();
