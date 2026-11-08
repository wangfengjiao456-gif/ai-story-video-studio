// Real browser/offline audio/FFmpeg; upstream paid APIs are MOCKS.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { chromium } from "playwright";
import { createHandler as speechHandler } from "../api/elevenlabs.js";
import { createImageHandler } from "../api/openai-image.js";
import { createPlanningHandler } from "../api/plan-story.js";
import { createRendererStatus } from "../api/renderer-status.js";
import { createVideoJobHandler } from "../api/video-jobs.js";
import { localPlan } from "../src/creation/planning.js";
const base = process.env.STUDIO_URL || "http://127.0.0.1:6173",
  worker = process.env.RENDERER_BASE || "http://127.0.0.1:8199";
mkdirSync("work/v4-regression", { recursive: true });
rmSync("work/v4-regression/report.json", { force: true });
const p = JSON.parse(
  readFileSync("work/mp4-regression/sample-project.json", "utf8"),
);
const manifest = JSON.parse(
  readFileSync("work/mp4-regression/manifest.json", "utf8"),
);
let elapsed = 0;
const cues = manifest.audios.map((a) => {
  const start = elapsed;
  elapsed += a.duration;
  return { start, end: elapsed };
});
const canvas = createCanvas(1080, 1920);
canvas
  .getContext("2d")
  .drawImage(await loadImage(p.scenes[0].imageRef.dataUrl), 0, 0, 1080, 1920);
const jpeg = canvas.toBuffer("image/jpeg").toString("base64");
p.scenes[0].imageRef = null;
p.scenes[1].imageRef = null;
const music = "work/v4-regression/music.mp3";
assert.equal(
  spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:duration=8",
    "-c:a",
    "libmp3lame",
    "-y",
    music,
  ]).status,
  0,
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 820, height: 1180 },
    isMobile: true,
    hasTouch: true,
  });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((project) => {
    if (!localStorage.getItem("story-studio-v1"))
      localStorage.setItem("story-studio-v1", JSON.stringify(project));
  }, p);
  async function handle(route, handler) {
    let status = 200,
      body;
    const headers = {};
    await handler(
      {
        method: route.request().method(),
        headers: {
          origin: base,
          host: new URL(base).host,
          "content-type": "application/json",
        },
        body: route.request().postDataJSON(),
      },
      {
        setHeader(k, v) {
          headers[k] = v;
        },
        status(n) {
          status = n;
          return this;
        },
        json(b) {
          body = b;
          return this;
        },
      },
    );
    await route.fulfill({
      status,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const getConfig = () => ({
    url: worker,
    key: "offline-browser-key-0123456789",
  });
  await page.route("**/api/renderer-status", (r) =>
    handle(r, createRendererStatus({ getConfig })),
  );
  await page.route("**/api/video-jobs", (r) =>
    handle(r, createVideoJobHandler({ getConfig })),
  );
  await page.route("**/api/service-status", (r) =>
    r.fulfill({
      json: {
        openai: true,
        elevenlabs: true,
        renderer: true,
        environment: "mock",
        branch: "V4-offline",
      },
    }),
  );
  const imagePrompts = [];
  let plans = 0,
    images = 0,
    voices = 0;
  await page.route("**/api/plan-story", (r) =>
    handle(
      r,
      createPlanningHandler({
        getKey: () => "offline-mock",
        createClient: () => ({
          responses: {
            create: async () => {
              plans++;
              return {
                status: "completed",
                output_text: JSON.stringify(localPlan(p)),
              };
            },
          },
        }),
      }),
    ),
  );
  await page.route("**/api/openai-image", (r) =>
    handle(
      r,
      createImageHandler({
        getKey: () => "offline-mock",
        createClient: () => ({
          images: {
            generate: async (options) => {
              imagePrompts.push(options.prompt);
              images++;
              return { data: [{ b64_json: jpeg }] };
            },
          },
        }),
      }),
    ),
  );
  await page.route("**/api/elevenlabs", (r) =>
    handle(
      r,
      speechHandler({
        getKey: () => "offline-mock",
        fetchImpl: async (url, options) => {
          voices++;
          const b = JSON.parse(options.body);
          assert.equal(b.model_id, "eleven_v3");
          assert.equal(b.voice_settings.speed, 0.8);
          assert.ok(url.includes("NDTYOmYEjbDIVCKB35i3"));
          return Response.json({
            audio_base64: readFileSync(
              "work/mp4-regression/uploaded-test.mp3",
            ).toString("base64"),
            alignment: null,
          });
        },
      }),
    ),
  );
  await page.goto(base);
  await page.getByRole("button", { name: "AI 智能制作", exact: true }).click();
  await page.getByRole("button", { name: "免费本地规划", exact: true }).click();
  assert.equal(plans, 0);
  await page.getByRole("button", { name: "放弃草稿", exact: true }).click();
  await page
    .getByRole("button", { name: "AI 智能规划（付费）", exact: true })
    .click();
  assert.equal(plans, 0);
  await page.getByRole("button", { name: "确认规划一次", exact: true }).click();
  await page.getByLabel(/审核中文标题/).waitFor();
  assert.equal(plans, 1);
  await page
    .getByRole("button", { name: "确认内容并应用规划（免费）", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("story-studio-v1")).cover?.enabled ===
      true,
  );
  const planned = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("story-studio-v1")),
  );
  assert.equal(planned.english, p.english);
  assert.equal(planned.chinese, p.chinese);
  assert.equal(planned.cover.duration, 3);
  assert.equal(planned.creation.beats.length, 10);
  await page
    .getByRole("button", { name: "审核并继续未完成的生成", exact: true })
    .click();
  assert.equal(images, 0);
  assert.equal(voices, 0);
  await page
    .getByRole("button", { name: "确认本次预计请求并开始", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector(".video-studio").hidden,
  );
  assert.equal(images, 3);
  assert.equal(voices, 1); // Eight existing illustrations are preserved; cover and two missing scenes are generated.
  await page.getByRole("button", { name: "文章编辑", exact: true }).click();
  await page.getByRole("button", { name: "AI 智能制作", exact: true }).click();
  await page
    .getByRole("button", { name: "审核并继续未完成的生成", exact: true })
    .click();
  await page
    .getByRole("button", { name: "确认本次预计请求并开始", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector(".video-studio").hidden,
  );
  assert.equal(images, 3);
  assert.equal(voices, 1);
  assert.equal(new Set(imagePrompts).size, 3);
  console.log(
    "PASS planning review, one confirmation, missing-only batch, original text retained",
  );

  await page
    .locator('input[type=file][accept="audio/mpeg,.mp3"]')
    .setInputFiles("work/mp4-regression/uploaded-test.mp3");
  await page.getByText("MP3 真实时长：", { exact: false }).waitFor();
  await page
    .getByText("手动填写 / 校对每镜开始与结束时间", { exact: true })
    .click();
  const section = page
      .locator("section.note")
      .filter({ hasText: "MP3 真实时长：" }),
    inputs = section.locator("input[type=number]");
  for (let i = 0; i < 10; i++) {
    await inputs.nth(i * 2).fill(String(cues[i].start));
    await inputs.nth(i * 2 + 1).fill(String(cues[i].end));
  }
  await section
    .getByRole("button", { name: "确认并保存全部起止时间", exact: true })
    .click();
  await page
    .getByText("背景音乐 · 上传、音量、自动压低与淡入淡出", { exact: true })
    .click();
  await page
    .locator('input[type=file][accept="audio/mpeg,.mp3,audio/mp3"]')
    .setInputFiles(music);
  await page.getByRole("button", { name: /^(重新)?准备完整视频$/ }).click();
  await page.locator(".full-video-frame canvas").waitFor();
  const slider = page.getByRole("slider", { name: "完整视频进度" });
  const seek = async (time) =>
    slider.evaluate((e, t) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(e, t);
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
    }, time);
  const total = Number(await slider.getAttribute("max"));
  assert.ok(Math.abs(total - (elapsed + 3)) < 0.04);
  await page
    .getByRole("button", { name: /^从(第 1 镜|封面00)重播$/ })
    .first()
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".video-studio > audio")
      ?.getAttribute("src")
      ?.startsWith("blob:"),
  );
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const wavURL = await page
    .locator(".video-studio > audio")
    .getAttribute("src");
  assert.ok(wavURL.startsWith("blob:"));
  const wav = await page.evaluate(
    async (url) =>
      Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),
    wavURL,
  );
  writeFileSync("work/v4-regression/preview-mix.wav", Buffer.from(wav));
  assert.equal(Buffer.from(wav).subarray(0, 4).toString(), "RIFF");
  writeFileSync(
    "work/v4-regression/cover.png",
    Buffer.from(
      await page
        .locator(".full-video-frame canvas")
        .evaluate((c) => c.toDataURL().split(",")[1]),
      "base64",
    ),
  );
  await seek(cues[1].start + 3 + 0.1);
  await page.waitForFunction(() =>
    document.querySelector(".preview-count").textContent.includes("02"),
  );
  await page
    .getByRole("button", { name: /^从(第 1 镜|封面00)重播$/ })
    .first()
    .click();
  await page.waitForFunction(
    () => !document.querySelector(".video-studio > audio").paused,
  );
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await seek(1);
  await page.waitForFunction(() =>
    document.querySelector(".preview-count").textContent.includes("封面 00"),
  );
  await page
    .getByRole("button", { name: "检查 MP4 服务连接（不调用 AI）" })
    .click();
  await page
    .getByText("已验证连接、密钥和当前来源", { exact: false })
    .waitFor();
  await page
    .getByRole("button", { name: "导出真实 MP4（H.264 + AAC）" })
    .click();
  await page
    .getByRole("link", { name: "下载标准 MP4", exact: true })
    .waitFor({ timeout: 180000 });
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载标准 MP4", exact: true }).click();
  await (await downloading).saveAs("work/v4-regression/cover-music.mp4");
  const output = JSON.parse(
    spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        "work/v4-regression/cover-music.mp4",
      ],
      { encoding: "utf8" },
    ).stdout,
  );
  assert.ok(
    output.streams.some(
      (s) => s.codec_name === "h264" && s.width === 1080 && s.height === 1920,
    ),
  );
  assert.ok(output.streams.some((s) => s.codec_name === "aac"));
  assert.ok(Math.abs(Number(output.format.duration) - total) < 0.04);
  // Decode actual frame 0 and compare to browser cover, with real H.264 compression.
  const rawFrame = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      "work/v4-regression/cover-music.mp4",
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "pipe:1",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  ).stdout;
  writeFileSync("work/v4-regression/export-cover.png", rawFrame);
  const expectedCanvas = createCanvas(1080, 1920),
    actualCanvas = createCanvas(1080, 1920);
  expectedCanvas
    .getContext("2d")
    .drawImage(await loadImage("work/v4-regression/cover.png"), 0, 0);
  actualCanvas.getContext("2d").drawImage(await loadImage(rawFrame), 0, 0);
  const ePixels = expectedCanvas
      .getContext("2d")
      .getImageData(0, 0, 1080, 1920).data,
    aPixels = actualCanvas.getContext("2d").getImageData(0, 0, 1080, 1920).data;
  let delta = 0;
  for (let i = 0; i < ePixels.length; i++)
    if (i % 4 !== 3) delta += Math.abs(ePixels[i] - aPixels[i]);
  const coverMAE = delta / (1080 * 1920 * 3);
  assert.ok(coverMAE < 12, `cover MAE ${coverMAE}`);
  const samples = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    "work/v4-regression/cover-music.mp4",
    "-t",
    "2",
    "-vn",
    "-ar",
    "8000",
    "-ac",
    "1",
    "-f",
    "s16le",
    "pipe:1",
  ]).stdout;
  let power = 0;
  for (let i = 8000; i < 16000; i += 2) power += samples.readInt16LE(i) ** 2;
  assert.ok(
    Math.sqrt(power / 4000) > 15,
    "BGM is audible during the silent title cover",
  );
  assert.equal(errors.length, 0);
  // Refresh: restore paid voice from origin-scoped IndexedDB without another API call.
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("story-studio-v1")).voiceRecords?.length >
      0,
  );
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("story-studio-v1"));
    delete p.scenes[0].imageRef;
    delete p.cover.imageRef;
    localStorage.setItem("story-studio-v1", JSON.stringify(p));
  });
  await page.reload();
  await page.getByRole("button", { name: "AI 智能制作", exact: true }).click();
  await page
    .getByRole("button", { name: "审核并继续未完成的生成", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("checkbox")
      .filter({ hasText: "可能再次计费" })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "确认本次预计请求并开始", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector(".video-studio").hidden,
  );
  assert.equal(voices, 1);
  assert.equal(images, 3);
  assert.equal(plans, 1);
  console.log(
    "PASS refresh restores generated voice without repeat billing; music still requires its original file",
  );
  for (const width of [390, 820]) {
    await page.setViewportSize({ width, height: 1180 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  }
  writeFileSync(
    "work/v4-regression/report.json",
    JSON.stringify(
      {
        result: "PASS",
        source: "mock planning/image/TTS; real offline mixer, FFmpeg, download",
        plans,
        images,
        voices,
        coverSeconds: 3,
        coverMAE,
        total,
        outputDuration: output.format.duration,
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "V4 PASS: cover + ten story scenes + uploaded BGM + voice, real MP4 download",
    output.format.duration,
  );
} finally {
  await browser.close();
}
