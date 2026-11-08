import { coverScene } from "../creation/project.js";
import { validateCues } from "./alignment.js";
import { articleTimeline, isFresh } from "../services/aiVoice.js";
import { framePlan } from "../presentation/frameRenderer.js";
export const FPS = 30;
export function timingSignature(project, assets, speed, mode) {
  const audio =
    mode === "article"
      ? [assets.article]
      : project.scenes.map((s) => assets[s.id]);
  const raw = JSON.stringify([
    mode,
    project.english,
    project.scenes.map((s) => s.english),
    speed,
    audio.map((a) => {
      // Preserve the V3.1 external-MP3 signature shape for already saved projects.
      const values = [
        a?.text,
        a?.duration,
        a?.blob?.size,
        a?.alignment,
        a?.fingerprint,
      ];
      if (a?.normalizedAlignment) values.push(a.normalizedAlignment);
      return values;
    }),
  ]);
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${mode}-${(h >>> 0).toString(16)}${assets.article?.external && mode === "article" ? "-" + assets.article.fingerprint : ""}`;
}
export function buildVideoTimeline(
  project,
  assets,
  speed,
  mode = "article",
  measure,
  mixedAudio,
) {
  if (!project.scenes.length) throw Error("请先添加分镜。");
  for (let i = 0; i < project.scenes.length; i++)
    if (!project.scenes[i].imageRef)
      throw Error(`分镜 ${i + 1} 尚无图片，请上传或生成后再导出。`);
  let ranges, audios, precision, reason;
  if (mode === "article") {
    const a = assets.article;
    if (
      !isFresh(a, project.english, speed) ||
      !a.blob ||
      !Number.isFinite(a.duration) ||
      a.duration <= 0
    )
      throw Error("请先生成或导入当前英文文章的 MP3，并读取真实时长。");
    const t = articleTimeline(a.text, project.scenes, a);
    if (!t.ranges.length) throw Error("无法建立音频时轴。");
    ranges = t.ranges;
    audios = [a];
    precision = t.mode;
    reason = t.reason;
  } else {
    let time = 0;
    audios = project.scenes.map((s, i) => {
      const a = assets[s.id];
      if (
        !isFresh(a, s.english, speed) ||
        !a.blob ||
        !Number.isFinite(a.duration) ||
        a.duration <= 0
      )
        throw Error(`请先为分镜 ${i + 1} 生成并载入 MP3 时长。`);
      return a;
    });
    ranges = audios.map((a, index) => {
      const start = time;
      time += a.duration;
      return { index, start, end: time };
    });
    precision = "clips";
  }
  const duration = audios.reduce((n, a) => n + a.duration, 0);
  if (duration > 600) throw Error("当前导出最多支持 10 分钟。");
  const signature = timingSignature(project, assets, speed, mode),
    manual =
      project.videoTiming?.signature === signature
        ? project.videoTiming.boundaries
        : null;
  const savedCues =
    project.videoTiming?.signature === signature
      ? project.videoTiming.cues
      : null;
  if (mode === "article" && assets.article?.external && !manual && !savedCues)
    throw Error(
      "外部 MP3 必须先完成逐句音频对齐，或手动填写并确认全部分镜起止时间；不会按字数猜测。 ",
    );
  if (savedCues && !validateCues(savedCues, project.scenes.length, duration))
    throw Error("起止时间无效：请确保不重叠且位于音频时长内。");
  const boundaries = manual || [
    0,
    ...ranges.slice(1).map((r) => r.start),
    duration,
  ];
  if (
    boundaries.length !== project.scenes.length + 1 ||
    boundaries[0] !== 0 ||
    Math.abs(boundaries.at(-1) - duration) > 0.1 ||
    boundaries.some(
      (v, i) => !Number.isFinite(v) || (i > 0 && v <= boundaries[i - 1]),
    )
  )
    throw Error("手动时间轴无效，请恢复自动时轴。");
  const frames = [];
  ranges = project.scenes.map((s, index) => ({
    index,
    start: Math.round(boundaries[index] * FPS) / FPS,
    end:
      index === project.scenes.length - 1
        ? Math.ceil(duration * FPS) / FPS
        : Math.round(boundaries[index + 1] * FPS) / FPS,
  }));
  if (savedCues)
    ranges = savedCues.map((c, index) => ({
      index,
      start: Math.round(c.start * FPS) / FPS,
      end: Math.round(c.end * FPS) / FPS,
    }));
  const p = { ...project, ratio: "9:16" };
  for (const range of ranges) {
    const plan = framePlan(p, project.scenes[range.index], measure),
      length = Math.round((range.end - range.start) * FPS);
    if (length < plan.layout.pages.length)
      throw Error(
        `分镜 ${range.index + 1} 时间太短，无法容纳全部字幕页，请拆分内容或延长音频。`,
      );
    for (let page = 0; page < plan.layout.pages.length; page++) {
      const start =
          Math.round(range.start * FPS) +
          Math.floor((page * length) / plan.layout.pages.length),
        end =
          Math.round(range.start * FPS) +
          Math.floor(((page + 1) * length) / plan.layout.pages.length);
      frames.push({
        sceneIndex: range.index,
        page,
        start: start / FPS,
        end: end / FPS,
        frames: end - start,
        plan,
      });
    }
  }
  // Fill silent intervals with the held image and no caption, shared by preview/export.
  if (savedCues) {
    const filled = [];
    let cursor = 0;
    for (const f of frames) {
      if (f.start > cursor) {
        const sceneIndex = filled.at(-1)?.sceneIndex ?? f.sceneIndex;
        const scene = {
          ...project.scenes[sceneIndex],
          english: "",
          chinese: "",
        };
        filled.push({
          sceneIndex,
          page: 0,
          start: cursor,
          end: f.start,
          frames: Math.round((f.start - cursor) * FPS),
          plan: framePlan(p, scene, measure),
        });
      }
      filled.push(f);
      cursor = f.end;
    }
    const end = Math.ceil(duration * FPS) / FPS;
    if (cursor < end) {
      const sceneIndex = project.scenes.length - 1;
      filled.push({
        sceneIndex,
        page: 0,
        start: cursor,
        end,
        frames: Math.round((end - cursor) * FPS),
        plan: framePlan(
          p,
          { ...project.scenes[sceneIndex], english: "", chinese: "" },
          measure,
        ),
      });
    }
    frames.splice(0, frames.length, ...filled);
  }
  const coverDuration = project.cover?.enabled
    ? Math.round(project.cover.duration * FPS) / FPS
    : 0;
  if (coverDuration) {
    if (!project.cover.imageRef)
      throw Error("封面00尚无图片，请上传/生成，或关闭封面。");
    const scene = { ...coverScene(project), isCover: true };
    const plan = framePlan(p, scene, measure);
    if (plan.layout.pages.length !== 1)
      throw Error("封面标题过长，请缩短标题以便完整显示。");
    for (const f of frames) {
      f.start += coverDuration;
      f.end += coverDuration;
    }
    frames.unshift({
      sceneIndex: 0,
      isCover: true,
      page: 0,
      start: 0,
      end: coverDuration,
      frames: Math.round(coverDuration * FPS),
      plan,
    });
  }
  const originalAudios = audios;
  const totalDuration = duration + coverDuration;
  if (totalDuration > 600) throw Error("含封面的视频最多10分钟。");
  const requiresMix =
    !!(coverDuration || project.music?.enabled) && !mixedAudio;
  if (mixedAudio) {
    if (Math.abs(mixedAudio.duration - totalDuration) > 1 / FPS)
      throw Error("混音时长与视频时轴不一致，请重新准备。");
    audios = [mixedAudio];
  }
  if (frames.length > 300)
    throw Error("字幕分页超过 300 页，请缩短内容或拆成多个项目。");
  return {
    signature,
    precision: savedCues
      ? project.videoTiming.source === "forced"
        ? "forced"
        : "manual"
      : manual
        ? "manual"
        : precision,
    reason,
    manualStale: !!project.videoTiming && !manual && !savedCues,
    duration: totalDuration,
    sourceDuration: totalDuration,
    narrationDuration: duration,
    coverDuration,
    originalAudios,
    requiresMix,
    ranges,
    frames,
    audios,
    manifest: {
      version: 1,
      width: 1080,
      height: 1920,
      fps: FPS,
      frames: frames.map((f) => ({ frames: f.frames })),
      audios: audios.map((a) => ({
        duration: a.duration,
        ...(a.encoding ? { encoding: a.encoding } : {}),
      })),
    },
  };
}
export function frameAt(timeline, time) {
  return (
    (time <= 0
      ? timeline.frames[0]
      : timeline.frames.find((f) => time >= f.start && time < f.end)) ||
    timeline.frames.at(-1)
  );
}
export function audioAt(timeline, time) {
  let start = 0;
  for (let i = 0; i < timeline.audios.length; i++) {
    const a = timeline.audios[i];
    if (time < start + a.duration || i === timeline.audios.length - 1)
      return {
        index: i,
        start,
        offset: Math.max(0, Math.min(a.duration, time - start)),
      };
    start += a.duration;
  }
  return { index: 0, start: 0, offset: 0 };
}
