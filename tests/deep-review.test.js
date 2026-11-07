import test from "node:test";
import assert from "node:assert/strict";
import {
  initialProject,
  splitArticle,
  serializeProject,
  parseProject,
} from "../src/model.js";
import { saveProject, loadProject } from "../src/services/projectStorage.js";
import {
  renderVideo,
  recoverVideoDownload,
  renderExpired,
  jsonRequest,
} from "../src/video/exportClient.js";
import {
  buildVideoTimeline,
  frameAt,
  timingSignature,
} from "../src/video/timeline.js";
const output = {
  videoCodec: "h264",
  audioCodec: "aac",
  width: 1080,
  height: 1920,
  duration: 2,
};
const job = {
  jobId: "a".repeat(32),
  baseUrl: "https://worker.test",
  token: "test-job-token",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};
const timeline = {
  sourceDuration: 2,
  frames: [{}],
  audios: [{ blob: new Blob(["test"]) }],
  manifest: {},
};
function worker({ badHead = 0, badPoll = 0 } = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, o = {}) => {
      calls.push(o.method || "GET");
      if (url === "/api/video-jobs") return Response.json(job);
      if (o.method === "HEAD") {
        if (badHead-- > 0) throw TypeError("offline");
        return new Response(null, {
          headers: { "Content-Type": "video/mp4", "Content-Length": "100" },
        });
      }
      if (o.method === "GET" || !o.method) {
        if (badPoll-- > 0) throw TypeError("offline");
        return Response.json({ state: "complete", result: output });
      }
      return Response.json({ ok: true });
    },
  };
}
test("non-default AI speed survives JSON and local save/reload without changing legacy defaults", () => {
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  p.aiSpeed = 0.9;
  const items = new Map();
  const storage = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => items.set(k, v),
  };
  saveProject(storage, p);
  assert.equal(loadProject(storage).project.aiSpeed, 0.9);
  assert.equal(parseProject(serializeProject(p)).aiSpeed, 0.9);
  delete p.aiSpeed;
  assert.equal(parseProject(serializeProject(p)).aiSpeed, 0.8);
  for (const speed of [0.6, 1.3, NaN, "0.8"]) {
    p.aiSpeed = speed;
    assert.throws(() => serializeProject(p), /配音语速/);
  }
});
test("safe polling/HEAD retry never resubmits renders and preserves completed files after sustained disconnection", async () => {
  const w = worker({ badHead: 1, badPoll: 1 });
  await renderVideo(timeline, async () => new Blob(), {
    fetchImpl: w.fetchImpl,
    readRetryMs: 1,
  });
  assert.equal(w.calls.filter((x) => x === "POST").length, 2);
  assert.equal(w.calls.filter((x) => x === "PUT").length, 2);
  assert.equal(w.calls.filter((x) => x === "DELETE").length, 0);
  const fail = worker({ badHead: 3 });
  let saved;
  await assert.rejects(
    renderVideo(timeline, async () => new Blob(), {
      fetchImpl: fail.fetchImpl,
      readRetryMs: 1,
    }),
    (e) => {
      saved = e.recoverableVideo;
      return /下载/.test(e.message);
    },
  );
  assert.ok(saved);
  assert.equal(fail.calls.filter((x) => x === "DELETE").length, 0);
  const restored = await recoverVideoDownload(saved, {
    fetchImpl: fail.fetchImpl,
  });
  assert.equal(restored.url, saved.url);
  assert.equal(fail.calls.filter((x) => x === "POST").length, 2);
});
test("expired/invalid download results are not advertised as verified files", async () => {
  assert.equal(renderExpired({ expiresAt: 100 }, 100000), true);
  await assert.rejects(
    recoverVideoDownload(
      { ...job, url: "https://worker.test/video", expiresAt: 1 },
      { fetchImpl: () => assert.fail("no fetch for expired tasks") },
    ),
    /过期/,
  );
  await assert.rejects(
    recoverVideoDownload(
      { ...job, url: "https://worker.test/video" },
      { fetchImpl: async () => new Response(null, { status: 410 }) },
    ),
    /过期/,
  );
  await assert.rejects(
    jsonRequest(
      "/api/video-jobs",
      {},
      async () => new Response("<html>login</html>", { status: 401 }),
    ),
    /登录 Vercel/,
  );
  await assert.rejects(
    jsonRequest("/api/video-jobs", {}, async () =>
      Response.json(null, { status: 503 }),
    ),
    /503/,
  );
});
test("unequal cues with leading/trailing gaps keep one contiguous quantized video timeline", () => {
  const p = initialProject();
  p.scenes = Array.from({ length: 10 }, (_, i) => ({
    id: String(i),
    english: `Sentence ${i}.`,
    chinese: `第${i}句。`,
    description: "",
    duration: 5,
    imageRef: { kind: "upload", dataUrl: "test" },
  }));
  p.english = p.scenes.map((s) => s.english).join(" ");
  let time = 0.3;
  const cues = p.scenes.map((_, i) => {
    const start = time;
    time += 0.2 + i * 0.08;
    const end = time;
    time += 0.2;
    return { start, end };
  });
  const assets = {
    article: {
      external: true,
      fingerprint: "test",
      duration: time + 0.6,
      text: p.english,
      speed: 0.8,
      blob: new Blob(["mp3"]),
    },
  };
  p.videoTiming = {
    signature: timingSignature(p, assets, 0.8, "article"),
    cues,
    source: "manual",
  };
  const t = buildVideoTimeline(p, assets, 0.8);
  assert.equal(frameAt(t, 0).plan.scene.english, "");
  assert.equal(frameAt(t, t.duration - 0.1).plan.scene.chinese, "");
  for (let i = 0; i < 10; i++) {
    assert.equal(frameAt(t, (cues[i].start + cues[i].end) / 2).sceneIndex, i);
    if (i) assert.equal(frameAt(t, cues[i].start - 0.1).plan.scene.english, "");
  }
  for (let i = 1; i < t.frames.length; i++)
    assert.equal(t.frames[i].start, t.frames[i - 1].end);
  assert.equal(
    t.frames.reduce((n, f) => n + f.frames, 0),
    Math.ceil(assets.article.duration * 30),
  );
});

test("project image preflight rejects undecodable images and stops superseded imports", async () => {
  const { verifyProjectImages, uploadImage } = await import(
    "../src/services/images.js"
  );
  const p = initialProject();
  p.scenes = [{ imageRef: { dataUrl: "data:image/png;base64,YWJj" } }];
  await assert.rejects(
    verifyProjectImages(p, {
      decode: async () => {
        throw Error("corrupt bitmap");
      },
    }),
    /原项目未替换/,
  );
  let calls = 0;
  assert.equal(
    await verifyProjectImages(p, {
      isCurrent: () => false,
      decode: async () => {
        calls++;
      },
    }),
    false,
  );
  assert.equal(calls, 0);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1UAAAAASUVORK5CYII=",
    "base64",
  );
  await assert.rejects(
    uploadImage(new Blob([png.subarray(0, 24)]), {
      decode: async () => {
        throw Error("cannot decode");
      },
    }),
    /cannot decode/,
  );
});

test("malformed successful status responses fail in Chinese and clean up without claiming completion", async () => {
  const base = worker();
  const fetchImpl = async (url, o = {}) =>
    o.method === "GET" || !o.method
      ? Response.json(null)
      : base.fetchImpl(url, o);
  await assert.rejects(
    renderVideo(timeline, async () => new Blob(), { fetchImpl }),
    /无效任务状态/,
  );
  assert.ok(base.calls.includes("DELETE"));
});
