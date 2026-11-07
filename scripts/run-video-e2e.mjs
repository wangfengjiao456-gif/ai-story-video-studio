// Starts isolated local services and offline fixtures; never uses real AI keys.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createVideoJobHandler } from "../api/video-jobs.js";
import { createRendererStatus } from "../api/renderer-status.js";
import serviceStatus from "../api/service-status.js";
import { once } from "node:events";
import { mkdirSync, openSync, closeSync } from "node:fs";
let gateway;
const children = [];
mkdirSync("work/e2e", { recursive: true });
const studio = "http://127.0.0.1:6173",
  renderer = "http://127.0.0.1:8199",
  gatewayURL = "http://127.0.0.1:6174";
const env = {
  ...process.env,
  ELEVENLABS_API_KEY: "",
  OPENAI_API_KEY: "",
  RENDERER_API_KEY: "offline-browser-key-0123456789",
  ALLOWED_ORIGINS: `${studio},${gatewayURL}`,
  PORT: "8199",
  RENDERER_DATA_DIR: "work/e2e/jobs",
  STUDIO_URL: studio,
  RENDERER_BASE: renderer,
};
function run(command, args, extraEnv = {}) {
  const r = spawnSync(command, args, {
    env: { ...env, ...extraEnv },
    stdio: "inherit",
  });
  if (r.status !== 0) throw Error(`测试命令失败：${command}（${r.status}）`);
}
function start(command, args, name) {
  const fd = openSync(`work/e2e/${name}.log`, "w");
  const p = spawn(command, args, { env, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  p.on("error", () => {});
  children.push({ p });
  return p;
}
async function ready(url, p) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (p.exitCode !== null)
      throw Error(`本地测试服务退出，请检查 work/e2e 日志：${url}`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(`本地测试服务启动超时：${url}`);
}
try {
  run(process.execPath, ["scripts/render-regression.mjs"]);
  run("ffmpeg", [
    "-v",
    "error",
    "-i",
    "work/mp4-regression/video.mp4",
    "-vn",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    "-y",
    "work/mp4-regression/uploaded-test.mp3",
  ]);
  const w = start("python3", ["renderer/server.py"], "renderer");
  const v = start(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "6173",
      "--strictPort",
    ],
    "vite",
  );
  await Promise.all([ready(renderer + "/health", w), ready(studio, v)]);
  const browser = start(
    process.execPath,
    ["scripts/browser-video-regression.mjs"],
    "browser",
  );
  const [code] = await once(browser, "exit");
  if (code !== 0) throw Error("浏览器回归失败：请检查 work/e2e/browser.log");
  const getConfig = () => ({ url: renderer, key: env.RENDERER_API_KEY });
  const handlers = {
    "/api/service-status": serviceStatus,
    "/api/renderer-status": createRendererStatus({ getConfig }),
    "/api/video-jobs": createVideoJobHandler({ getConfig }),
  };
  gateway = createServer(async (req, res) => {
    res.status = (n) => {
      res.statusCode = n;
      return res;
    };
    res.json = (value) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
      return res;
    };
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 100000) throw Error("body too large");
      }
      req.body = body ? JSON.parse(body) : undefined;
      if (!handlers[req.url])
        return res
          .status(404)
          .json({ error: { message: "No local test route" } });
      await handlers[req.url](req, res);
    } catch {
      if (!res.headersSent)
        res.status(400).json({ error: { message: "Local test API failed" } });
    }
  });
  await new Promise((r) => gateway.listen(6174, "127.0.0.1", r));
  // spawnSync would block the gateway event loop: run the real verifier asynchronously.
  const verifierEnv = { ...env, STUDIO_URL: gatewayURL };
  const verify = spawn(process.execPath, ["scripts/verify-deployment.mjs"], {
    env: verifierEnv,
    stdio: "inherit",
  });
  children.push({ p: verify });
  const [verified] = await once(verify, "exit");
  if (verified !== 0) throw Error("真实部署验证脚本本地集成失败。");
  console.log(
    "Browser E2E PASS: work/mp4-regression/browser-export.mp4; work/e2e/browser.log",
  );
} finally {
  if (gateway) await new Promise((r) => gateway.close(r));
  for (const { p } of children.reverse())
    if (p.exitCode === null) p.kill("SIGTERM");
  await Promise.all(
    children.map(async ({ p }) => {
      if (p.exitCode === null)
        await Promise.race([
          once(p, "exit"),
          new Promise((r) => setTimeout(r, 3000)),
        ]);
      if (p.exitCode === null) p.kill("SIGKILL");
    }),
  );
}
