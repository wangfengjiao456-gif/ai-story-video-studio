import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSpeech,
  isFresh,
  articleTimeline,
  indexAtTime,
} from "../src/services/aiVoice.js";
const text = "Hello. Goodbye.";
const scenes = [
  { english: "Hello.", chinese: "你好。" },
  { english: "Goodbye.", chinese: "再见。" },
];
const alignment = {
  characters: [...text],
  character_start_times_seconds: [...text].map((_, i) => i * 0.5),
  character_end_times_seconds: [...text].map((_, i) => (i + 1) * 0.5),
};
test("模拟响应生成 MP3 Blob，并仅请求同源服务端接口", async () => {
  let url, options;
  const asset = await generateSpeech(text, 0.8, {
    fetchImpl: async (u, o) => {
      url = u;
      options = o;
      return Response.json({
        audio_base64: Buffer.from("ID3 mock").toString("base64"),
        alignment,
      });
    },
  });
  assert.equal(url, "/api/elevenlabs");
  assert.deepEqual(JSON.parse(options.body), { text, speed: 0.8 });
  assert.equal(asset.blob.type, "audio/mpeg");
  assert.equal(await asset.blob.text(), "ID3 mock");
  assert.deepEqual(asset.alignment, alignment);
  assert.ok(!JSON.stringify(options).includes("xi-api-key"));
});
test("客户端错误：缺少配置、网络、非 JSON 路由和取消", async () => {
  await assert.rejects(
    generateSpeech(text, 0.8, {
      fetchImpl: async () =>
        Response.json(
          { error: { message: "API Key 尚未配置" } },
          { status: 503 },
        ),
    }),
    /尚未配置/,
  );
  await assert.rejects(
    generateSpeech(text, 0.8, {
      fetchImpl: async () => {
        throw Error("offline");
      },
    }),
    /网络请求中断.*计费/,
  );
  await assert.rejects(
    generateSpeech(text, 0.8, {
      fetchImpl: async () => new Response("<html>Vite page</html>"),
    }),
    /Vercel/,
  );
  await assert.rejects(
    generateSpeech(text, 0.8, {
      fetchImpl: async () => {
        throw new DOMException("cancelled", "AbortError");
      },
    }),
    { name: "AbortError" },
  );
});
test("修改英文或生成语速会过期；中文修改不要求重新配音", () => {
  const asset = { text, speed: 0.8 };
  assert.equal(isFresh(asset, text, 0.8), true);
  assert.equal(isFresh(asset, ` ${text} `, 0.8), true);
  assert.equal(isFresh(asset, "Changed.", 0.8), false);
  assert.equal(isFresh(asset, text, 0.9), false);
});
test("真实对齐数据映射分镜，按音频时间切换并保留尾部静音", () => {
  const result = articleTimeline(text, scenes, { duration: 10, alignment });
  assert.equal(result.mode, "aligned");
  assert.equal(result.ranges[0].start, 0);
  assert.equal(result.ranges[1].start, 3.5);
  assert.equal(result.ranges.at(-1).end, 10);
  assert.equal(indexAtTime(result.ranges, 3.49), 0);
  assert.equal(indexAtTime(result.ranges, 3.5), 1);
  assert.equal(indexAtTime(result.ranges, 10), 1);
});
test("无对齐或英文不对应时明确估算，依赖真实音频时长", () => {
  const estimated = articleTimeline(text, scenes, { duration: 56 });
  assert.equal(estimated.mode, "estimated");
  assert.equal(estimated.ranges.at(-1).end, 56);
  assert.equal(estimated.ranges[0].end, 28);
  assert.equal(
    articleTimeline(text, [{ english: "Different." }], {
      duration: 56,
      alignment,
    }).mode,
    "estimated",
  );
  assert.equal(
    articleTimeline(text, scenes, { alignment }).mode,
    "unavailable",
  );
  assert.equal(
    articleTimeline(text, [], { duration: 56, alignment }).ranges.length,
    0,
  );
});
test("错位、乱序、超时长、NaN 和缺失数组的时间戳不能冒充 API 对齐", () => {
  for (const invalid of [
    { ...alignment, characters: ["x"] },
    { ...alignment, character_start_times_seconds: [100] },
    {
      ...alignment,
      character_end_times_seconds: alignment.characters.map(() => NaN),
    },
    {
      ...alignment,
      character_end_times_seconds: alignment.characters.map(() => 1000),
    },
    {
      ...alignment,
      character_start_times_seconds: [
        ...alignment.character_start_times_seconds,
      ].reverse(),
    },
  ])
    assert.equal(
      articleTimeline(text, scenes, { duration: 10, alignment: invalid }).mode,
      "estimated",
    );
});
test("normalized alignment 仅在能验证原文和时间时使用", () => {
  assert.equal(
    articleTimeline(text, scenes, {
      duration: 10,
      normalizedAlignment: alignment,
    }).mode,
    "aligned",
  );
  assert.equal(
    articleTimeline(text, scenes, {
      duration: 10,
      normalizedAlignment: {
        ...alignment,
        characters: [..."Normalized different"],
      },
    }).mode,
    "estimated",
  );
});

test("损坏的音频或时间戳不能导致工作台崩溃或误报同步", async () => {
  await assert.rejects(
    generateSpeech("Hi.", 0.8, {
      fetchImpl: async () => Response.json({ audio_base64: "###invalid###" }),
    }),
    /音频数据无效/,
  );
  await assert.rejects(
    generateSpeech("Hi.", 0.8, { fetchImpl: async () => Response.json(null) }),
    /未收到音频/,
  );
  assert.equal(
    articleTimeline("123", [{ english: "123" }], {
      duration: 3,
      alignment: {
        characters: [123],
        character_start_times_seconds: [0],
        character_end_times_seconds: [2],
      },
    }).mode,
    "estimated",
  );
});
