import test from "node:test";
import assert from "node:assert/strict";
import {
  initialProject,
  splitArticle,
  parseProject,
  serializeProject,
  downloadProject,
  TEXT_LIMIT,
  TITLE_LIMIT,
  PROJECT_BYTES_LIMIT,
  textError,
} from "../src/model.js";
import {
  scheduleProjectSave,
  loadProject,
  saveProject,
  PROJECT_KEY,
  RECOVERY_KEY,
} from "../src/services/projectStorage.js";
function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    writes: [],
    getItem: (key) => items.get(key) ?? null,
    setItem(key, value) {
      this.writes.push(key);
      items.set(key, value);
    },
  };
}
function project() {
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  return p;
}
const fields = [
  ["项目名称", (p) => [p, "title"], TITLE_LIMIT],
  ["英文文章", (p) => [p, "english"], TEXT_LIMIT],
  ["中文译文", (p) => [p, "chinese"], TEXT_LIMIT],
  ...["name", "appearance", "clothing"].map((key) => [
    `人物 ${key}`,
    (p) => [p.character, key],
    TEXT_LIMIT,
  ]),
  ...["english", "chinese", "description"].map((key) => [
    `分镜 ${key}`,
    (p) => [p.scenes[0], key],
    TEXT_LIMIT,
  ]),
];
for (const [label, target, limit] of fields) {
  test(`${label}：边界可保存、刷新恢复、导出导入；超限拒绝且不修改旧存档`, () => {
    const p = project();
    const [obj, key] = target(p);
    obj[key] = "中".repeat(limit);
    const storage = memoryStorage();
    saveProject(storage, p);
    const restored = loadProject(storage);
    assert.equal(target(restored.project)[0][key], obj[key]);
    const raw = serializeProject(restored.project);
    assert.equal(target(parseProject(raw))[0][key], obj[key]);
    const old = storage.getItem(PROJECT_KEY);
    const writes = storage.writes.length;
    obj[key] += "中";
    assert.match(textError(obj[key], label, limit), /超过/);
    assert.throws(() => saveProject(storage, p), /超过/);
    assert.throws(() => serializeProject(p), /超过/);
    assert.throws(() => downloadProject(p), /超过/); // Validation happens before browser download.
    assert.throws(() => parseProject(JSON.stringify(p)), /超过/);
    assert.equal(storage.getItem(PROJECT_KEY), old);
    assert.equal(storage.writes.length, writes);
    assert.equal(obj[key].length, limit + 1); // The draft is not truncated.
  });
}
test("存储配额或权限失败向调用方抛错，原存档与当前草稿保留", () => {
  const original = serializeProject(project());
  const storage = memoryStorage({ [PROJECT_KEY]: original });
  storage.setItem = () => {
    throw Error("QuotaExceededError");
  };
  const draft = project();
  draft.title = "尚未保存的故事";
  assert.throws(() => saveProject(storage, draft), /QuotaExceededError/);
  assert.equal(storage.getItem(PROJECT_KEY), original);
  assert.equal(draft.title, "尚未保存的故事");
  assert.equal(parseProject(serializeProject(draft)).title, draft.title);
});
test("旧版超限存档完整载入修复；校验失败不覆盖，修复后先备份再保存", () => {
  const legacy = project();
  legacy.english = "a".repeat(TEXT_LIMIT + 1);
  const raw = JSON.stringify(legacy);
  const storage = memoryStorage({ [PROJECT_KEY]: raw });
  const loaded = loadProject(storage);
  assert.equal(loaded.recovery, true);
  assert.equal(loaded.raw, raw);
  assert.equal(loaded.project.english, legacy.english);
  assert.equal(storage.writes.length, 0);
  assert.throws(() => saveProject(storage, loaded.project), /超过/);
  loaded.project.english = "缩短后的内容";
  const saved = saveProject(storage, loaded.project);
  assert.equal(saved.archived, true);
  assert.deepEqual(storage.writes, [RECOVERY_KEY, PROJECT_KEY]);
  const refreshed = loadProject(storage);
  assert.equal(refreshed.recovery, false);
  assert.equal(refreshed.project.english, "缩短后的内容");
  assert.deepEqual(refreshed.backups, [raw]);
});
test("损坏 JSON 不替换为示例，原始数据可下载，载入不写存储", () => {
  const raw = "{broken user content";
  const storage = memoryStorage({ [PROJECT_KEY]: raw });
  const result = loadProject(storage);
  assert.equal(result.project, null);
  assert.equal(result.recovery, true);
  assert.equal(result.raw, raw);
  assert.equal(storage.getItem(PROJECT_KEY), raw);
  assert.equal(storage.writes.length, 0);
});
test("恢复备份写入失败时禁止覆盖无效原存档", () => {
  const raw = "broken";
  const storage = memoryStorage({ [PROJECT_KEY]: raw });
  storage.setItem = (key) => {
    assert.equal(key, RECOVERY_KEY);
    throw Error("quota");
  };
  assert.throws(() => saveProject(storage, project()), /quota/);
  assert.equal(storage.getItem(PROJECT_KEY), raw);
});
test("备份成功但项目写入失败，原存档和恢复备份仍在", () => {
  const raw = "broken";
  const storage = memoryStorage({ [PROJECT_KEY]: raw });
  const write = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === PROJECT_KEY) throw Error("quota");
    write(key, value);
  };
  assert.throws(() => saveProject(storage, project()), /quota/);
  assert.equal(storage.getItem(PROJECT_KEY), raw);
  assert.deepEqual(JSON.parse(storage.getItem(RECOVERY_KEY)), [raw]);
});
test("多次恢复不丢失旧备份，损坏的备份归档阻止保存", () => {
  const storage = memoryStorage({
    [PROJECT_KEY]: "second broken",
    [RECOVERY_KEY]: JSON.stringify(["first broken"]),
  });
  saveProject(storage, project());
  assert.deepEqual(loadProject(storage).backups, [
    "first broken",
    "second broken",
  ]);
  storage.setItem(RECOVERY_KEY, "broken archive");
  const previous = storage.getItem(PROJECT_KEY);
  assert.throws(() => saveProject(storage, project()));
  assert.equal(storage.getItem(PROJECT_KEY), previous);
});
test("拒绝总大小超限；中文按 UTF-8 字节检查；导出与保存使用完全相同的序列化", () => {
  const p = project();
  p.scenes = Array.from({ length: 20 }, () => ({
    english: "中".repeat(TEXT_LIMIT),
    chinese: "",
    description: "",
    duration: 5,
  }));
  assert.throws(() => serializeProject(p), /5 MB/);
  assert.throws(() => saveProject(memoryStorage(), p), /5 MB/);
  assert.throws(
    () => parseProject(" ".repeat(PROJECT_BYTES_LIMIT + 1)),
    /5 MB/,
  );
  const valid = project();
  const storage = memoryStorage();
  saveProject(storage, valid);
  assert.equal(storage.getItem(PROJECT_KEY), serializeProject(valid));
  assert.equal(
    serializeProject(parseProject(serializeProject(valid))),
    serializeProject(valid),
  );
});
test("有效 JSON 实际下载内容与保存内容相同，重新导入不丢字段", async () => {
  const p = project();
  const storage = memoryStorage();
  saveProject(storage, p);
  let blob,
    clicked = false;
  const originalURL = globalThis.URL,
    originalDocument = globalThis.document,
    originalTimeout = globalThis.setTimeout;
  try {
    globalThis.URL = {
      createObjectURL: (value) => {
        blob = value;
        return "blob:test";
      },
      revokeObjectURL: () => {},
    };
    globalThis.document = {
      createElement: () => ({
        click() {
          clicked = true;
        },
      }),
    };
    globalThis.setTimeout = (fn) => {
      fn();
      return 0;
    };
    downloadProject(p);
    assert.equal(clicked, true);
    assert.equal(await blob.text(), storage.getItem(PROJECT_KEY));
    assert.equal(
      serializeProject(parseProject(await blob.text())),
      serializeProject(p),
    );
  } finally {
    globalThis.URL = originalURL;
    globalThis.document = originalDocument;
    globalThis.setTimeout = originalTimeout;
  }
});
test("读取权限失败展示恢复状态，不打开示例、不写数据", () => {
  const result = loadProject({
    getItem() {
      throw Error("SecurityError");
    },
    setItem() {
      assert.fail("不得写入");
    },
  });
  assert.equal(result.project, null);
  assert.equal(result.recovery, true);
  assert.equal(result.raw, null);
});
test("无效导入抛错，当前对象与本地存档均保持原样", () => {
  const p = project();
  const before = serializeProject(p);
  const storage = memoryStorage({ [PROJECT_KEY]: before });
  for (const invalid of [
    "{",
    "{}",
    JSON.stringify({ ...p, title: "x".repeat(TITLE_LIMIT + 1) }),
  ])
    assert.throws(() => parseProject(invalid));
  assert.equal(serializeProject(p), before);
  assert.equal(storage.getItem(PROJECT_KEY), before);
  assert.equal(storage.writes.length, 0);
});

test("项目恰好 5 MB 时保存、刷新与导出导入一致，多一个字节被拒绝", () => {
  const p = project();
  p.scenes = Array.from({ length: 52 }, () => ({
    english: "a".repeat(TEXT_LIMIT),
    chinese: "",
    description: "",
    duration: 5,
  }));
  const base = new TextEncoder().encode(serializeProject(p)).byteLength;
  const padding = PROJECT_BYTES_LIMIT - base;
  assert.ok(padding > 0 && padding < TEXT_LIMIT);
  p.scenes[0].chinese = "b".repeat(padding);
  const raw = serializeProject(p);
  assert.equal(new TextEncoder().encode(raw).byteLength, PROJECT_BYTES_LIMIT);
  const storage = memoryStorage();
  saveProject(storage, p);
  assert.equal(serializeProject(loadProject(storage).project), raw);
  assert.equal(serializeProject(parseProject(raw)), raw);
  p.scenes[0].chinese += "b";
  assert.throws(() => saveProject(storage, p), /5 MB/);
  assert.equal(storage.getItem(PROJECT_KEY), raw);
});

test("自动保存提示词与十镜、刷新及JSON恢复；取消旧草稿且失败不覆盖", async () => {
  const p = initialProject();
  p.english = Array.from({ length: 10 }, (_, i) => `Scene ${i + 1}.`).join(" ");
  p.scenes = splitArticle(p.english, "");
  assert.equal(p.scenes.length, 10);
  assert.ok(p.scenes.every((s) => s.description === ""));
  p.scenes[0].description = "A child walking through a green forest.";
  const storage = memoryStorage();
  let saved = 0;
  const cancel = scheduleProjectSave(
    storage,
    { ...p, title: "obsolete" },
    { delayMs: 10, onSaved: () => saved++ },
  );
  cancel();
  await new Promise((resolve, reject) =>
    scheduleProjectSave(storage, p, {
      delayMs: 10,
      onSaved: () => {
        saved++;
        resolve();
      },
      onError: reject,
    }),
  );
  assert.equal(saved, 1);
  const restored = loadProject(storage).project;
  assert.equal(restored.scenes[0].description, p.scenes[0].description);
  assert.equal(
    parseProject(serializeProject(restored)).scenes[0].description,
    p.scenes[0].description,
  );
  const before = storage.getItem(PROJECT_KEY);
  const invalid = { ...p, title: "x".repeat(TITLE_LIMIT + 1) };
  await new Promise((resolve) =>
    scheduleProjectSave(storage, invalid, {
      delayMs: 1,
      onSaved: () => assert.fail("不能假报成功"),
      onError: resolve,
    }),
  );
  assert.equal(storage.getItem(PROJECT_KEY), before);
  const denied = {
    ...storage,
    setItem: () => {
      throw Error("QuotaExceeded");
    },
  };
  await new Promise((resolve) =>
    scheduleProjectSave(denied, p, {
      delayMs: 1,
      onSaved: () => assert.fail("不能假报成功"),
      onError: resolve,
    }),
  );
  assert.equal(storage.getItem(PROJECT_KEY), before);
});

test("Safari localStorage 属性访问被拒绝时自动保存回调报告失败，不抛出到页面", async () => {
  const p = initialProject();
  const error = await new Promise((resolve) =>
    scheduleProjectSave(
      () => {
        throw Error("SecurityError");
      },
      p,
      {
        delayMs: 1,
        onSaved: () => assert.fail("不应保存成功"),
        onError: resolve,
      },
    ),
  );
  assert.match(error.message, /SecurityError/);
});
