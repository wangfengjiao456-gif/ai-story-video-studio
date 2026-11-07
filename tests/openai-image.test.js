// All tests use mocked SDK methods. No paid API calls or actual image synthesis.
import test from "node:test";
import assert from "node:assert/strict";
import { createImageHandler } from "../api/openai-image.js";
import {
  IMAGE_MODEL,
  imageInput,
  imagePrompt,
  imageSize,
} from "../src/imageConfig.js";
import {
  initialProject,
  splitArticle,
  parseProject,
  serializeProject,
} from "../src/model.js";
import { frameGeometry, subtitlePages } from "../src/presentation/layout.js";
import {
  framePlan,
  imageRectangle,
  paintFrame,
} from "../src/presentation/frameRenderer.js";
import {
  templateDefaults,
  normalizePresentation,
} from "../src/presentation/settings.js";
import { uploadImage, validateImageRef } from "../src/services/images.js";
import {
  generateSceneImage,
  generationSignature,
} from "../src/services/aiImages.js";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1UAAAAASUVORK5CYII=";
// Header-only JPEG mock: intentionally not a real rendered image.
const jpeg = Buffer.from([
  255, 216, 255, 192, 0, 17, 8, 0, 2, 0, 2, 3, 1, 17, 0, 2, 17, 1, 3, 17, 1,
  255, 217,
]).toString("base64");
const imageRef = {
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
const body = () => ({
  ...imageInput(project(), project().scenes[0]),
  confirmed: true,
});
const req = (patch) => ({
  method: "POST",
  headers: {
    origin: "https://studio.test",
    host: "studio.test",
    "content-type": "application/json",
  },
  body: body(),
  ...patch,
});
const res = () => ({
  statusCode: 0,
  headers: {},
  body: null,
  setHeader(k, v) {
    this.headers[k] = v;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(value) {
    this.body = value;
    return this;
  },
});
test("服务端缺 Key 返回明确错误，不调用 SDK", async () => {
  const r = res();
  await createImageHandler({
    getKey: () => "",
    createClient: () => assert.fail("不应调用 SDK"),
  })(req(), r);
  assert.equal(r.statusCode, 503);
  assert.match(r.body.error.message, /OPENAI_API_KEY/);
});
test("固定 GPT Image 模型，只生成一张，无客户端密钥/模型覆盖", async () => {
  let params, receivedKey;
  const r = res();
  await createImageHandler({
    getKey: () => "server-test-secret",
    createClient: (key) => {
      receivedKey = key;
      return {
        images: {
          generate: async (args) => {
            params = args;
            return { data: [{ b64_json: jpeg }] };
          },
          edit: () => assert.fail("不应编辑"),
        },
      };
    },
  })(req({ body: { ...body(), model: "evil", apiKey: "browser-key" } }), r);
  assert.equal(r.statusCode, 200);
  assert.equal(params.model, IMAGE_MODEL);
  assert.equal(params.n, 1);
  assert.equal(params.quality, "medium");
  assert.equal(params.output_format, "jpeg");
  assert.equal(receivedKey, "server-test-secret");
  assert.ok(!JSON.stringify(r).includes("server-test-secret"));
  assert.equal(r.body.imageRef.kind, "generated");
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.match(params.prompt, /发|brown|Emma/i);
  assert.match(params.prompt, /Do not include/);
});
test("有标准形象时用 images.edit，参考图作为 SDK File，不偷偷退回生成", async () => {
  let args;
  const r = res();
  await createImageHandler({
    getKey: () => "test",
    createClient: () => ({
      images: {
        generate: () => assert.fail("不能丢弃参考图"),
        edit: async (p) => {
          args = p;
          return { data: [{ b64_json: jpeg }] };
        },
      },
    }),
  })(
    req({ body: { ...body(), reference: { kind: "upload", dataUrl: png } } }),
    r,
  );
  assert.equal(r.statusCode, 200);
  assert.equal(args.image.type, "image/png");
  assert.equal(r.body.imageRef.referenceUsed, true);
  assert.match(args.prompt, /character identity reference/);
});
for (const [status, code, expected, pattern] of [
  [401, "", 401, /无效/],
  [403, "", 403, /权限/],
  [404, "", 403, /模型/],
  [429, "insufficient_quota", 402, /额度不足/],
  [429, "", 429, /频繁/],
  [400, "content_policy_violation", 400, /未被接受/],
  [500, "", 502, /生成失败/],
])
  test(`SDK 错误 ${status}/${code} 映射中文且不泄露原始错误`, async () => {
    let calls = 0;
    const r = res();
    await createImageHandler({
      getKey: () => "sensitive",
      createClient: () => ({
        images: {
          generate: async () => {
            calls++;
            throw Object.assign(Error("sensitive private stack"), {
              status,
              code,
            });
          },
        },
      }),
    })(req(), r);
    assert.equal(calls, 1);
    assert.equal(r.statusCode, expected);
    assert.match(r.body.error.message, pattern);
    assert.ok(!JSON.stringify(r).includes("sensitive"));
  });
test("缺少确认、跨站、非法内容/参考图在付费调用之前被拒绝", async () => {
  const handler = createImageHandler({
    getKey: () => "test",
    createClient: () => assert.fail("不得消耗额度"),
  });
  for (const request of [
    req({ body: { ...body(), confirmed: false } }),
    req({ body: { ...body(), ratio: "1:1" } }),
    req({ body: { ...body(), story: "x".repeat(12001) } }),
    req({
      body: {
        ...body(),
        reference: { kind: "upload", dataUrl: "https://evil.test" },
      },
    }),
    req({
      headers: {
        origin: "https://evil.test",
        host: "studio.test",
        "content-type": "application/json",
      },
    }),
  ]) {
    const r = res();
    await handler(request, r);
    assert.ok(r.statusCode >= 400);
  }
});
test("无图或过大的模拟输出不能虚报生成成功", async () => {
  for (const payload of [
    { data: [] },
    { data: [{ b64_json: "x".repeat(3 * 1024 * 1024 + 1) }] },
  ]) {
    const r = res();
    await createImageHandler({
      getKey: () => "test",
      createClient: () => ({ images: { generate: async () => payload } }),
    })(req(), r);
    assert.equal(r.statusCode, 502);
  }
});
test("客户端同源请求、模拟图片校验和生成元数据保存", async () => {
  const p = project();
  let endpoint, request;
  const result = await generateSceneImage(p, p.scenes[0], {
    fetchImpl: async (url, options) => {
      endpoint = url;
      request = options;
      return Response.json({ imageRef });
    },
  });
  assert.equal(endpoint, "/api/openai-image");
  assert.equal(JSON.parse(request.body).confirmed, true);
  assert.ok(!request.body.includes("apiKey"));
  validateImageRef(result);
  p.scenes[0].imageRef = result;
  p.character.referenceImage = { kind: "upload", dataUrl: png };
  assert.equal(
    serializeProject(parseProject(serializeProject(p))),
    serializeProject(p),
  );
});
test("失败不回传假图片、未知来源元数据或服务端 Key", async () => {
  const p = project();
  await assert.rejects(
    generateSceneImage(p, p.scenes[0], {
      fetchImpl: async () =>
        Response.json({ error: { message: "额度不足" } }, { status: 402 }),
    }),
    /额度不足/,
  );
  await assert.rejects(
    generateSceneImage(p, p.scenes[0], {
      fetchImpl: async () =>
        Response.json({ imageRef: { ...imageRef, model: "unknown" } }),
    }),
    /元数据/,
  );
});
test("原始上传字节保留，画幅与焦点变化不重新编码", async () => {
  const bytes = Buffer.from(png.split(",")[1], "base64");
  const file = new Blob([bytes], { type: "image/png" });
  const ref = await uploadImage(file, { decode: async () => {} });
  assert.equal(ref.dataUrl, png);
  const p = project();
  p.scenes[0].imageRef = ref;
  for (const ratio of ["9:16", "16:9", "4:5"]) {
    p.ratio = ratio;
    p.scenes[0].imageScale = 1.5;
    p.scenes[0].imagePosition = { x: 75, y: 30 };
    assert.equal(
      parseProject(serializeProject(p)).scenes[0].imageRef.dataUrl,
      png,
    );
  }
});
test("新默认位置上移，旧 V3 字段保留，三种画幅全部安全分页", () => {
  const p = project();
  assert.equal(p.subtitlePosition, 16);
  const old = normalizePresentation({
    ...p,
    subtitlePosition: 6,
    subtitleStyle: { ...templateDefaults(), height: 28 },
  });
  assert.equal(old.subtitlePosition, 6);
  assert.equal(old.subtitleStyle.height, 28);
  for (const ratio of ["9:16", "16:9", "4:5"])
    for (const position of [4, 12, 20])
      for (const topMargin of [16, 96]) {
        const style = {
          ...templateDefaults(),
          topMargin,
          englishLineHeight: 1.8,
          chineseLineHeight: 1.8,
          height: 25,
        };
        const geo = frameGeometry(style, position, ratio),
          layout = subtitlePages(
            "Long sentence ".repeat(40),
            "中文翻译".repeat(60),
            "both",
            style,
            geo,
          );
        assert.ok(layout.pages.every((page) => page.height <= geo.textHeight));
        assert.ok(geo.bottom + geo.top + geo.textHeight <= geo.height + 0.01);
      }
  assert.equal(frameGeometry(templateDefaults(), 12, "4:5").height, 1350);
  assert.equal(imageSize("16:9"), "1536x1024");
});
test("Contain/Cover 等比构图，不改变原始尺寸；PNG 与预览共用渲染计划", () => {
  const rect = imageRectangle(1000, 500, 1080, 1350, "contain", 1, {
    x: 50,
    y: 50,
  });
  assert.equal(rect.width / rect.height, 2);
  assert.equal(rect.width, 1080);
  assert.equal(rect.height, 540);
  const p = project();
  p.ratio = "16:9";
  const plan = framePlan(p, p.scenes[0]);
  assert.equal(plan.outputWidth / plan.outputHeight, 16 / 9);
  const operations = [];
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(
    { createLinearGradient: () => gradient },
    {
      get(target, key) {
        return key in target
          ? target[key]
          : (...args) => operations.push([key, ...args]);
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  paintFrame(ctx, plan, 0, null);
  assert.ok(operations.some((op) => op[0] === "fillText"));
  assert.ok(!operations.some((op) => JSON.stringify(op).includes("平台安全")));
  assert.ok(Math.abs(plan.geometry.bottom - 607.5 * 0.16) < 1e-8);
});
test("角色/故事快照变化时签名改变，显示裁切不影响生成输入", () => {
  const p = project(),
    s = p.scenes[0],
    signature = generationSignature(p, s);
  s.imageScale = 1.5;
  assert.equal(generationSignature(p, s), signature);
  p.character.clothing += " changed";
  assert.notEqual(generationSignature(p, s), signature);
  assert.match(imagePrompt(imageInput(p, s)), /fixed clothing/);
});
