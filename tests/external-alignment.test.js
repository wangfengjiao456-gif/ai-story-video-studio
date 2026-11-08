import test from "node:test";
import assert from "node:assert/strict";
import { sceneCues, validateCues } from "../src/video/alignment.js";
import { createAlignmentHandler } from "../api/align-audio.js";
import { createRendererStatus } from "../api/renderer-status.js";
import {
  initialProject,
  serializeProject,
  parseProject,
} from "../src/model.js";
import {
  buildVideoTimeline,
  frameAt,
  timingSignature,
} from "../src/video/timeline.js";
const req = {
  method: "POST",
  headers: { origin: "https://studio.test", host: "studio.test" },
  body: { audio: "SUQz", text: "One. Two.", confirmed: true },
};
const res = () => ({
  setHeader() {},
  status(n) {
    this.code = n;
    return this;
  },
  json(b) {
    this.body = b;
    return this;
  },
});
function fixture() {
  const p = initialProject();
  p.english = "One. Two.";
  p.scenes = [
    {
      id: "1",
      english: "One.",
      chinese: "一。",
      description: "",
      duration: 5,
      imageRef: {
        kind: "upload",
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1UAAAAASUVORK5CYII=",
      },
    },
    {
      id: "2",
      english: "Two.",
      chinese: "二。",
      description: "",
      duration: 5,
      imageRef: {
        kind: "upload",
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1UAAAAASUVORK5CYII=",
      },
    },
  ];
  const assets = {
    article: {
      external: true,
      text: p.english,
      speed: 0.8,
      duration: 5,
      fingerprint: "hash1",
      blob: new Blob(["mp3"]),
    },
  };
  return { p, assets };
}
test("forced words give actual speech starts/ends, reject missing/mismatched/nonfinite times", () => {
  const words = [
    { text: "One.", start: 0.5, end: 1 },
    { text: "Two.", start: 2, end: 3 },
  ];
  assert.deepEqual(
    sceneCues([{ english: "One." }, { english: "Two." }], words, 5),
    [
      { start: 0.5, end: 1 },
      { start: 2, end: 3 },
    ],
  );
  for (const bad of [
    [words[0]],
    [{ ...words[0], text: "Other" }, words[1]],
    [{ ...words[0], end: NaN }, words[1]],
  ])
    assert.throws(() =>
      sceneCues([{ english: "One." }, { english: "Two." }], bad, 5),
    );
  assert.equal(
    validateCues(
      [
        { start: 0, end: 2 },
        { start: 1, end: 3 },
      ],
      2,
      5,
    ),
    false,
  );
});
test("external audio cannot silently estimate; gaps, seek and export share exact frame coverage", () => {
  const { p, assets } = fixture();
  assert.throws(() => buildVideoTimeline(p, assets, 0.8), /必须先完成/);
  p.videoTiming = {
    signature: timingSignature(p, assets, 0.8, "article"),
    source: "forced",
    cues: [
      { start: 0.5, end: 1 },
      { start: 2, end: 3 },
    ],
  };
  const t = buildVideoTimeline(p, assets, 0.8);
  assert.equal(t.precision, "forced");
  assert.equal(frameAt(t, 2.2).sceneIndex, 1);
  assert.equal(frameAt(t, 1.5).plan.scene.english, "");
  assert.equal(frameAt(t, 0.7).plan.scene.english, "One.");
  assert.equal(frameAt(t, 4).plan.scene.english, "");
  assert.equal(
    t.frames.reduce((n, f) => n + f.frames, 0),
    150,
  );
  for (let i = 1; i < t.frames.length; i++)
    assert.equal(t.frames[i].start, t.frames[i - 1].end);
  assert.deepEqual(
    t.manifest.frames,
    t.frames.map((f) => ({ frames: f.frames })),
  );
  const copy = parseProject(serializeProject(p));
  assert.deepEqual(copy.videoTiming, p.videoTiming);
  p.scenes.push({ ...p.scenes[0], id: "third" });
  assert.doesNotThrow(() => serializeProject(p));
  assert.throws(() => buildVideoTimeline(p, assets, 0.8), /必须先完成/);
  p.scenes.pop();
  assets.article.fingerprint = "other-audio-same-size";
  assert.throws(() => buildVideoTimeline(p, assets, 0.8), /必须先完成/);
});
test("alignment server only sends key upstream, enforces origin/size and surfaces failure without writing timeline", async () => {
  let count = 0;
  const h = createAlignmentHandler({
    getKey: () => "server-secret",
    fetchImpl: async (url, options) => {
      count++;
      assert.equal(url, "https://api.elevenlabs.io/v1/forced-alignment");
      assert.equal(options.headers["xi-api-key"], "server-secret");
      assert.equal(options.body.get("text"), "One. Two.");
      return {
        ok: true,
        json: async () => ({
          words: [{ text: "One", start: 0, end: 1 }],
          api_key: "must-never-leak",
        }),
      };
    },
  });
  let r = res();
  await h(req, r);
  assert.equal(r.code, 200);
  assert.equal(JSON.stringify(r.body).includes("secret"), false);
  assert.equal(JSON.stringify(r.body).includes("must-never"), false);
  r = res();
  await h(
    { ...req, headers: { origin: "https://evil.test", host: "studio.test" } },
    r,
  );
  assert.equal(r.code, 403);
  assert.equal(count, 1);
  r = res();
  await h({ ...req, body: { ...req.body, audio: "x".repeat(4000001) } }, r);
  assert.equal(r.code, 400);
  assert.equal(count, 1);
  r = res();
  await createAlignmentHandler({ getKey: () => "" })(req, r);
  assert.equal(r.code, 503);
  r = res();
  await createAlignmentHandler({
    getKey: () => "key",
    fetchImpl: async () => ({ ok: false, status: 403 }),
  })(req, r);
  assert.match(r.body.error.message, /权限/);
  r = res();
  await createAlignmentHandler({
    getKey: () => "key",
    fetchImpl: async () => {
      throw Error("secret upstream");
    },
  })(req, r);
  assert.match(r.body.error.message, /网络/);
  assert.ok(!JSON.stringify(r.body).includes("secret"));
});
test("renderer readiness actually checks auth and origin, never claims ready on upstream failures", async () => {
  let r = res();
  await createRendererStatus({ getConfig: () => ({}) })(req, r);
  assert.equal(r.code, 503);
  const getConfig = () => ({
    url: "https://renderer.test",
    key: "private-render-key",
  });
  r = res();
  await createRendererStatus({
    getConfig,
    fetchImpl: async (url, o) => {
      assert.equal(url.href, "https://renderer.test/check");
      assert.equal(JSON.parse(o.body).origin, req.headers.origin);
      return { ok: true, json: async () => ({ ok: true }) };
    },
  })(req, r);
  assert.deepEqual(r.body, { ok: true });
  r = res();
  await createRendererStatus({
    getConfig,
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "来源未允许" }),
    }),
  })(req, r);
  assert.equal(r.code, 403);
  assert.match(r.body.error.message, /来源/);
  assert.ok(r.body.error.message.includes(req.headers.origin));
  assert.match(r.body.error.message, /原有内容后/);
  assert.ok(!r.body.error.message.includes("private-render-key"));
});
