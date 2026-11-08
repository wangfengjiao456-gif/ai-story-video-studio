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
p.aiSpeed = 0.9; // Exercise persistence of a non-default speed; production default remains .8.
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
let startedRenders = 0;
page.on("request", (request) => {
  if (request.method() === "POST" && request.url().endsWith("/start"))
    startedRenders++;
});
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript((project) => {
  if (!localStorage.getItem("story-studio-v1"))
    localStorage.setItem("story-studio-v1", JSON.stringify(project));
}, p);
// Exercise actual Vercel handlers in-process; only the paid provider is mocked.
const { createVideoJobHandler } = await import("../api/video-jobs.js");
const { createRendererStatus } = await import("../api/renderer-status.js");
const { createAlignmentHandler } = await import("../api/align-audio.js");
const { createHandler: createSpeechHandler } = await import(
  "../api/elevenlabs.js"
);
let speechRequests = 0;
await page.route("**/api/elevenlabs", (route) =>
  routeHandler(
    route,
    createSpeechHandler({
      getKey: () => "offline-speech-mock",
      fetchImpl: async (url, options) => {
        assert.ok(url.includes("NDTYOmYEjbDIVCKB35i3/with-timestamps"));
        const input = JSON.parse(options.body);
        assert.equal(input.model_id, "eleven_v3");
        assert.equal(input.voice_settings.speed, 0.9);
        assert.equal(input.language_code, "en");
        speechRequests++;
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
      headers: {
        origin: studioURL,
        host: new URL(studioURL).host,
        "content-type": "application/json",
      },
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
await page.getByPlaceholder("在这里写下你的英文故事…").fill(p.english);
await page
  .getByPlaceholder("输入对应中文译文；本版本不自动翻译。")
  .fill(p.chinese);
page.once("dialog", (dialog) => dialog.accept());
await page.getByRole("button", { name: "自动拆分分镜", exact: true }).click();
const picturePanels = page.locator(".scene-image-settings");
await picturePanels.nth(9).waitFor();
assert.equal(await picturePanels.count(), 10);
const upload = async (index, image) => {
  const panel = picturePanels.nth(index);
  await panel.locator("input[type=file]").setInputFiles({
    name: `test-${index}.png`,
    mimeType: "image/png",
    buffer: Buffer.from(image.split(",")[1], "base64"),
  });
  await page.waitForFunction(
    ({ index, image }) =>
      document
        .querySelectorAll(".scene-image-settings .uploaded-thumb")
        [index]?.getAttribute("src") === image,
    { index, image },
  );
};
for (let i = 0; i < 10; i++) await upload(i, p.scenes[i].imageRef.dataUrl);
await page.getByRole("button", { name: "下移分镜 1", exact: true }).click();
assert.equal(
  await picturePanels.nth(0).locator(".uploaded-thumb").getAttribute("src"),
  p.scenes[1].imageRef.dataUrl,
);
await page.getByRole("button", { name: "上移分镜 2", exact: true }).click();
await upload(0, p.scenes[1].imageRef.dataUrl);
await upload(0, p.scenes[0].imageRef.dataUrl);
// Valid PNG header but truncated body must not overwrite the previous illustration.
await picturePanels
  .nth(0)
  .locator("input[type=file]")
  .setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      p.scenes[0].imageRef.dataUrl.split(",")[1],
      "base64",
    ).subarray(0, 24),
  });
await picturePanels
  .nth(0)
  .getByRole("alert")
  .filter({ hasText: "无法解码" })
  .waitFor();
assert.equal(
  await picturePanels.nth(0).locator(".uploaded-thumb").getAttribute("src"),
  p.scenes[0].imageRef.dataUrl,
);

// Edit a real prompt, wait for autosave and reload without clicking Save.
const prompt =
  "A child in a green coat walks through the forest, soft picturebook light.";
await page
  .getByLabel(/画面描述 \/ 图片生成提示词/)
  .first()
  .fill(prompt);
await page.waitForFunction(
  (expected) =>
    JSON.parse(localStorage.getItem("story-studio-v1")).scenes[0]
      .description === expected,
  prompt,
);
await page.reload();
await page.getByRole("button", { name: "故事分镜", exact: true }).click();
assert.equal(
  await page
    .getByLabel(/画面描述 \/ 图片生成提示词/)
    .first()
    .inputValue(),
  prompt,
);
assert.equal(
  await page.locator(".scene-image-settings .uploaded-thumb").count(),
  10,
);

console.log("PASS prompt autosave and refresh / ten images restored");
// Real image endpoint contract, valid browser JPEG, mocked upstream SDK only.
const generatedJpeg = await page
  .locator(".scene-image-settings .uploaded-thumb")
  .first()
  .evaluate((img) => {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.9);
  });
const { createImageHandler } = await import("../api/openai-image.js");
let imageRequests = 0;
await page.route("**/api/service-status", (route) =>
  route.fulfill({
    json: {
      openai: true,
      elevenlabs: true,
      renderer: true,
      branch: "offline-mock",
      environment: "development",
    },
  }),
);
await page.route("**/api/openai-image", (route) =>
  routeHandler(
    route,
    createImageHandler({
      getKey: () => "offline-image-mock",
      createClient: () => ({
        images: {
          generate: async (options) => {
            imageRequests++;
            assert.equal(options.n, 1);
            assert.ok(options.prompt.includes(prompt));
            return { data: [{ b64_json: generatedJpeg.split(",")[1] }] };
          },
        },
      }),
    }),
  ),
);
await page
  .locator(".scene-image-settings")
  .first()
  .getByRole("button", { name: "AI 重新生成配图", exact: true })
  .click();
assert.equal(imageRequests, 0);
await page.getByRole("button", { name: "确认生成这一张", exact: true }).click();
await page.waitForFunction(
  (expected) =>
    document.querySelector(".scene-image-settings .uploaded-thumb")?.src ===
    expected,
  generatedJpeg,
);
assert.equal(imageRequests, 1);
p.scenes[0].imageRef = {
  kind: "generated",
  dataUrl: generatedJpeg,
  model: "gpt-image-2.5-sunburst",
  referenceUsed: false,
};
await page.waitForFunction(
  (expected) =>
    JSON.parse(localStorage.getItem("story-studio-v1")).scenes[0].imageRef
      ?.dataUrl === expected,
  generatedJpeg,
);

console.log("PASS mocked image generation and autosave");
// Exercise the remaining editing modules without contacting paid services.
await page.getByRole("button", { name: "角色与画风", exact: true }).click();
await page.getByLabel(/人物名称/).fill("回归人物");
await page.getByLabel(/外貌特征/).fill("短发，温柔的表情");
await page.getByLabel(/固定服装/).fill("深绿色外套");
await page
  .locator('input[type=file][accept="image/png,image/jpeg,image/webp"]')
  .setInputFiles({
    name: "character.png",
    mimeType: "image/png",
    buffer: Buffer.from(p.scenes[0].imageRef.dataUrl.split(",")[1], "base64"),
  });
await page.getByAltText("人物标准形象参考图").waitFor();
await page.getByRole("button", { name: "保存角色与项目", exact: true }).click();
assert.equal(
  await page.evaluate(
    () => JSON.parse(localStorage.getItem("story-studio-v1")).character.name,
  ),
  "回归人物",
);
await page.getByRole("button", { name: "配音与字幕", exact: true }).click();
await page.getByRole("button", { name: /模板 B · 渐变字幕遮罩/ }).click();
await page.getByRole("button", { name: /模板 A · 独立字幕区/ }).click();
await page.getByRole("button", { name: "AI 配音", exact: true }).click();
await page.getByText("NDTYOmYEjbDIVCKB35i3", { exact: true }).waitFor();
const aiCards = page.locator(".ai-clip");
await aiCards
  .first()
  .getByRole("button", { name: "生成英文配音", exact: true })
  .click();
await aiCards
  .first()
  .getByRole("button", { name: "下载 MP3", exact: true })
  .waitFor();
await aiCards
  .first()
  .getByRole("button", { name: "试听", exact: true })
  .click();
await page.waitForFunction(
  () => document.querySelector(".ai-player audio")?.currentTime > 0.1,
);
await page
  .locator(".ai-player")
  .getByRole("button", { name: "暂停", exact: true })
  .click();
const generatedDownload = page.waitForEvent("download");
await aiCards
  .first()
  .getByRole("button", { name: "下载 MP3", exact: true })
  .click();
await (
  await generatedDownload
).saveAs("work/mp4-regression/mock-generated-voice.mp3");
await aiCards
  .nth(1)
  .getByRole("button", { name: "生成英文配音", exact: true })
  .click();
await aiCards
  .nth(1)
  .getByRole("button", { name: "下载 MP3", exact: true })
  .waitFor();
console.log("PASS character/template and mocked speech workflow");
assert.equal(speechRequests, 2); // Actual server handler, mocked upstream; no paid generation.

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
await page.getByRole("button", { name: "继续播放", exact: true }).click();
await page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", {
    value: "hidden",
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
});
assert.equal(
  await page.locator(".video-studio > audio").evaluate((a) => a.paused),
  true,
);
await page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  window.dispatchEvent(new Event("pageshow"));
});
await page.getByRole("button", { name: "继续播放", exact: true }).click();
await page.getByRole("button", { name: "文章编辑", exact: true }).click();
assert.equal(
  await page.locator(".video-studio > audio").evaluate((a) => a.paused),
  true,
);
await page.getByRole("button", { name: "视频预览与导出", exact: true }).click();
// Atomic timing edits: failed drafts must not change confirmed project data or enable export.
const timingPanel = page.locator("details").filter({
  has: page.getByText("手动微调字幕切镜时间（秒）", { exact: true }),
});
await timingPanel.locator("summary").click();
const timingInputs = timingPanel.locator("input[type=number]");
await timingInputs.nth(1).fill(String(knownCues[0].end + 0.05));
await timingPanel
  .getByRole("button", { name: "应用起止时间", exact: true })
  .click();
await page.getByRole("alert").filter({ hasText: "不能重叠" }).waitFor();
await page.getByRole("button", { name: "保存项目", exact: true }).click();
assert.equal(
  await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("story-studio-v1")).videoTiming.cues[0]
        .end,
  ),
  knownCues[0].end,
);
await timingInputs.nth(2).fill(String(knownCues[1].start + 0.05));
await timingPanel
  .getByRole("button", { name: "应用起止时间", exact: true })
  .click();
await timingInputs.nth(1).fill(String(knownCues[0].end));
await timingInputs.nth(2).fill(String(knownCues[1].start));
await timingPanel
  .getByRole("button", { name: "应用起止时间", exact: true })
  .click();
await timingInputs.nth(0).fill("");
await timingPanel
  .getByRole("button", { name: "应用起止时间", exact: true })
  .click();
await page.getByRole("alert").filter({ hasText: "不能为空" }).waitFor();
await page.getByRole("button", { name: "放弃时间修改", exact: true }).click();
assert.equal(
  await timingInputs.nth(0).inputValue(),
  String(knownCues[0].start),
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
assert.equal(
  await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }),
  true,
  "unsaved timeline must warn before leaving",
);
await page.getByRole("button", { name: "保存项目", exact: true }).click();
assert.equal(
  await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }),
  false,
  "saved project should not keep the dirty warning",
);
const saved = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("story-studio-v1")),
);
assert.equal(saved.videoTiming.cues.length, 10);
assert.equal(saved.videoTiming.source, "manual");
assert.equal(saved.aiSpeed, 0.9);
assert.equal(errors.length, 0);
// Refresh keeps timing data; re-import the identical MP3 to restore its binding.
await page.reload();
assert.equal(
  await page.locator(".ai-voice-panel input[type=range]").inputValue(),
  "0.9",
);
await page.getByRole("button", { name: "视频预览与导出", exact: true }).click();
await page
  .locator('input[type=file][accept="audio/mpeg,.mp3"]')
  .setInputFiles(resolve("work/mp4-regression/uploaded-test.mp3"));
await page.getByText("MP3 真实时长：", { exact: false }).waitFor();
await page.getByRole("button", { name: "准备完整视频", exact: true }).click();
await page.locator(".full-video-frame canvas").waitFor();
console.log("PASS MP3 calibration, playback, persistence");
const frameEvidence = [];
for (const index of [0, 1, 3, 4, 8, 9]) {
  await slider.evaluate(
    (e, time) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(e, time);
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
    },
    (knownCues[index].start + knownCues[index].end) / 2,
  );
  await page.waitForFunction(
    (i) =>
      document
        .querySelector(`button[aria-label="预览分镜 ${i + 1}"]`)
        .classList.contains("current"),
    index,
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".full-video-frame canvas").toDataURL() ===
      document.querySelector(".preview-panel canvas").toDataURL(),
  );
  const snapshot = await page.evaluate(
    async ({ project, index }) => {
      const { framePlan, paintFrame, FONT_STACK } = await import(
        "/src/presentation/frameRenderer.js"
      );
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1920;
      canvas.hidden = true;
      document.body.appendChild(canvas);
      const ctx = canvas.getContext("2d"),
        measure = (ch, size) => {
          ctx.font = `600 ${size}px ${FONT_STACK}`;
          return ctx.measureText(ch).width;
        };
      const plan = framePlan(
        { ...project, ratio: "9:16" },
        project.scenes[index],
        measure,
      );
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = plan.scene.imageRef.dataUrl;
      });
      paintFrame(ctx, plan, 0, image);
      const actual = document
        .querySelector(".full-video-frame canvas")
        .toDataURL();
      const g = plan.geometry,
        page = plan.layout.pages[0],
        layout = plan.layout;
      const englishTop = g.height - g.bottom - page.height,
        englishHeight =
          page.english.length *
          layout.englishSize *
          plan.style.englishLineHeight;
      const png = canvas.toDataURL();
      canvas.remove();
      return {
        matches: png === actual,
        actual: actual.split(",")[1],
        png: png.split(",")[1],
        boxes: {
          english: [g.left, englishTop, g.textWidth, englishHeight],
          chinese: [
            g.left,
            englishTop + englishHeight + plan.style.gap,
            g.textWidth,
            page.chinese.length *
              layout.chineseSize *
              plan.style.chineseLineHeight,
          ],
        },
      };
    },
    { project: p, index },
  );
  const file = `work/mp4-regression/expected-scene-${index}.png`;
  writeFileSync(file, Buffer.from(snapshot.png, "base64"));
  if (!snapshot.matches) {
    writeFileSync(
      "work/mp4-regression/mismatched-preview.png",
      Buffer.from(snapshot.actual, "base64"),
    );
    throw Error(
      `Scene ${index} preview differs from independent expected frame`,
    );
  }
  frameEvidence.push({
    index,
    file,
    ...knownCues[index],
    boxes: snapshot.boxes,
    english: p.scenes[index].english,
    chinese: p.scenes[index].chinese,
  });
}
writeFileSync(
  "work/mp4-regression/frame-evidence.json",
  JSON.stringify(frameEvidence),
);
// Fail all automatic HEAD retries once: the completed file must survive and recover without a second /start.
let failedHeads = 0;
await page.route(`${rendererBase}/jobs/**`, async (route) => {
  if (route.request().method() === "HEAD" && failedHeads < 3) {
    failedHeads++;
    await route.abort("failed");
  } else await route.continue();
});
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
  .getByRole("button", { name: "恢复下载检查（不重新渲染）" })
  .waitFor({ timeout: 180000 });
assert.equal(startedRenders, 1);
assert.equal(
  await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }),
  true,
  "unfinished download must warn before leaving",
);
await page.getByRole("button", { name: "恢复下载检查（不重新渲染）" }).click();
await page
  .getByRole("link", { name: "下载标准 MP4", exact: true })
  .waitFor({ timeout: 180000 });
assert.equal(startedRenders, 1);
assert.equal(
  await page.locator("body > canvas[hidden]").count(),
  0,
  "export canvas must be released",
);
const video = page.locator("video.completed-video").first();
const url = await video.getAttribute("src");
const response = await fetch(url);
const bytes = Buffer.from(await response.arrayBuffer());
writeFileSync("work/mp4-regression/browser-export.mp4", bytes);
if (response.status !== 200 || !bytes.includes(Buffer.from("ftyp")))
  throw Error("invalid MP4");
// A structurally valid JSON with an undecodable image must not replace the live project/audio.
const invalidProject = structuredClone(saved);
invalidProject.scenes[1].imageRef.dataUrl =
  "data:image/png;base64," +
  Buffer.from(p.scenes[1].imageRef.dataUrl.split(",")[1], "base64")
    .subarray(0, 24)
    .toString("base64");
await page
  .locator('input[type=file][accept=".json,application/json"]')
  .setInputFiles({
    name: "broken-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(invalidProject)),
  });
await page.getByRole("status").filter({ hasText: "原项目未替换" }).waitFor();
assert.equal(
  await page.getByRole("link", { name: "下载标准 MP4", exact: true }).count(),
  1,
);
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
for (const width of [820, 390]) {
  await page.setViewportSize({ width, height: 1180 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    `horizontal overflow at ${width}px`,
  );
}
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
