import test from "node:test";
import assert from "node:assert/strict";
import {
  audioFingerprint,
  assertPreparedAudio,
} from "../src/video/audioIdentity.js";
import { sceneCues, validateCues } from "../src/video/alignment.js";
import { renderVideo } from "../src/video/exportClient.js";
import { timingSignature } from "../src/video/timeline.js";
import {
  initialProject,
  splitArticle,
  serializeProject,
  parseProject,
  PROJECT_FILE_BYTES_LIMIT,
} from "../src/model.js";
import { saveProject, PROJECT_KEY } from "../src/services/projectStorage.js";
const mp3 = new Blob(["offline MP3 fixture"]);
const timeline = {
  frames: [{}],
  audios: [{ blob: mp3 }],
  manifest: {},
  sourceDuration: 2,
};
function mockWorker({
  status = "complete",
  result,
  head = true,
  uploadError = false,
} = {}) {
  const calls = [];
  let attempt = 0;
  const fetchImpl = async (url, o = {}) => {
    calls.push({ url, method: o.method || "GET" });
    if (url === "/api/video-jobs")
      return Response.json({
        jobId: (++attempt).toString(16).padStart(32, "0"),
        token: "job-only-token",
        baseUrl: "https://worker.test",
      });
    if (o.method === "DELETE") return Response.json({ ok: true });
    if (o.method === "HEAD")
      return new Response(head ? "mp4" : null, {
        status: head ? 200 : 410,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": head ? "123" : "0",
        },
      });
    if (o.method === "PUT") {
      if (uploadError) throw Error("offline");
      return Response.json({ ok: true });
    }
    if (o.method === "POST") return Response.json({ state: "queued" });
    return Response.json({
      state: status,
      progress: 100,
      error: "测试渲染失败",
      result: result ?? {
        videoCodec: "h264",
        audioCodec: "aac",
        width: 1080,
        height: 1920,
        duration: 2,
      },
    });
  };
  return { fetchImpl, calls };
}
test("content hashes distinguish equal-length MP3s; speed/regeneration invalidates prepared playback", async () => {
  const a = await audioFingerprint(new Blob(["aaaa"])),
    b = await audioFingerprint(new Blob(["bbbb"]));
  assert.equal(a.length, 64);
  assert.notEqual(a, b);
  const asset = { url: "blob:old" };
  const prepared = {
    speed: 0.8,
    source: "article",
    assets: { article: asset },
  };
  assert.doesNotThrow(() =>
    assertPreparedAudio(prepared, { article: asset }, 0.8),
  );
  assert.throws(
    () => assertPreparedAudio(prepared, { article: asset }, 0.9),
    /语速/,
  );
  assert.throws(
    () => assertPreparedAudio(prepared, { article: { url: "blob:new" } }, 0.8),
    /重新生成/,
  );
  assert.doesNotThrow(() => assertPreparedAudio(prepared, {}, 0.8, true));
});
test("external-MP3 signatures remain compatible with the previous persisted format", () => {
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  const a = {
    text: p.english,
    duration: 3,
    speed: 0.8,
    blob: mp3,
    fingerprint: "a".repeat(64),
    external: true,
  };
  const raw = JSON.stringify([
    "article",
    p.english,
    p.scenes.map((s) => s.english),
    0.8,
    [[a.text, a.duration, a.blob.size, a.alignment, a.fingerprint]],
  ]);
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  assert.equal(
    timingSignature(p, { article: a }, 0.8, "article"),
    `article-${(h >>> 0).toString(16)}-${a.fingerprint}`,
  );
});
test("hyphenated words align as one acoustic word; empty/overlapping/sparse cues cannot be saved", () => {
  assert.deepEqual(
    sceneCues(
      [{ english: "Well-being matters." }],
      [
        { text: "Well-being", start: 0.2, end: 0.8 },
        { text: "matters.", start: 0.9, end: 1.4 },
      ],
      2,
    ),
    [{ start: 0.2, end: 1.4 }],
  );
  assert.equal(validateCues(new Array(2), 2, 5), false);
  assert.throws(() => sceneCues([{ english: "Hello." }], [null], 2), /无效/);
  assert.throws(
    () =>
      sceneCues(
        [{ english: "Hello." }],
        [{ text: "Hello", start: 0, end: 3 }],
        2,
      ),
    /时间戳/,
  );
});
test("completed metadata alone is insufficient: validate codecs/duration and actual downloadable file", async () => {
  let w = mockWorker();
  const progress = [];
  const output = await renderVideo(timeline, async () => new Blob(["png"]), {
    fetchImpl: w.fetchImpl,
    onProgress: (p) => progress.push(p),
    pollMs: 1,
  });
  assert.ok(output.download.endsWith("&download=1"));
  assert.ok(w.calls.some((c) => c.method === "HEAD"));
  assert.ok(!w.calls.some((c) => c.method === "DELETE"));
  assert.ok(progress.every((p) => p.percent < 100));
  for (const options of [
    { head: false },
    {
      result: {
        videoCodec: "webm",
        audioCodec: "aac",
        width: 1080,
        height: 1920,
        duration: 2,
      },
    },
    {
      result: {
        videoCodec: "h264",
        audioCodec: "aac",
        width: 1080,
        height: 1920,
        duration: 1,
      },
    },
  ]) {
    w = mockWorker(options);
    await assert.rejects(
      renderVideo(timeline, async () => new Blob(), {
        fetchImpl: w.fetchImpl,
        pollMs: 1,
      }),
      /下载|验证|过期/,
    );
    assert.equal(
      w.calls.some((c) => c.method === "DELETE"),
      options.head !== false,
    );
  }
});
test("upload/network errors cancel old tasks; explicit retries create a new job without hidden retries", async () => {
  const w = mockWorker({ uploadError: true });
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      renderVideo(timeline, async () => new Blob(), { fetchImpl: w.fetchImpl }),
      /网络/,
    );
  assert.equal(w.calls.filter((c) => c.url === "/api/video-jobs").length, 2);
  assert.equal(w.calls.filter((c) => c.method === "PUT").length, 2);
  assert.equal(w.calls.filter((c) => c.method === "DELETE").length, 2);
});
test("render deadlines, cancelled image decoding, and invalid states cannot hang or report success", async () => {
  for (const decode of [async () => new Blob(), () => new Promise(() => {})]) {
    const w = mockWorker({ status: "rendering" });
    await assert.rejects(
      renderVideo(timeline, decode, {
        fetchImpl: w.fetchImpl,
        timeoutMs: 25,
        pollMs: 1,
      }),
      /超时/,
    );
    assert.ok(w.calls.some((c) => c.method === "DELETE"));
  }
  const w = mockWorker({ status: "unknown" });
  await assert.rejects(
    renderVideo(timeline, async () => new Blob(), { fetchImpl: w.fetchImpl }),
    /状态无效/,
  );
  const c = new AbortController();
  c.abort();
  const noRequest = mockWorker();
  await assert.rejects(
    renderVideo(timeline, async () => new Blob(), {
      fetchImpl: noRequest.fetchImpl,
      signal: c.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(noRequest.calls.length, 0);
});
test("large file backups restore all content while failed local saves preserve the previous project", () => {
  const p = initialProject();
  p.scenes = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    english: "中".repeat(100000),
    chinese: "译文",
    description: "插画描述",
    duration: 5,
  }));
  const options = { maxBytes: PROJECT_FILE_BYTES_LIMIT };
  const raw = serializeProject(p, options);
  assert.ok(Buffer.byteLength(raw) > 5 * 1024 * 1024);
  assert.throws(() => serializeProject(p), /超过 5 MB/);
  let stored = "previous";
  const storage = {
    getItem: (k) => (k === PROJECT_KEY ? stored : null),
    setItem: () => assert.fail("must not overwrite previous save"),
  };
  assert.throws(() => saveProject(storage, p), /超过 5 MB/);
  assert.equal(stored, "previous");
  const restored = parseProject(raw, options);
  assert.equal(restored.scenes.length, 20);
  assert.equal(restored.scenes[19].english, p.scenes[19].english);
  assert.throws(() => parseProject(raw), /超过 5 MB/);
});

test("estimated speech timing is never exported as an accurately synchronized video", async () => {
  const worker = mockWorker();
  await assert.rejects(
    renderVideo(
      { ...timeline, precision: "estimated" },
      async () => new Blob(),
      { fetchImpl: worker.fetchImpl },
    ),
    /估算时轴不能导出/,
  );
  assert.equal(worker.calls.length, 0);
});
