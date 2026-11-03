// Offline contract tests only. No requests are made to ElevenLabs.
import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../api/elevenlabs.js";
import { VOICE_ID, MODEL_ID } from "../src/voiceConfig.js";
const audioBase64 = Buffer.from("ID3-mock-audio-not-real-speech").toString(
  "base64",
);
const request = (patch) => ({
  method: "POST",
  headers: {
    origin: "https://studio.test",
    host: "studio.test",
    "content-type": "application/json",
  },
  body: { text: "Hello world.", speed: 0.8 },
  ...patch,
});
const response = () => ({
  headers: {},
  statusCode: 0,
  body: null,
  setHeader(k, v) {
    this.headers[k] = v;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
test("固定声音、v3、英文、0.8 通过服务端请求；密钥仅出现在上游请求头", async () => {
  let upstream;
  const handler = createHandler({
    getKey: () => "test-server-secret",
    fetchImpl: async (url, options) => {
      upstream = { url, options };
      return Response.json({ audio_base64: audioBase64, alignment: null });
    },
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.match(
    upstream.url,
    new RegExp(`/text-to-speech/${VOICE_ID}/with-timestamps`),
  );
  assert.deepEqual(JSON.parse(upstream.options.body), {
    text: "Hello world.",
    model_id: MODEL_ID,
    language_code: "en",
    voice_settings: { speed: 0.8 },
  });
  assert.equal(upstream.options.headers["xi-api-key"], "test-server-secret");
  assert.ok(!JSON.stringify(res).includes("test-server-secret"));
  assert.equal(res.headers["Cache-Control"], "no-store");
});
test("未配置 key 时不调用上游，返回中文可恢复错误", async () => {
  const res = response();
  await createHandler({
    getKey: () => "",
    fetchImpl: () => assert.fail("不得发起请求"),
  })(request(), res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error.message, /尚未配置/);
});
for (const [status, code, expected, message] of [
  [401, "invalid_api_key", 401, /无效/],
  [429, "quota_exceeded", 402, /配额不足/],
  [402, "", 402, /配额不足/],
  [403, "", 403, /权限/],
  [429, "too_many_concurrent_requests", 429, /频繁/],
  [404, "", 404, /声音或模型/],
  [422, "", 502, /生成失败/],
  [500, "", 502, /生成失败/],
]) {
  test(`上游 ${status}/${code} 映射安全中文错误且不回显原始响应`, async () => {
    const res = response();
    await createHandler({
      getKey: () => "test-private",
      fetchImpl: async () =>
        Response.json(
          { detail: { status: code, message: "test-private internal stack" } },
          { status },
        ),
    })(request(), res);
    assert.equal(res.statusCode, expected);
    assert.match(res.body.error.message, message);
    assert.ok(!JSON.stringify(res.body).includes("test-private"));
  });
}
test("非法文本、语速、方法、来源、内容类型在消耗额度前被拒绝", async () => {
  const handler = createHandler({
    getKey: () => "test",
    fetchImpl: () => assert.fail("不得消耗额度"),
  });
  for (const [req, status] of [
    [request({ method: "GET" }), 405],
    [
      request({
        headers: {
          origin: "https://evil.test",
          host: "studio.test",
          "content-type": "application/json",
        },
      }),
      403,
    ],
    [
      request({
        headers: { host: "studio.test", "content-type": "application/json" },
      }),
      403,
    ],
    [
      request({
        headers: {
          origin: "https://studio.test",
          host: "studio.test",
          "content-type": "text/plain",
        },
      }),
      415,
    ],
    ...["", "a".repeat(5001), 42].map((text) => [
      request({ body: { text, speed: 0.8 } }),
      400,
    ]),
    [request({ body: { text: "Hello", speed: 0.6 } }), 400],
    [request({ body: "{" }), 400],
  ]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, status);
  }
});
test("可调整语速，禁止通过客户端更换模型、声音、URL 或密钥", async () => {
  let body, url, header;
  const handler = createHandler({
    getKey: () => "server-only",
    fetchImpl: async (u, o) => {
      url = u;
      body = JSON.parse(o.body);
      header = o.headers;
      return Response.json({ audio_base64: audioBase64 });
    },
  });
  const res = response();
  await handler(
    request({
      body: {
        text: "Hi.",
        speed: 1.1,
        model_id: "other",
        voice_id: "other",
        apiKey: "client",
        url: "https://evil.test",
      },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(body.voice_settings.speed, 1.1);
  assert.equal(body.model_id, MODEL_ID);
  assert.ok(url.includes(VOICE_ID));
  assert.equal(header["xi-api-key"], "server-only");
});
test("网络断开、超时返回中文错误且不会重试", async () => {
  let calls = 0;
  const res = response();
  await createHandler({
    getKey: () => "test",
    fetchImpl: async () => {
      calls++;
      throw Error("secret stack");
    },
  })(request(), res);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error.message, /网络请求失败/);
  assert.ok(!JSON.stringify(res).includes("secret stack"));
  const timed = response();
  await createHandler({
    getKey: () => "test",
    timeoutMs: 5,
    fetchImpl: async (_, options) =>
      new Promise((_, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(Error("aborted")),
        ),
      ),
  })(request(), timed);
  assert.match(timed.body.error.message, /超时/);
});
test("空音频、损坏 JSON、超大响应不伪造成功", async () => {
  for (const make of [
    () => Response.json({ alignment: null }),
    () => new Response("broken"),
    () => Response.json({ audio_base64: "a".repeat(4 * 1024 * 1024 + 1) }),
  ]) {
    const res = response();
    await createHandler({
      getKey: () => "test",
      fetchImpl: async () => make(),
    })(request(), res);
    assert.equal(res.statusCode, 502);
    assert.ok(res.body.error);
  }
});
