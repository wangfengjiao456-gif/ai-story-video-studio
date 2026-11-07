// Real Preview + worker smoke test. Uses ONLY synthetic local fixtures; no paid AI calls.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { renderVideo, jsonRequest } from "../src/video/exportClient.js";
const studio = new URL(process.env.STUDIO_URL || "http://localhost:5173");
if (
  studio.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(studio.hostname)
)
  throw Error("线上验证必须使用 HTTPS Preview 地址。");
const origin = studio.origin;
const nativeFetch = globalThis.fetch;
let checkedCors = false;
const fetchImpl = async (url, options = {}) => {
  const target = new URL(url, studio);
  const headers = { ...options.headers, Origin: origin };
  if (target.origin === origin && process.env.VERCEL_AUTOMATION_BYPASS_SECRET)
    headers["x-vercel-protection-bypass"] =
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (target.origin !== origin && options.method === "PUT" && !checkedCors) {
    const preflight = await nativeFetch(target, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (
      !preflight.ok ||
      preflight.headers.get("access-control-allow-origin") !== origin
    )
      throw Error("worker CORS 预检失败，请检查 ALLOWED_ORIGINS 精确来源。");
    checkedCors = true;
  }
  const response = await nativeFetch(target, {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(20000),
  });
  if (
    target.origin !== origin &&
    response.ok &&
    response.headers.get("access-control-allow-origin") !== origin
  )
    throw Error("worker 响应未允许当前 Preview 来源。");
  return response;
};
try {
  const status = await jsonRequest("/api/service-status", {}, fetchImpl);
  if (!["preview", "development"].includes(status.environment))
    throw Error(
      "只允许验证 Preview / 本地环境，已停止，未创建 Production 任务。",
    );
  await jsonRequest("/api/renderer-status", { method: "POST" }, fetchImpl);
  const dir = "work/mp4-regression",
    manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
  const timeline = {
    manifest,
    sourceDuration: manifest.audios.reduce((n, a) => n + a.duration, 0),
    frames: manifest.frames.map((_, index) => ({ index })),
    audios: manifest.audios.map((a, i) => ({
      ...a,
      blob: new Blob([readFileSync(`${dir}/audio-${i}.mp3`)], {
        type: "audio/mpeg",
      }),
    })),
  };
  const output = await renderVideo(
    timeline,
    async (f) =>
      new Blob([readFileSync(`${dir}/frame-${f.index}.png`)], {
        type: "image/png",
      }),
    { fetchImpl, onProgress: (p) => console.log(`${p.percent}% ${p.message}`) },
  );
  const response = await fetchImpl(output.download);
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("video/mp4") ||
    !response.headers.get("content-disposition")?.includes("attachment")
  )
    throw Error("真实 MP4 下载响应不完整。");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.subarray(0, 128).includes(Buffer.from("ftyp")))
    throw Error("下载内容不是标准 MP4。");
  mkdirSync("work/deployment-verification", { recursive: true });
  const path = "work/deployment-verification/preview-render.mp4";
  writeFileSync(path, bytes);
  const range = await fetchImpl(output.url, {
    headers: { Range: "bytes=-100" },
  });
  if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 100)
    throw Error("Safari 字节范围下载验证失败。");
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
    { encoding: "utf8" },
  );
  if (probe.error)
    throw Error(
      `视频已下载至 ${path}；当前机器没有 ffprobe，无法完成最终解码验收，请安装 FFmpeg 后重跑。`,
    );
  if (probe.status !== 0) throw Error("下载视频无法由 ffprobe 读取。");
  const info = JSON.parse(probe.stdout),
    video = info.streams.find((s) => s.codec_type === "video"),
    audio = info.streams.find((s) => s.codec_type === "audio");
  if (
    video?.codec_name !== "h264" ||
    video.width !== 1080 ||
    video.height !== 1920 ||
    video.avg_frame_rate !== "30/1" ||
    audio?.codec_name !== "aac" ||
    Math.abs(Number(info.format.duration) - timeline.sourceDuration) >
      1 / 30 + 0.01
  )
    throw Error("下载文件的编码、尺寸、帧率或完整时长验证失败。");
  console.log(
    JSON.stringify({
      result: "PASS",
      environment: status.environment,
      branch: status.branch,
      scenes: 10,
      source: "synthetic Flite fixture; no paid APIs",
      duration: info.format.duration,
      bytes: bytes.length,
      file: path,
    }),
  );
} catch (error) {
  console.error(`验证失败：${error.message}`);
  process.exitCode = 1;
}
