// Offline-only PCM mixing; the exact same WAV is used by preview and FFmpeg.
export const MIX_RATE = 32000;
export const mixKey = (p, assets, music) =>
  JSON.stringify([
    p.cover?.enabled ? p.cover.duration : 0,
    p.videoTiming,
    p.music?.enabled ? p.music : null,
    p.music?.enabled ? music?.id : null,
    assets.map((a) => [a.url, a.duration]),
  ]);
export function envelope(t, total, settings, cues) {
  const fade = Math.min(settings.fade, total / 2),
    edge = fade ? Math.min(1, t / fade, (total - t) / fade) : 1;
  let duck = 1;
  // Cues are the shared confirmed sentence ranges, with a short smooth attack/release.
  for (const c of cues) {
    const ramp = 0.12;
    if (t >= c.start && t <= c.end) duck = Math.min(duck, settings.duck);
    else if (t >= c.start - ramp && t < c.start)
      duck = Math.min(
        duck,
        1 - ((1 - settings.duck) * (t - (c.start - ramp))) / ramp,
      );
    else if (t > c.end && t < c.end + ramp)
      duck = Math.min(
        duck,
        settings.duck + ((1 - settings.duck) * (t - c.end)) / ramp,
      );
  }
  return Math.max(0, edge) * settings.volume * duck;
}
export function pcmWav(samples, rate = MIX_RATE) {
  let peak = 1;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    v = new DataView(buffer);
  const str = (o, s) =>
    [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) =>
    v.setInt16(
      44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, x / peak)) * 32767),
      true,
    ),
  );
  return new Blob([buffer], { type: "audio/wav" });
}
export async function mixVideoAudio(project, timeline, music, { signal } = {}) {
  const cover = timeline.coverDuration || 0,
    total = timeline.duration;
  const Constructor =
    globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Constructor)
    throw Error(
      "此浏览器不支持离线混音。可关闭背景音乐与封面，保留原MP3导出，或升级Safari。",
    );
  if (project.music?.enabled && !music?.blob)
    throw Error("请重新上传原背景音乐；音乐文件不在JSON中。");
  const ctx = new Constructor(1, Math.ceil(total * MIX_RATE), MIX_RATE);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const guard = () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  let cursor = cover,
    declared = cover;
  for (const asset of timeline.originalAudios || timeline.audios) {
    guard();
    const bytes = await asset.blob.arrayBuffer();
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(bytes.slice(0));
    } catch {
      throw Error("旁白无法离线解码，请重新导入标准MP3；原文件未修改。");
    }
    guard();
    if (Math.abs(decoded.duration - asset.duration) > 1 / 30)
      throw Error(
        "音频解码长度与确认时轴不同，请重新导入/校准；不会裁切或拉伸配音。",
      );
    const source = ctx.createBufferSource();
    source.buffer = decoded;
    source.connect(master);
    source.start(cursor);
    cursor += decoded.duration;
    declared += asset.duration;
    if (Math.abs(cursor - declared) > 1 / 30)
      throw Error("多段音频累计长度不同，请逐镜重新校准，避免累计漂移。");
  }
  if (project.music?.enabled) {
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(await music.blob.arrayBuffer());
    } catch {
      throw Error("背景音乐无法解码，请换一份标准MP3；原旁白保留。");
    }
    guard();
    if (!decoded.duration) throw Error("音乐无法解码，请上传标准MP3。");
    const source = ctx.createBufferSource();
    source.buffer = decoded;
    source.loop = true;
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(master);
    // 30fps envelope is independent of the playback event rate and used for the exported samples.
    const cues = timeline.ranges.map((r) => ({
      start: r.start + cover,
      end: r.end + cover,
    }));
    for (let frame = 0; frame <= Math.ceil(total * 30); frame++) {
      const t = Math.min(total, frame / 30);
      gain.gain.linearRampToValueAtTime(
        envelope(t, total, project.music, cues),
        t,
      );
    }
    source.start(0);
    source.stop(total);
  }
  guard();
  let rendered;
  try {
    rendered = await ctx.startRendering();
  } catch {
    throw Error(
      "本地混音失败或内存不足，请先备份项目，缩短音乐/项目或关闭音乐后重试；不会调用付费API。",
    );
  }
  guard();
  const blob = pcmWav(rendered.getChannelData(0));
  if (blob.size > 50 * 1024 * 1024) throw Error("混音超过50MB，请缩短项目。");
  return {
    blob,
    url: URL.createObjectURL(blob),
    duration: rendered.duration,
    encoding: "wav",
  };
}
