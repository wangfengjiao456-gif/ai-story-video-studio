// Offline browser test. Alignment responses are MOCKS; FFmpeg and MP4 download are REAL.
// Start Vite :5173 and renderer :8099 using the test-only key below. Generate fixtures first.
// PLAYWRIGHT_MODULE may point to a locally installed playwright-core index.mjs.
import assert from "node:assert/strict";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright-core"
);
import { readFileSync, writeFileSync } from "node:fs";
const rendererBase = process.env.RENDERER_BASE || "http://localhost:8099";
const p = JSON.parse(
  readFileSync("work/mp4-regression/sample-project.json", "utf8"),
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
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
await page.route("**/api/renderer-status", async (route) => {
  const r = await fetch(rendererBase + "/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer offline-browser-key-0123456789",
    },
    body: JSON.stringify({ origin: "http://localhost:5173" }),
  });
  await route.fulfill({
    status: r.status,
    body: await r.text(),
    contentType: "application/json",
  });
});
await page.route("**/api/video-jobs", async (route) => {
  const r = await fetch(rendererBase + "/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer offline-browser-key-0123456789",
    },
    body: JSON.stringify({
      ...route.request().postDataJSON(),
      origin: "http://localhost:5173",
    }),
  });
  const data = await r.json();
  await route.fulfill({
    status: r.status,
    json: { ...data, baseUrl: rendererBase },
  });
});
let alignmentRequests = 0;
await page.route("**/api/align-audio", async (route) => {
  alignmentRequests++;
  const words = p.scenes.flatMap((scene, i) => {
    const parts = scene.english.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
    return parts.map((text, j) => ({
      text,
      start: i * 3.5 + 0.1 + (j * 2.8) / parts.length,
      end: i * 3.5 + 0.1 + ((j + 1) * 2.8) / parts.length,
    }));
  });
  await route.fulfill({ json: { words } });
});
await page.goto("http://localhost:5173");
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
  await inputs.nth(2 * i).fill(String((i * duration) / 10));
  await inputs.nth(2 * i + 1).fill(String(((i + 1) * duration) / 10));
}
await page.getByRole("button", { name: "确认并保存全部起止时间" }).click();
await page.locator(".full-video-frame canvas").waitFor();
const slider = page.getByRole("slider", { name: "完整视频进度" });
await slider.evaluate((e, d) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(e, d * 0.15);
  e.dispatchEvent(new Event("input", { bubbles: true }));
  e.dispatchEvent(new Event("change", { bubbles: true }));
}, duration);
await page.getByRole("button", { name: "预览分镜 2", exact: true }).waitFor();
await page.waitForFunction(() =>
  document
    .querySelector('button[aria-label="预览分镜 2"]')
    .classList.contains("current"),
);
await page.getByRole("button", { name: "继续播放", exact: true }).click();
await page.getByRole("button", { name: "暂停", exact: true }).click();
const stopped = Number(await slider.inputValue());
await page.waitForTimeout(180);
assert.ok(
  Math.abs(Number(await slider.inputValue()) - stopped) < 0.05,
  "paused clock drift",
);
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
  .getByRole("link", { name: "下载标准 MP4", exact: true })
  .waitFor({ timeout: 180000 });
const video = page.locator("video.completed-video").first();
const url = await video.getAttribute("src");
const response = await fetch(url);
const bytes = Buffer.from(await response.arrayBuffer());
writeFileSync("work/mp4-regression/browser-export.mp4", bytes);
if (response.status !== 200 || !bytes.includes(Buffer.from("ftyp")))
  throw Error("invalid MP4");
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
