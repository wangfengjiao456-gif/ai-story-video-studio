// Offline fixture only: synthetic illustrations + local Flite speech. Never calls an AI API.
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { initialProject, uid, serializeProject } from "../src/model.js";
import { buildVideoTimeline } from "../src/video/timeline.js";
import { paintFrame, FONT_STACK } from "../src/presentation/frameRenderer.js";
const dir = resolve("work/mp4-regression");
mkdirSync(dir, { recursive: true });
for (const path of [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
])
  if (existsSync(path)) GlobalFonts.registerFromPath(path, "PingFang SC");
const sentences = [
  ["You do not have to change everything today.", "你不必在今天改变一切。"],
  [
    "One small step can make a real difference.",
    "小小的一步也能带来真正的改变。",
  ],
  ["Read one page and learn something new.", "读一页书，学一点新知识。"],
  [
    "Practice one sentence slowly and say it clearly.",
    "慢慢练习一句话，把它说清楚。",
  ],
  ["When you make a mistake, try once more.", "犯错的时候，再试一次。"],
  [
    "Be patient with yourself on difficult days.",
    "在困难的日子里，对自己耐心一点。",
  ],
  ["Notice the progress you have already made.", "看看自己已经取得的进步。"],
  ["Your small efforts will grow over time.", "小小的努力会随着时间积累。"],
  [
    "Tomorrow you can take another gentle step.",
    "明天，你还可以再迈出温柔的一步。",
  ],
  ["A little progress every day is enough.", "每天进步一点，就已经足够了。"],
];
function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 5e6 });
  if (result.status !== 0)
    throw Error(`${cmd} failed: ${result.stderr || result.error}`);
  return result.stdout;
}
const p = initialProject();
p.title = "回归样本：每天进步一点就够了（非用户原项目）";
p.english = sentences.map((x) => x[0]).join(" ");
p.chinese = sentences.map((x) => x[1]).join("");
p.scenes = sentences.map(([english, chinese], i) => {
  const art = createCanvas(800, 1000),
    ctx = art.getContext("2d");
  ctx.fillStyle = ["#dce4c6", "#d6e5d4", "#e5dfc8"][i % 3];
  ctx.fillRect(0, 0, 800, 1000);
  ctx.fillStyle = "#f7edbf";
  ctx.beginPath();
  ctx.arc(580, 180, 110, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#81a283";
  ctx.beginPath();
  ctx.ellipse(400, 1000, 600, 420, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2f674f";
  ctx.fillRect(390, 800 - (i + 1) * 42, 20, 300 + (i + 1) * 42);
  for (let n = 0; n <= i; n++) {
    ctx.beginPath();
    ctx.ellipse(
      n % 2 ? 350 : 450,
      790 - n * 42,
      60,
      22,
      n % 2 ? 0.5 : -0.5,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  return {
    id: uid(),
    english,
    chinese,
    description: "程序绘制的离线回归插画，不是用户图片或 AI 生成结果",
    duration: 5,
    imageRef: { kind: "upload", dataUrl: art.toDataURL("image/png") },
    imageFit: "contain",
    imageScale: 1,
    imagePosition: { x: 50, y: 50 },
  };
});
const assets = {};
for (let i = 0; i < p.scenes.length; i++) {
  const text = join(dir, `text-${i}.txt`);
  writeFileSync(text, p.scenes[i].english);
  const audio = join(dir, `audio-${i}.mp3`);
  run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `flite=textfile=${text}:voice=slt`,
    "-af",
    "atempo=0.8",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    audio,
  ]);
  const info = JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-f",
      "mp3",
      "-show_format",
      "-of",
      "json",
      audio,
    ]),
  );
  assets[p.scenes[i].id] = {
    text: p.scenes[i].english,
    speed: 0.8,
    blob: new Blob([readFileSync(audio)], { type: "audio/mpeg" }),
    duration: Number(info.format.duration),
  };
}
const canvas = createCanvas(1080, 1920),
  ctx = canvas.getContext("2d");
const measure = (ch, size) => {
  ctx.font = `600 ${size}px ${FONT_STACK}`;
  return ctx.measureText(ch).width;
};
const t = buildVideoTimeline(p, assets, 0.8, "scenes", measure);
for (let i = 0; i < t.frames.length; i++) {
  const f = t.frames[i];
  const image = await loadImage(f.plan.scene.imageRef.dataUrl);
  paintFrame(ctx, f.plan, f.page, image);
  writeFileSync(join(dir, `frame-${i}.png`), canvas.toBuffer("image/png"));
}
writeFileSync(join(dir, "manifest.json"), JSON.stringify(t.manifest));
writeFileSync(join(dir, "sample-project.json"), serializeProject(p));
console.log(
  `Rendering ${p.scenes.length} synthetic scenes / ${t.duration.toFixed(2)}s; local Flite audio, no paid API.`,
);
console.log(run("python3", ["renderer/render.py", dir]));
const output = process.argv[2];
if (output) {
  mkdirSync(output, { recursive: true });
  copyFileSync(
    join(dir, "video.mp4"),
    join(output, "daily-progress-regression.mp4"),
  );
  copyFileSync(
    join(dir, "sample-project.json"),
    join(output, "daily-progress-regression.json"),
  );
  writeFileSync(
    join(output, "README.txt"),
    "此视频为 10 分镜离线回归样本，不是用户浏览器中的原项目。插画由程序绘制；英文语音由本地 Flite 合成，不是 ElevenLabs。字幕帧使用网站同一 framePlan/paintFrame，FFmpeg 实际输出 H.264 + AAC / 1080×1920 / 30fps。未调用任何付费 AI API。\n",
  );
}
