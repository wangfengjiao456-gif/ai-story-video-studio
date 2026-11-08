// Offline mocks only: no paid API, no real keys.
import test from "node:test";
import assert from "node:assert/strict";
import {
  initialProject,
  splitArticle,
  serializeProject,
  parseProject,
} from "../src/model.js";
import {
  localPlan,
  applyPlan,
  validatePlan,
} from "../src/creation/planning.js";
import {
  coverDefaults,
  musicDefaults,
  SIGNATURE_STYLE,
} from "../src/creation/project.js";
import { createPlanningHandler } from "../api/plan-story.js";
import { envelope, pcmWav } from "../src/creation/audioMix.js";
import {
  buildVideoTimeline,
  frameAt,
  timingSignature,
} from "../src/video/timeline.js";
const p = () => {
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  return p;
};
const ref = {
  kind: "upload",
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1UAAAAASUVORK5CYII=",
};
const res = () => ({
  setHeader() {},
  status(n) {
    this.code = n;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
test("V4 local planning creates every editable prompt and preserves bilingual original, character and images", () => {
  const project = p();
  project.scenes[0].imageRef = ref;
  const original = project.english,
    chinese = project.chinese;
  const plan = localPlan(project);
  assert.equal(plan.beats.length, project.scenes.length);
  assert.notEqual(plan.beats[0].prompt, plan.beats[1].prompt);
  const next = applyPlan(project, plan, "local");
  assert.equal(next.english, original);
  assert.equal(next.chinese, chinese);
  assert.equal(next.scenes[0].imageRef, ref);
  assert.equal(next.style, SIGNATURE_STYLE);
  assert.equal(next.cover.duration, 3);
  assert.equal(next.creation.source, "local");
  assert.equal(
    serializeProject(parseProject(serializeProject(next))),
    serializeProject(next),
  );
  const old = structuredClone(project);
  delete old.cover;
  assert.equal(parseProject(serializeProject(old)).cover, undefined);
  next.scenes[1].description = "new specific action";
  assert.equal(next.scenes[0].description, plan.beats[0].prompt);
  assert.throws(
    () =>
      validatePlan(
        { ...plan, beats: plan.beats.slice(1) },
        project.scenes.length,
      ),
    /数量/,
  );
  assert.throws(
    () =>
      serializeProject({ ...next, music: { ...musicDefaults(), volume: 2 } }),
    /音乐/,
  );
});
test("paid structured planning requires confirmation, sends one schema request and never returns key or rewritten original", async () => {
  const project = p(),
    plan = localPlan(project);
  let calls = 0;
  const handler = createPlanningHandler({
    getKey: () => "server-private",
    createClient: () => ({
      responses: {
        create: async (options) => {
          calls++;
          assert.equal(options.store, false);
          assert.equal(options.text.format.strict, true);
          assert.equal(options.model, "gpt-5-mini");
          return { status: "completed", output_text: JSON.stringify(plan) };
        },
      },
    }),
  });
  const req = {
    method: "POST",
    headers: {
      origin: "https://studio.test",
      host: "studio.test",
      "content-type": "application/json",
    },
    body: {
      english: project.english,
      chinese: project.chinese,
      scenes: project.scenes,
      confirmed: false,
    },
  };
  let r = res();
  await handler(req, r);
  assert.equal(r.code, 400);
  assert.equal(calls, 0);
  r = res();
  await handler({ ...req, body: { ...req.body, confirmed: true } }, r);
  assert.equal(calls, 1);
  assert.equal(r.code, 200);
  assert.ok(!JSON.stringify(r).includes("server-private"));
  assert.equal(r.body.plan.beats.length, project.scenes.length);
  r = res();
  await handler(
    { ...req, headers: { ...req.headers, origin: "https://evil.test" } },
    r,
  );
  assert.equal(r.code, 403);
  assert.equal(calls, 1);
});
test("planning malformed/failed model output keeps project and does not retry paid requests", async () => {
  for (const err of [
    { status: 429 },
    { status: 401 },
    { code: "insufficient_quota" },
    null,
  ]) {
    let calls = 0;
    const r = res(),
      project = p();
    await createPlanningHandler({
      getKey: () => "private",
      createClient: () => ({
        responses: {
          create: async () => {
            calls++;
            if (err) throw Object.assign(Error("private"), err);
            return { status: "completed", output_text: '{"title":"bad"}' };
          },
        },
      }),
    })(
      {
        method: "POST",
        headers: {
          origin: "https://a.test",
          host: "a.test",
          "content-type": "application/json",
        },
        body: {
          english: project.english,
          chinese: project.chinese,
          scenes: project.scenes,
          confirmed: true,
        },
      },
      r,
    );
    assert.equal(calls, 1);
    assert.ok(r.code >= 400);
    assert.ok(!JSON.stringify(r).includes("private"));
  }
});
test("cover frames add 3 seconds without moving stored narration-relative cues; preview/export share frame and audio data", () => {
  const project = p();
  for (const s of project.scenes) s.imageRef = ref;
  const asset = {
    text: project.english,
    speed: 0.8,
    duration: 9,
    blob: new Blob(["mock"]),
    url: "blob:original",
    external: true,
    fingerprint: "test",
  };
  project.videoTiming = {
    signature: timingSignature(project, { article: asset }, 0.8, "article"),
    source: "manual",
    cues: [
      { start: 0, end: 2 },
      { start: 4, end: 6 },
      { start: 7, end: 9 },
    ],
  };
  project.cover = {
    ...coverDefaults(),
    enabled: true,
    title: "每天一点进步",
    imageRef: ref,
  };
  const raw = buildVideoTimeline(project, { article: asset }, 0.8);
  assert.equal(raw.duration, 12);
  assert.equal(raw.narrationDuration, 9);
  assert.equal(raw.requiresMix, true);
  assert.equal(frameAt(raw, 2.99).isCover, true);
  assert.equal(frameAt(raw, 3).sceneIndex, 0);
  assert.equal(frameAt(raw, 7).sceneIndex, 1);
  assert.equal(frameAt(raw, 6).plan.scene.english, "");
  assert.equal(raw.ranges[1].start, 4);
  const mixed = {
    url: "blob:mixed",
    blob: pcmWav(new Float32Array(32000 * 12)),
    duration: 12,
    encoding: "wav",
  };
  const t = buildVideoTimeline(
    project,
    { article: asset },
    0.8,
    "article",
    undefined,
    mixed,
  );
  assert.equal(t.requiresMix, false);
  assert.equal(t.manifest.audios[0].encoding, "wav");
  assert.equal(t.audios[0], mixed);
  assert.equal(
    t.manifest.frames.reduce((n, f) => n + f.frames, 0),
    360,
  );
  const restored = parseProject(serializeProject(project));
  assert.equal(restored.cover.duration, 3);
  assert.deepEqual(restored.videoTiming.cues, project.videoTiming.cues);
});
test("music envelope ducks only around sentence cues, fades both ends and WAV preserves duration/sample format", async () => {
  const s = musicDefaults(),
    cues = [{ start: 2, end: 4 }];
  assert.equal(envelope(0, 10, s, cues), 0);
  assert.equal(envelope(10, 10, s, cues), 0);
  assert.equal(envelope(3, 10, s, cues), 0.025);
  assert.equal(envelope(6, 10, s, cues), 0.1);
  const blob = pcmWav(new Float32Array(32000));
  const v = new DataView(await blob.arrayBuffer());
  assert.equal(v.getUint32(24, true), 32000);
  assert.equal(v.getUint32(40, true), 64000);
  assert.equal(blob.type, "audio/wav");
});

test("paid planning draft survives JSON/ID migration without leaking unknown properties", () => {
  const project = p(),
    plan = localPlan(project);
  project.creationDraft = {
    source: "ai",
    signature: JSON.stringify([project.english, project.chinese]),
    plan: { ...plan, apiKey: "must-drop" },
  };
  const serialized = serializeProject(project);
  assert.ok(!serialized.includes("must-drop"));
  const restored = parseProject(serialized);
  assert.equal(restored.creationDraft.plan.coverPrompt, plan.coverPrompt);
  assert.equal(restored.creationDraft.source, "ai");
});

test("V4 WAV jobs reject an old Render before creating/uploading a task", async () => {
  const { createVideoJobHandler } = await import("../api/video-jobs.js");
  for (const supported of [false, true]) {
    let calls = 0;
    const r = res();
    await createVideoJobHandler({
      getConfig: () => ({
        url: "https://worker.test/",
        key: "private-render-key",
      }),
      fetchImpl: async (url) => {
        calls++;
        if (url.pathname === "/check")
          return Response.json({
            ok: true,
            ...(supported ? { capabilities: { pcmWav: true } } : {}),
          });
        assert.equal(url.pathname, "/jobs");
        return Response.json({
          jobId: "a".repeat(32),
          token: "test-job-token",
          expiresAt: 200,
        });
      },
    })(
      {
        method: "POST",
        headers: { origin: "https://studio.test", host: "studio.test" },
        body: { version: 1, audios: [{ duration: 3, encoding: "wav" }] },
      },
      r,
    );
    assert.equal(r.code, supported ? 200 : 503);
    assert.equal(calls, supported ? 2 : 1);
    assert.ok(!JSON.stringify(r).includes("private-render-key"));
    if (!supported) assert.match(r.body.error.message, /不支持V4/);
  }
});

test("local media journal confirms transaction commit, preserves data on failure and stores no SDK keys", async () => {
  const { mediaTransaction, mediaKey, cachedVoiceRecord } = await import(
    "../src/creation/mediaStore.js"
  );
  const values = new Map();
  let fail = false,
    committed = false;
  const factory = {
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = {
          close() {},
          createObjectStore() {},
          transaction() {
            const tx = {};
            tx.objectStore = () => ({
              get(key) {
                const op = {};
                queueMicrotask(() => {
                  op.result = values.get(key);
                  op.onsuccess?.();
                  queueMicrotask(() => tx.oncomplete?.());
                });
                return op;
              },
              put(value, key) {
                const op = {};
                queueMicrotask(() => {
                  if (fail) {
                    tx.onerror?.();
                    return;
                  }
                  values.set(key, value);
                  op.result = key;
                  op.onsuccess?.();
                  queueMicrotask(() => {
                    committed = true;
                    tx.oncomplete?.();
                  });
                });
                return op;
              },
            });
            return tx;
          },
        };
        req.onsuccess?.();
      });
      return req;
    },
  };
  await mediaTransaction(
    "image:key",
    { kind: "image", imageRef: ref },
    { factory },
  );
  assert.equal(committed, true);
  assert.deepEqual(
    await mediaTransaction("image:key", undefined, { factory }),
    { kind: "image", imageRef: ref },
  );
  fail = true;
  await assert.rejects(
    mediaTransaction("image:key", { kind: "image", bad: true }, { factory }),
    /失败/,
  );
  assert.equal(values.get("image:key").kind, "image");
  assert.equal(
    await mediaTransaction("none", undefined, { factory: null }),
    null,
  );
  await assert.rejects(
    mediaTransaction("none", {}, { factory: null }),
    /无法使用/,
  );
  assert.notEqual(
    await mediaKey("image", "one"),
    await mediaKey("image", "two"),
  );
  const record = cachedVoiceRecord({
    blob: new Blob(["ID3"]),
    text: "Hello",
    speed: 0.8,
    fingerprint: "f".repeat(64),
    apiKey: "must-never-store",
    headers: { authorization: "must-never-store" },
  });
  assert.ok(!JSON.stringify(record).includes("must-never-store"));
});

test("recovery reserves repeated sentences for their saved slots and never substitutes article for a scene", async () => {
  const { voiceRecoveryCandidates, voiceMode } = await import(
    "../src/creation/voiceRecovery.js"
  );
  const project = {
    english: "Again. Again.",
    scenes: [
      { id: "new-0", english: "Again." },
      { id: "new-1", english: "Again." },
    ],
  };
  const records = [
    { key: "scene-0", text: "Again.", speed: 0.8, fingerprint: "a".repeat(64) },
    { key: "scene-1", text: "Again.", speed: 0.8, fingerprint: "b".repeat(64) },
  ];
  const result = voiceRecoveryCandidates(project, records, 0.8);
  assert.equal(result.length, 2);
  assert.equal(
    result.find((r) => r.key === "new-0").record.fingerprint,
    "a".repeat(64),
  );
  assert.equal(
    result.find((r) => r.key === "new-1").record.fingerprint,
    "b".repeat(64),
  );
  const single = {
    english: "Again.",
    scenes: [{ id: "single", english: "Again." }],
    voiceRecords: [records[0]],
  };
  assert.equal(
    voiceRecoveryCandidates(single, single.voiceRecords, 0.8)[0].key,
    "single",
  );
  assert.equal(voiceMode(single, {}, 0.8), "scenes");
});
test("recovery selects newest matching take first, protects direct slots, and falls back after reorder", async () => {
  const { voiceRecoveryCandidates } = await import(
    "../src/creation/voiceRecovery.js"
  );
  const project = {
    english: "One. Two. One.",
    scenes: [
      { id: "first", english: "One." },
      { id: "second", english: "One." },
      { id: "third", english: "Two." },
    ],
  };
  const records = [
    { key: "scene-0", text: "One.", speed: 0.8, fingerprint: "old" },
    { key: "scene-1", text: "Two.", speed: 0.8, fingerprint: "two" },
    { key: "scene-2", text: "One.", speed: 0.8, fingerprint: "other" },
    { key: "scene-0", text: "One.", speed: 0.8, fingerprint: "new" },
    {
      key: "article",
      text: project.english,
      speed: 0.8,
      fingerprint: "article-old",
    },
    {
      key: "article",
      text: project.english,
      speed: 0.8,
      fingerprint: "article-new",
    },
  ];
  const result = voiceRecoveryCandidates(project, records, 0.8);
  assert.equal(result.find((r) => r.key === "first").record.fingerprint, "new");
  assert.equal(
    result.find((r) => r.key === "second").record.fingerprint,
    "other",
  );
  assert.equal(result.find((r) => r.key === "third").record.fingerprint, "two");
  assert.equal(
    result.find((r) => r.key === "article").record.fingerprint,
    "article-new",
  );
  assert.ok(
    !result.some(
      (r) =>
        r.record.fingerprint === "old" ||
        r.record.fingerprint === "article-old",
    ),
  );
  assert.deepEqual(voiceRecoveryCandidates(project, records, 1), []);
});

test("cached alignment preserves timing signatures even when provider field order differs", async () => {
  const { cachedVoiceRecord } = await import("../src/creation/mediaStore.js");
  const project = p();
  const asset = {
    blob: new Blob(["ID3"]),
    text: project.english,
    speed: 0.8,
    duration: 10,
    fingerprint: "a".repeat(64),
    alignment: {
      character_end_times_seconds: [1],
      characters: ["x"],
      character_start_times_seconds: [0],
    },
    normalizedAlignment: {
      character_start_times_seconds: [0],
      characters: ["x"],
      character_end_times_seconds: [1],
    },
  };
  const cached = { ...cachedVoiceRecord(asset), duration: asset.duration };
  assert.equal(
    timingSignature(project, { article: asset }, 0.8, "article"),
    timingSignature(project, { article: cached }, 0.8, "article"),
  );
});
test("identical audio bytes for different requested text/speed use independent recovery keys", async () => {
  const { voiceCacheKey } = await import("../src/creation/mediaStore.js");
  const a = { fingerprint: "a".repeat(64), text: "Hello", speed: 0.8 };
  assert.notEqual(
    await voiceCacheKey(a),
    await voiceCacheKey({ ...a, speed: 1 }),
  );
  assert.notEqual(
    await voiceCacheKey(a),
    await voiceCacheKey({ ...a, text: "Hello." }),
  );
  assert.equal(
    await voiceCacheKey(a),
    await voiceCacheKey({ ...a, text: " Hello " }),
  );
});

test("a never-generated repeated sentence is not falsely labelled a lost paid result", async () => {
  const { hasMissingVoiceBackup } = await import(
    "../src/creation/voiceRecovery.js"
  );
  const project = {
    english: "Again. Again.",
    scenes: [
      { id: "first", english: "Again." },
      { id: "second", english: "Again." },
    ],
    voiceRecords: [
      {
        key: "scene-0",
        text: "Again.",
        speed: 0.8,
        fingerprint: "a".repeat(64),
      },
    ],
  };
  assert.equal(
    hasMissingVoiceBackup(
      project,
      { first: { text: "Again.", speed: 0.8 } },
      0.8,
      ["first", "second"],
    ),
    false,
  );
  assert.equal(
    hasMissingVoiceBackup(project, {}, 0.8, ["first", "second"]),
    true,
  );
});
