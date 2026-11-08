import { normalizePresentation, safeTextColor } from "./settings.js";
import { frameGeometry, subtitlePages } from "./layout.js";
export const FONT_STACK = 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
export function framePlan(project, scene, measure) {
  if (scene?.isCover) {
    const titleProject = {
      ...project,
      videoTemplate: "picturebook",
      subtitles: "both",
      subtitlePosition: 12,
      subtitleStyle: {
        ...project.subtitleStyle,
        englishSize: 44,
        chineseSize: 76,
        height: 36,
        align: "center",
        backgroundColor: "#fff8ec",
        opacity: 1,
        englishColor: "#405446",
        chineseColor: "#173e2e",
      },
    };
    const result = framePlan(
      titleProject,
      { ...scene, isCover: false },
      measure,
    );
    result.isCover = true;
    return result;
  }
  const p = normalizePresentation(project),
    style = p.subtitleStyle,
    geometry = frameGeometry(style, p.subtitlePosition, p.ratio),
    immersive = p.videoTemplate === "immersive";
  const background = immersive ? "#081812" : style.backgroundColor;
  const englishColor = safeTextColor(
    style.englishColor,
    background,
    style.opacity,
    immersive ? "#ffffff" : "#173e2e",
  );
  const chineseColor = safeTextColor(
    style.chineseColor,
    background,
    style.opacity,
    immersive ? "#ffffff" : "#173e2e",
  );
  return {
    geometry,
    style,
    immersive,
    englishColor,
    chineseColor,
    layout: subtitlePages(
      scene?.english || "",
      scene?.chinese || "",
      p.subtitles,
      style,
      geometry,
      measure,
    ),
    scene,
    outputWidth: p.ratio === "16:9" ? 1920 : 1080,
    outputHeight: p.ratio === "16:9" ? 1080 : geometry.height,
  };
}
export function imageRectangle(
  width,
  height,
  boxWidth,
  boxHeight,
  fit = "contain",
  scale = 1,
  position = { x: 50, y: 50 },
) {
  const factor =
    (fit === "cover"
      ? Math.max(boxWidth / width, boxHeight / height)
      : Math.min(boxWidth / width, boxHeight / height)) * scale;
  const w = width * factor,
    h = height * factor;
  return {
    x: ((boxWidth - w) * position.x) / 100,
    y: ((boxHeight - h) * position.y) / 100,
    width: w,
    height: h,
  };
}
function rgb(hex) {
  return hex
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16))
    .join(",");
}
export function paintFrame(ctx, plan, pageIndex, image) {
  const { geometry: g, style: s, immersive, layout, scene } = plan;
  const factor = plan.outputWidth / g.width;
  ctx.setTransform(factor, 0, 0, factor, 0, 0);
  ctx.clearRect(0, 0, g.width, g.height);
  ctx.fillStyle = "#dce2d2";
  ctx.fillRect(0, 0, g.width, g.height);
  const artHeight = immersive ? g.height : g.height - g.panelHeight;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, g.width, artHeight);
  ctx.clip();
  if (image) {
    const r = imageRectangle(
      image.naturalWidth,
      image.naturalHeight,
      g.width,
      artHeight,
      scene.imageFit,
      scene.imageScale ?? 1,
      scene.imagePosition,
    );
    ctx.drawImage(image, r.x, r.y, r.width, r.height);
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, artHeight);
    sky.addColorStop(0, "#ced4b6");
    sky.addColorStop(1, "#adb592");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, g.width, artHeight);
    ctx.fillStyle = "#f3ecc6";
    ctx.beginPath();
    ctx.arc(570, artHeight * 0.28, 130, 0, Math.PI * 2);
    ctx.fill();
    for (const [color, y] of [
      ["#9aaa85", 0.6],
      ["#7f9470", 0.8],
    ]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-100, artHeight * y);
      ctx.bezierCurveTo(
        400,
        artHeight * (y - 0.3),
        700,
        artHeight * (y + 0.3),
        1180,
        artHeight * y,
      );
      ctx.lineTo(1180, artHeight);
      ctx.lineTo(-100, artHeight);
      ctx.fill();
    }
    ctx.fillStyle = "#536c52";
    for (const x of [100, 940]) {
      ctx.fillRect(x, artHeight * 0.2, 35, artHeight * 0.8);
      ctx.beginPath();
      ctx.ellipse(
        x + 18,
        artHeight * 0.28,
        100,
        artHeight * 0.24,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = "#b78a54";
    ctx.beginPath();
    ctx.arc(570, artHeight * 0.62, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(540, artHeight * 0.62, 60, 105);
  }
  ctx.restore();
  if (immersive) {
    const gradient = ctx.createLinearGradient(
      0,
      g.height - g.panelHeight - 220,
      0,
      g.height,
    );
    gradient.addColorStop(0, "rgba(8,24,18,0)");
    gradient.addColorStop(
      220 / (g.panelHeight + 220),
      `rgba(8,24,18,${s.opacity})`,
    );
    gradient.addColorStop(1, `rgba(8,24,18,${s.opacity})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(
      0,
      g.height - g.panelHeight - 220,
      g.width,
      g.panelHeight + 220,
    );
  } else {
    ctx.fillStyle = `rgba(${rgb(s.backgroundColor)},${s.opacity})`;
    ctx.fillRect(0, g.height - g.panelHeight, g.width, g.panelHeight);
  }
  const page =
    layout.pages[Math.max(0, Math.min(pageIndex, layout.pages.length - 1))];
  let y = g.height - g.bottom - page.height;
  ctx.textAlign = s.align === "center" ? "center" : "left";
  ctx.textBaseline = "top";
  const x = s.align === "center" ? g.width / 2 : g.left;
  const draw = (lines, size, lineHeight, color) => {
    ctx.font = `600 ${size}px ${FONT_STACK}`;
    ctx.fillStyle = color;
    ctx.strokeStyle =
      color.toLowerCase() === "#ffffff" || color.toLowerCase() === "#f2f1df"
        ? "#10251a"
        : "#fff8ec";
    ctx.lineWidth = s.stroke * 2;
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(0,0,0,.8)";
    ctx.shadowBlur = s.shadow;
    ctx.shadowOffsetY = s.shadow / 3;
    for (const line of lines) {
      const text = line.replace(/\n$/, "");
      const baseline = y + (size * lineHeight - size) / 2;
      if (s.stroke) ctx.strokeText(text, x, baseline);
      ctx.fillText(text, x, baseline);
      y += size * lineHeight;
    }
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  };
  if (plan.isCover) {
    draw(
      page.chinese,
      layout.chineseSize,
      s.chineseLineHeight,
      plan.chineseColor,
    );
    if (page.english.length && page.chinese.length) y += s.gap;
    draw(
      page.english,
      layout.englishSize,
      s.englishLineHeight,
      plan.englishColor,
    );
    return;
  }
  draw(
    page.english,
    layout.englishSize,
    s.englishLineHeight,
    plan.englishColor,
  );
  if (page.english.length && page.chinese.length) y += s.gap;
  draw(
    page.chinese,
    layout.chineseSize,
    s.chineseLineHeight,
    plan.chineseColor,
  );
}

// Keep export text in the same CSS/language inheritance context as the visible preview.
// Detached canvases can select a different CJK font/weight even with the same ctx.font.
export function createExportCanvas(doc = globalThis.document) {
  const canvas = doc.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  canvas.hidden = true;
  doc.body.appendChild(canvas);
  return canvas;
}
