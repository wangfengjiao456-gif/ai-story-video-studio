import test from "node:test";
import assert from "node:assert/strict";
import {
  initialProject,
  uid,
  serializeProject,
  parseProject,
} from "../src/model.js";
import { buildVideoTimeline, frameAt, audioAt } from "../src/video/timeline.js";
import { renderVideo } from "../src/video/exportClient.js";
import statusHandler from "../api/service-status.js";
import { createVideoJobHandler } from "../api/video-jobs.js";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1UAAAAASUVORK5CYII=";
function fixture() {
  const p = initialProject();
  p.scenes = Array.from({ length: 10 }, (_, i) => ({
    id: uid(),
    english: `Take small step ${i + 1}.`,
    chinese: `每天进步第${i + 1}步。`,
    description: "离线回归样本",
    duration: 5,
    imageRef: { kind: "upload", dataUrl: png },
  }));
  p.english = p.scenes.map((s) => s.english).join(" ");
  const assets = {
    article: {
      text: p.english,
      speed: 0.8,
      duration: 50,
      blob: new Blob(["mock mp3"]),
    },
  };
  for (const s of p.scenes)
    assets[s.id] = {
      text: s.english,
      speed: 0.8,
      duration: 5,
      blob: new Blob(["mock clip"]),
    };
  return { p, assets };
}
const res = () => ({
  headers: {},
  setHeader(k, v) {
    this.headers[k] = v;
  },
  status(s) {
    this.statusCode = s;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
test("10 分镜统一时轴完整覆盖真实音频，预览与导出使用相同帧对象", () => {
  const { p, assets } = fixture();
  const t = buildVideoTimeline(p, assets, 0.8);
  assert.equal(t.ranges.length, 10);
  assert.equal(t.duration, 50);
  assert.equal(t.precision, "estimated");
  assert.equal(
    t.frames.reduce((n, f) => n + f.frames, 0),
    1500,
  );
  assert.equal(frameAt(t, 0).sceneIndex, 0);
  assert.equal(frameAt(t, 50).sceneIndex, 9);
  assert.ok(
    t.frames.every(
      (f) => f.plan.outputWidth === 1080 && f.plan.outputHeight === 1920,
    ),
  );
  assert.deepEqual(
    t.manifest.frames,
    t.frames.map((f) => ({ frames: f.frames })),
  );
});
test("有效 API 字符对齐优先；逐镜时轴按真实 MP3 时长累加", () => {
  const { p, assets } = fixture();
  const chars = [...p.english];
  assets.article.alignment = {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => (i / chars.length) * 50),
    character_end_times_seconds: chars.map(
      (_, i) => ((i + 1) / chars.length) * 50,
    ),
  };
  assert.equal(buildVideoTimeline(p, assets, 0.8).precision, "aligned");
  const t = buildVideoTimeline(p, assets, 0.8, "scenes");
  assert.equal(t.precision, "clips");
  assert.equal(audioAt(t, 12).index, 2);
  assert.equal(audioAt(t, 12).offset, 2);
});
test("手动微调保存刷新不丢失，文字改变后旧音频不能导出", () => {
  const { p, assets } = fixture();
  const t = buildVideoTimeline(p, assets, 0.8);
  p.videoTiming = {
    signature: t.signature,
    boundaries: [0, 4, 10, 15, 20, 25, 30, 35, 40, 45, 50],
  };
  const restored = parseProject(serializeProject(p));
  assert.deepEqual(restored.videoTiming, p.videoTiming);
  assert.equal(buildVideoTimeline(p, assets, 0.8).precision, "manual");
  assert.equal(buildVideoTimeline(p, assets, 0.8).ranges[1].start, 4);
  p.english += "Changed.";
  assert.throws(() => buildVideoTimeline(p, assets, 0.8), /MP3/);
});
test("缺图、缺音频、过期音频、无真实时长和错误手动边界明确拒绝", () => {
  let { p, assets } = fixture();
  delete p.scenes[4].imageRef;
  assert.throws(() => buildVideoTimeline(p, assets, 0.8), /分镜 5/);
  ({ p, assets } = fixture());
  assets.article.duration = null;
  assert.throws(() => buildVideoTimeline(p, assets, 0.8), /时长/);
  ({ p, assets } = fixture());
  assets[p.scenes[3].id].text = "changed";
  assert.throws(() => buildVideoTimeline(p, assets, 0.8, "scenes"), /分镜 4/);
  p.videoTiming = { signature: "bad", boundaries: [0] };
  assert.throws(() => serializeProject(p), /时间轴/);
});
test("未部署渲染服务时不会上传帧或虚报完成", async () => {
  const { p, assets } = fixture();
  await assert.rejects(
    renderVideo(
      buildVideoTimeline(p, assets, 0.8, "scenes"),
      () => assert.fail("不应制作上传帧"),
      {
        fetchImpl: async () =>
          Response.json(
            { error: { message: "渲染服务尚未部署" } },
            { status: 503 },
          ),
      },
    ),
    /尚未部署/,
  );
});
test("服务状态只返回布尔状态和分支信息，不返回任何 Key 值", () => {
  const r = res();
  statusHandler({ method: "GET" }, r);
  assert.equal(typeof r.body.elevenlabs, "boolean");
  assert.equal(typeof r.body.openai, "boolean");
  assert.ok(r.body.guidance.includes("feat/elevenlabs-v2"));
  assert.ok(!("key" in r.body));
  assert.equal(r.headers["Cache-Control"], "no-store");
});
test("视频任务代理只向固定渲染服务发送服务密钥，不返回给浏览器", async () => {
  const r = res();
  let options;
  const handler = createVideoJobHandler({
    getConfig: () => ({
      url: "https://renderer.test",
      key: "server-only-test-key",
    }),
    fetchImpl: async (url, o) => {
      options = o;
      assert.equal(url.origin, "https://renderer.test");
      return Response.json({
        jobId: "a".repeat(32),
        token: "job-scoped-token",
        expiresAt: 123,
      });
    },
  });
  await handler(
    {
      method: "POST",
      headers: { origin: "https://studio.test", host: "studio.test" },
      body: {},
    },
    r,
  );
  assert.equal(r.statusCode, 200);
  assert.equal(options.headers.Authorization, "Bearer server-only-test-key");
  assert.ok(!JSON.stringify(r.body).includes("server-only-test-key"));
  assert.equal(r.body.token, "job-scoped-token");
});
