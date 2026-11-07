// Decode the actual downloaded H.264 and compare it with browser-painted scene/subtitle evidence.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const dir = "work/mp4-regression",
  evidence = JSON.parse(readFileSync(`${dir}/frame-evidence.json`, "utf8"));
const byIndex = new Map(evidence.map((s) => [s.index, s]));
const probes = [{ frame: 0, index: 0, label: "first-start" }];
for (const index of [0, 4, 9]) {
  const c = byIndex.get(index);
  assert.ok(c.english && c.chinese, "bilingual evidence must be non-empty");
  probes.push({
    frame: Math.floor(((c.start + c.end) / 2) * 30),
    index,
    label: `scene-${index + 1}-middle`,
  });
  if (index)
    probes.push(
      {
        frame: Math.round(c.start * 30) - 1,
        index: index - 1,
        label: `before-scene-${index + 1}`,
      },
      {
        frame: Math.round(c.start * 30),
        index,
        label: `at-scene-${index + 1}`,
      },
    );
}
probes.sort((a, b) => a.frame - b.frame);
const unique = [...new Set(probes.map((p) => p.frame))],
  width = 1080,
  height = 1920,
  bytes = width * height * 3;
const select = unique.map((n) => `eq(n\\,${n})`).join("+");
const decoded = spawnSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-i",
    `${dir}/browser-export.mp4`,
    "-vf",
    `select=${select}`,
    "-vsync",
    "0",
    "-frames:v",
    String(unique.length),
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ],
  { maxBuffer: bytes * (unique.length + 1), timeout: 120000 },
);
assert.equal(decoded.status, 0, decoded.stderr?.toString());
assert.equal(decoded.stdout.length, bytes * unique.length);
const cache = new Map();
const results = [];
for (const probe of probes) {
  const scene = byIndex.get(probe.index);
  if (!cache.has(probe.index)) {
    const image = await loadImage(scene.file),
      canvas = createCanvas(width, height),
      ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    cache.set(probe.index, ctx.getImageData(0, 0, width, height).data);
  }
  const ref = cache.get(probe.index),
    actual = decoded.stdout.subarray(
      unique.indexOf(probe.frame) * bytes,
      (unique.indexOf(probe.frame) + 1) * bytes,
    );
  let all = 0;
  for (let p = 0; p < width * height; p++)
    for (let c = 0; c < 3; c++)
      all += Math.abs(actual[p * 3 + c] - ref[p * 4 + c]);
  const mae = all / (width * height * 3);
  assert.ok(mae < 12, `${probe.label}: scene image mismatch (${mae})`);
  const languages = {};
  for (const [language, box] of Object.entries(scene.boxes)) {
    const [left, top, w, h] = box;
    let ink = 0,
      error = 0;
    for (
      let y = Math.max(0, Math.floor(top));
      y < Math.min(height, Math.ceil(top + h));
      y++
    )
      for (
        let x = Math.floor(left);
        x < Math.min(width, Math.ceil(left + w));
        x++
      ) {
        const p = y * width + x;
        if (ref[p * 4] + ref[p * 4 + 1] + ref[p * 4 + 2] < 420) {
          ink++;
          for (let c = 0; c < 3; c++)
            error += Math.abs(actual[p * 3 + c] - ref[p * 4 + c]);
        }
      }
    assert.ok(
      ink > 100,
      `${probe.label}: ${language} subtitle has no visible text`,
    );
    const inkError = error / (ink * 3);
    assert.ok(
      inkError < 24,
      `${probe.label}: ${language} text missing/wrong (${inkError})`,
    );
    languages[language] = { inkPixels: ink, mae: inkError };
  }
  results.push({ ...probe, mae, languages });
}
writeFileSync(
  `${dir}/frame-verification.json`,
  JSON.stringify({ result: "PASS", checks: results }, null, 2),
);
console.log(
  `Actual MP4 frame/subtitle verification PASS: ${results.length} probes at first/middle/last scenes, including before/at transitions.`,
);
