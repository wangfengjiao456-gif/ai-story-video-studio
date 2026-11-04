import test from "node:test";
import assert from "node:assert/strict";
import {
  templateDefaults,
  normalizePresentation,
  safeTextColor,
  contrast,
  presentationDefaults,
} from "../src/presentation/settings.js";
import {
  frameGeometry,
  wrapText,
  subtitlePages,
  pageAtTime,
} from "../src/presentation/layout.js";
import {
  initialProject,
  serializeProject,
  parseProject,
  splitArticle,
} from "../src/model.js";
import {
  saveProject,
  loadProject,
  PROJECT_KEY,
} from "../src/services/projectStorage.js";
import {
  validateImageRef,
  inspectImage,
  uploadImage,
} from "../src/services/images.js";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1UAAAAASUVORK5CYII=";
function project() {
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  return p;
}
function memory() {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
  };
}
test("旧 V1/V2 JSON 无 V3 字段时使用合理默认值，保留故事与提示词", () => {
  const p = project();
  delete p.videoTemplate;
  delete p.subtitleStyle;
  delete p.subtitlePosition;
  delete p.subtitleSafeArea;
  const loaded = parseProject(JSON.stringify(p));
  assert.equal(loaded.videoTemplate, "picturebook");
  assert.equal(loaded.subtitleStyle.height, 28);
  assert.equal(loaded.scenes[0].imageFit, "cover");
  assert.equal(loaded.scenes[0].description, p.scenes[0].description);
  assert.equal(loaded.english, p.english);
});
test("V3 模板/全部样式/图片构图通过保存刷新和 JSON 往返", () => {
  const p = project();
  Object.assign(p, {
    videoTemplate: "immersive",
    subtitleStyle: {
      ...templateDefaults("immersive"),
      englishSize: 68,
      chineseSize: 46,
      align: "left",
      height: 35,
      opacity: 0.85,
      englishLineHeight: 1.6,
      chineseLineHeight: 1.7,
      gap: 26,
    },
    subtitlePosition: 9,
    subtitleSafeArea: true,
  });
  Object.assign(p.scenes[0], {
    imageRef: { kind: "upload", dataUrl: png },
    imageFit: "contain",
    imageScale: 1.5,
    imagePosition: { x: 30, y: 80 },
  });
  const storage = memory();
  saveProject(storage, p);
  const restored = loadProject(storage).project;
  assert.equal(serializeProject(restored), serializeProject(p));
  assert.deepEqual(restored.subtitleStyle, p.subtitleStyle);
  assert.equal(restored.scenes[0].imageRef.dataUrl, png);
  assert.equal(restored.scenes[0].imageScale, 1.5);
  assert.equal(
    serializeProject(parseProject(serializeProject(restored))),
    storage.getItem(PROJECT_KEY),
  );
});
test("反复切换模板及恢复默认不会丢失分镜、图片和提示词", () => {
  let p = project();
  p.scenes[0].imageRef = { kind: "upload", dataUrl: png };
  const scenes = JSON.stringify(p.scenes);
  for (let i = 0; i < 20; i++) {
    const videoTemplate = i % 2 ? "immersive" : "picturebook";
    p = normalizePresentation({
      ...p,
      videoTemplate,
      subtitleStyle: templateDefaults(videoTemplate),
    });
    assert.equal(p.scenes[0].imageRef.dataUrl, png);
  }
  assert.equal(p.scenes[0].english, JSON.parse(scenes)[0].english);
  assert.equal(p.scenes[0].description, JSON.parse(scenes)[0].description);
});
test("拒绝越界参数、不合法颜色、注入 URL 和无效图片布局", () => {
  for (const patch of [
    { videoTemplate: "unknown" },
    { subtitlePosition: 0 },
    { subtitleSafeArea: "yes" },
    { subtitleStyle: { englishSize: 999 } },
    { subtitleStyle: { englishColor: "url(https://evil.test)" } },
    { subtitleStyle: { opacity: 0 } },
    { subtitleStyle: { align: "right" } },
  ])
    assert.throws(() => serializeProject({ ...project(), ...patch }));
  for (const patch of [
    { imageFit: "fill" },
    { imageScale: 3 },
    { imagePosition: { x: -1, y: 50 } },
    { imageRef: { kind: "upload", dataUrl: "https://evil.test/a.png" } },
  ]) {
    const p = project();
    Object.assign(p.scenes[0], patch);
    assert.throws(() => serializeProject(p));
  }
});
test("未知密钥字段不能经 V3 设置序列化进入 JSON", () => {
  const p = project();
  p.apiKey = "test-private";
  p.subtitleStyle.apiKey = "test-private";
  p.scenes[0].imagePosition = { x: 50, y: 50, apiKey: "test-private" };
  p.scenes[0].imageRef = {
    kind: "upload",
    dataUrl: png,
    apiKey: "test-private",
  };
  assert.ok(!serializeProject(p).includes("test-private"));
});
test("A/B 不同字号、行距与显示模式下每页都在安全区域内且原文完整", () => {
  const english =
    "This is a long English sentence with a verylongword".repeat(12) +
    "\nAnother line.";
  const chinese = "这是一段需要自动换行并完整展示的较长中文翻译。".repeat(15);
  for (const template of ["picturebook", "immersive"])
    for (const mode of ["en", "zh", "both"])
      for (const large of [false, true])
        for (const position of [6, 12])
          for (const ratio of ["9:16", "16:9"]) {
            const style = {
              ...templateDefaults(template),
              ...(large
                ? {
                    englishSize: 80,
                    chineseSize: 64,
                    englishLineHeight: 1.8,
                    chineseLineHeight: 1.8,
                    height: 25,
                    gap: 32,
                  }
                : {}),
            };
            const geo = frameGeometry(style, position, ratio),
              layout = subtitlePages(english, chinese, mode, style, geo);
            assert.ok(
              layout.pages.every(
                (page) => page.height <= geo.textHeight + 0.01,
              ),
            );
            assert.ok(layout.englishSize >= 40);
            assert.ok(layout.chineseSize >= 30);
            assert.equal(
              layout.pages.flatMap((p) => p.english).join(""),
              mode === "zh" ? "" : english,
            );
            assert.equal(
              layout.pages.flatMap((p) => p.chinese).join(""),
              mode === "en" ? "" : chinese,
            );
          }
});
test("英文超长单词和中文长句按宽度换行，无横向溢出", () => {
  for (const text of [
    "W".repeat(2000),
    "中".repeat(2000),
    "short words ".repeat(100),
  ]) {
    const lines = wrapText(text, 864, 80);
    assert.equal(lines.join(""), text);
    assert.ok(
      lines.every(
        (line) =>
          [...line].reduce(
            (n, ch) => n + (/[\u0000-\u007f]/.test(ch) ? 0.66 : 1.08) * 80,
            0,
          ) <= 864.001,
      ),
    );
  }
});
test("十万字符长句仍通过分页完整保留，不用省略号裁切", () => {
  const text = "a".repeat(100000);
  const style = templateDefaults();
  const result = subtitlePages(
    text,
    "中文。",
    "both",
    style,
    frameGeometry(style, 6),
  );
  assert.equal(result.pages.flatMap((p) => p.english).join(""), text);
  assert.ok(result.pages.length > 1);
});
test("对比度保护会替换低对比色，合适颜色保持原值", () => {
  assert.equal(safeTextColor("#173e2e", "#fff8ec", 1, "#173e2e"), "#173e2e");
  assert.notEqual(safeTextColor("#ffffff", "#fff8ec", 1, "#173e2e"), "#ffffff");
  assert.notEqual(
    safeTextColor("#081812", "#081812", 0.85, "#ffffff"),
    "#081812",
  );
  assert.ok(contrast([255, 255, 255], [8, 24, 18]) > 4.5);
});
test("字幕分页跟随音频时间，暂停保持、seek 跳转、重播归零；标签仍为估算", () => {
  assert.equal(pageAtTime(4, 10, 10, 50), 0);
  assert.equal(pageAtTime(4, 29.9, 10, 50), 1);
  assert.equal(pageAtTime(4, 40, 10, 50), 3);
  assert.equal(pageAtTime(4, 40, 10, 50), 3);
  assert.equal(pageAtTime(4, 10, 10, 50), 0);
  assert.equal(pageAtTime(4, 50, 10, 50), 3);
});
test("图片格式、像素和导入源校验：阻止 SVG、远程 URL、损坏与超大图片", async () => {
  validateImageRef({ kind: "upload", dataUrl: png });
  const bytes = Uint8Array.from(atob(png.split(",")[1]), (c) =>
    c.charCodeAt(0),
  );
  assert.deepEqual(inspectImage(bytes), {
    mime: "image/png",
    width: 1,
    height: 1,
  });
  for (const dataUrl of [
    "https://evil.test/image.png",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/png;base64,YWJj",
  ])
    assert.throws(() => validateImageRef({ kind: "upload", dataUrl }));
  const huge = bytes.slice();
  new DataView(huge.buffer).setUint32(16, 12000);
  new DataView(huge.buffer).setUint32(20, 12000);
  assert.throws(() => inspectImage(huge), /尺寸过大/);
  await assert.rejects(uploadImage({ size: 9 * 1024 * 1024 }), /8 MB/);
});
