import { voiceMode, hasMissingVoiceBackup } from "../creation/voiceRecovery.js";
import { mediaKey, readMedia, writeMedia } from "../creation/mediaStore.js";
import { STYLE_OPTIONS } from "../creation/style.js";
import React, { useState, useRef, useEffect } from "react";
import {
  localPlan,
  applyPlan,
  planningSignature,
  validatePlan,
  PLAN_MODEL,
} from "../creation/planning.js";
import {
  coverDefaults,
  coverScene,
  SIGNATURE_STYLE,
} from "../creation/project.js";
import { splitArticle } from "../model.js";
import { imageInput } from "../imageConfig.js";
import { validateSpeechInput } from "../voiceConfig.js";
import { isFresh } from "../services/aiVoice.js";
import Field from "./Field.jsx";
import SceneImageSettings from "./SceneImageSettings.jsx";
export default function CreationStudio({
  project,
  onProject,
  generation,
  ai,
  onVideo,
  onReference,
  initialOpen = false,
}) {
  const [open, setOpen] = useState(initialOpen),
    [draft, setDraft] = useState(project.creationDraft?.plan || null),
    [source, setSource] = useState(project.creationDraft?.source || "local"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmPlan, setConfirmPlan] = useState(false),
    [confirmBatch, setConfirmBatch] = useState(false),
    [allowLostVoice, setAllowLostVoice] = useState(false),
    [progress, setProgress] = useState("");
  const latest = useRef(project),
    lock = useRef(false),
    running = useRef(false),
    mounted = useRef(true),
    context = useRef(""),
    draftBase = useRef(project.creationDraft?.signature || "");
  latest.current = project;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      running.current = false;
    };
  }, []);
  useEffect(() => {
    if (
      !draft ||
      !draftBase.current ||
      draftBase.current !== planningSignature(latest.current)
    )
      return;
    const value = { plan: draft, source, signature: draftBase.current };
    if (JSON.stringify(value) !== JSON.stringify(latest.current.creationDraft))
      onProject({ ...latest.current, creationDraft: value });
  }, [draft, source]);
  function remember(plan, kind) {
    if (!mounted.current) return;
    setDraft(plan);
    setSource(kind);
    onProject(
      {
        ...latest.current,
        creationDraft: { plan, source: kind, signature: draftBase.current },
      },
      { saveNow: true },
    );
  }

  const input = () => {
    const p = latest.current;
    if (!p.english.trim()) throw Error("请先输入英文文章。");
    const scenes = p.scenes.length
      ? p.scenes
      : splitArticle(p.english, p.chinese);
    if (!scenes.length || scenes.length > 30)
      throw Error("智能规划支持1–30镜；长文章请分项目，仍可手动编辑。");
    return { ...p, scenes };
  };
  function local() {
    try {
      const p = input();
      draftBase.current = planningSignature(latest.current);
      remember(localPlan(p), "local");
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  async function plan() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setConfirmPlan(false);
    setError("");
    try {
      const p = input();
      draftBase.current = planningSignature(latest.current);
      const r = await fetch("/api/plan-story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          english: p.english,
          chinese: p.chinese,
          scenes: p.scenes.map(({ english, chinese }) => ({
            english,
            chinese,
          })),
          style: p.style,
          character: {
            name: p.character.name,
            appearance: p.character.appearance,
            clothing: p.character.clothing,
          },
          confirmed: true,
        }),
      });
      let data;
      try {
        data = await r.json();
      } catch {
        throw Error(
          `规划服务响应不可读（HTTP ${r.status}），请检查Preview登录或部署状态。可能已计费，不会自动重试。`,
        );
      }
      if (!r.ok) throw Error(data.error?.message || "规划失败，原项目未改动。");
      const validated = validatePlan(data.plan, p.scenes.length);
      try {
        await writeMedia(await mediaKey("plan", draftBase.current), {
          kind: "plan",
          plan: validated,
        });
      } catch {
        if (mounted.current)
          setError("AI规划已完成，但本机媒体备份失败；请应用后下载JSON。");
      }
      if (!mounted.current) return;
      remember(validated, "ai");
      if (draftBase.current !== planningSignature(latest.current))
        setError(
          "原文已变化，规划草稿已保留但不会覆盖新内容；请审核或重新规划。",
        );
    } catch (e) {
      setError(e.message || "规划请求失败，可能已计费；不会自动重试。");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  function apply() {
    try {
      if (draftBase.current !== planningSignature(latest.current))
        throw Error(
          "规划期间原文或分镜已修改，草稿保留；请重新规划以免覆盖新内容。",
        );
      const p = input();
      const saved = onProject(applyPlan(p, draft, source), { saveNow: true });
      if (saved === false) throw Error("规划保存失败，草稿已保留，未替换正式作品；请先备份JSON并检查浏览器存储。");
      setDraft(null);
      setProgress("规划已应用并保存；请核对内容，再确认付费生成。");
    } catch (e) {
      setError(e.message);
    }
  }
  async function restorePlan() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const p = input(),
        signature = planningSignature(latest.current);
      const value = await readMedia(await mediaKey("plan", signature));
      if (!mounted.current) return;
      if (!value?.plan)
        throw Error("未找到当前内容对应的本机规划备份；可以免费本地规划。");
      if (planningSignature(latest.current) !== signature) throw Error("恢复期间原文已变化，未写入旧规划；请返回原内容后恢复。");
      draftBase.current = signature;
      remember(validatePlan(value.plan, p.scenes.length), "ai");
      setError("已免费恢复规划草稿，请审核后应用。");
    } catch (error) {
      if (mounted.current) setError(error.message);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const missing = (p) => [
    ...(p.cover?.enabled && !p.cover.imageRef ? ["cover-00"] : []),
    ...p.scenes.filter((s) => !s.imageRef).map((s) => s.id),
  ];
  const voiceKeys = (p) =>
    voiceMode(p, ai.assets, ai.speed) === "article"
      ? ["article"]
      : p.scenes.map((s) => s.id);
  const voiceText = (p, k) =>
    k === "article"
      ? p.english
      : p.scenes.find((s) => s.id === k)?.english || "";
  const voiceMissing = (p) =>
    voiceKeys(p).filter(
      (k) => !isFresh(ai.assets[k], voiceText(p, k), ai.speed),
    );
  const lostVoice = (p) =>
    hasMissingVoiceBackup(p, ai.assets, ai.speed, voiceKeys(p));
  async function batch() {
    if (lock.current || generation.busy || generation.pending || ai.busy)
      return;
    lock.current = true;
    running.current = true;
    setBusy(true);
    setConfirmBatch(false);
    setError("");
    const p = latest.current;
    context.current = planningSignature(p);
    try {
      if (p.creationDraft)
        throw Error("请先应用或放弃规划草稿，再确认付费制作。");
      if (lostVoice(p) && !allowLostVoice)
        throw Error("已有配音记录但文件未恢复；请先导入原MP3，避免重复付费。");
      for (const id of missing(p)) {
        const scene =
          id === "cover-00" ? coverScene(p) : p.scenes.find((s) => s.id === id);
        imageInput(id === "cover-00" ? { ...p, ratio: "9:16" } : p, scene);
      }
      for (const key of voiceMissing(p))
        validateSpeechInput(voiceText(p, key), ai.speed);
      let complete = 0;
      const images = missing(p),
        voices = voiceMissing(p),
        total = images.length + voices.length;
      for (const id of images) {
        if (!running.current) break;
        if (planningSignature(latest.current) !== context.current)
          throw Error("内容已修改，已停止后续付费调用；已完成结果保留。");
        setProgress(
          `${++complete}/${total} · 正在生成 ${id === "cover-00" ? "封面00" : `分镜${p.scenes.findIndex((s) => s.id === id) + 1}`}；不会自动重试`,
        );
        const result = await generation.generate(id);
        if (!result || result.failed)
          throw Error(
            result?.error ||
              "图片阶段未完成，已停止后续请求。请查看图片错误，处理后再确认继续。",
          );
        if (result.mediaSaved === false)
          throw Error(
            "结果已生成，但本机媒体备份失败。请先下载文件或JSON，再确认继续；不会重复已完成步骤。",
          );
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (planningSignature(latest.current) !== context.current)
          throw Error(
            "生成期间内容发生变化，旧结果已保留；请审核新内容后再继续，不会自动开始预览。",
          );
      }
      for (const key of voices) {
        if (!running.current) break;
        if (planningSignature(latest.current) !== context.current)
          throw Error("内容已修改，已停止后续付费调用。");
        setProgress(
          `${++complete}/${total} · ElevenLabs ${key === "article" ? "整篇配音" : "单镜配音"}`,
        );
        const result = await ai.generate(key);
        if (!result || result.failed)
          throw Error(
            result?.error ||
              "配音未完成，已停止。请在AI配音页检查错误后确认继续。",
          );
        if (result.mediaSaved === false)
          throw Error(
            "结果已生成，但本机媒体备份失败。请先下载文件或JSON，再确认继续；不会重复已完成步骤。",
          );
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (planningSignature(latest.current) !== context.current)
          throw Error(
            "生成期间内容发生变化，旧结果已保留；请审核新内容后再继续，不会自动开始预览。",
          );
      }
      const finished = running.current;
      setProgress(
        running.current
          ? "生成阶段完成。请下载MP3备份，进入视频页准备/校准时间轴、音乐与最终检查；不会自动导出或调用对齐。"
          : "已停止后续请求；正在处理的单次请求可能已计费，结果仍会保留。",
      );
      if (finished) onVideo(true);
    } catch (e) {
      setError(e.message);
    } finally {
      running.current = false;
      lock.current = false;
      setBusy(false);
    }
  }
  const cover = { ...coverDefaults(), ...project.cover };
  return (
    <section className="note creation-studio" aria-label="AI智能制作工作台">
      <div className="toolbar">
        <button className="primary" onClick={() => setOpen((v) => !v)}>
          AI 智能制作
        </button>
        <span>免费本地规划 / 单次付费AI规划 → 审核 → 确认生成 → 预览导出</span>
      </div>
      {open && (
        <>
          <p>
            本地规划是可编辑的规则草稿，不是AI理解结果。AI智能规划使用{" "}
            {PLAN_MODEL}，一次请求规划全部分镜，可能收费；不会改写中英原文。
          </p>
          <div className="ai-actions">
            <button disabled={busy} onClick={local}>
              免费本地规划
            </button>
            <button disabled={busy} onClick={restorePlan}>
              恢复本机规划备份（免费）
            </button>
            <button disabled={busy} onClick={() => setConfirmPlan(true)}>
              AI 智能规划（付费）
            </button>
          </div>
          {confirmPlan && (
            <section
              className="recovery-panel"
              role="alertdialog"
              aria-label="确认AI规划费用"
            >
              <p>
                将发送文章及分镜，调用OpenAI结构化规划1次。按输入/输出token计费，价格以账户为准；失败或超时也可能计费。免费本地规划无需API。
              </p>
              <button disabled={busy} onClick={plan}>
                确认规划一次
              </button>
              <button onClick={() => setConfirmPlan(false)}>取消规划</button>
            </section>
          )}
          {draft && (
            <section aria-label="统一内容审核">
              <strong>
                {source === "local" ? "本地规则草稿" : "AI规划草稿"} ·
                原文保持不变
              </strong>
              <Field
                label="审核中文标题"
                value={draft.title}
                onChange={(title) => setDraft({ ...draft, title })}
                rows={1}
              />
              <Field
                label="审核英文标题（可空）"
                value={draft.englishTitle}
                onChange={(englishTitle) =>
                  setDraft({ ...draft, englishTitle })
                }
                rows={1}
              />
              {draft.characters.map((c, i) => (
                <div key={i}>
                  {i > 0 && (
                    <button
                      onClick={() =>
                        setDraft({
                          ...draft,
                          characters: draft.characters.filter(
                            (_, n) => n !== i,
                          ),
                        })
                      }
                    >
                      删除人物 {i + 1}
                    </button>
                  )}
                  {["name", "appearance", "clothing"].map((k, j) => (
                    <Field
                      key={k}
                      label={`人物${i + 1} ${["名称", "固定外貌", "固定服装"][j]}`}
                      value={c[k]}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          characters: draft.characters.map((x, n) =>
                            n === i ? { ...x, [k]: value } : x,
                          ),
                        })
                      }
                    />
                  ))}
                </div>
              ))}
              <button
                disabled={draft.characters.length >= 8}
                onClick={() =>
                  setDraft({
                    ...draft,
                    characters: [
                      ...draft.characters,
                      { name: "", appearance: "", clothing: "" },
                    ],
                  })
                }
              >
                添加人物（最多8位，填写完整后应用）
              </button>
              <label className="field">
                审核统一画风
                <select
                  value={
                    STYLE_OPTIONS.includes(draft.style)
                      ? draft.style
                      : project.style
                  }
                  onChange={(e) =>
                    setDraft({ ...draft, style: e.target.value })
                  }
                >
                  {STYLE_OPTIONS.map((style) => (
                    <option key={style}>{style}</option>
                  ))}
                </select>
              </label>
              <p>
                统一画风：
                {STYLE_OPTIONS.includes(draft.style)
                  ? draft.style
                  : project.style}
                ；{draft.mood} · 推荐音乐类型：
                {draft.musicRecommendation}
              </p>
              <Field
                label="封面英文图片提示词"
                value={draft.coverPrompt}
                onChange={(coverPrompt) => setDraft({ ...draft, coverPrompt })}
              />
              {draft.beats.map((b, i) => (
                <details key={i}>
                  <summary>
                    分镜 {i + 1} · 场景 / 动作 / 镜头 / 英文提示词
                  </summary>
                  {["scene", "action", "expression", "camera", "prompt"].map(
                    (k, j) => (
                      <Field
                        key={k}
                        label={`第${i + 1}镜 ${["场景", "动作", "表情", "镜头构图", "英文图片提示词"][j]}`}
                        value={b[k]}
                        onChange={(value) =>
                          setDraft({
                            ...draft,
                            beats: draft.beats.map((x, n) =>
                              i === n ? { ...x, [k]: value } : x,
                            ),
                          })
                        }
                      />
                    ),
                  )}
                </details>
              ))}
              <button disabled={busy} onClick={apply}>
                确认内容并应用规划（免费）
              </button>
              <button
                onClick={() => {
                  setDraft(null);
                  onProject({ ...latest.current, creationDraft: undefined });
                }}
              >
                放弃草稿
              </button>
            </section>
          )}
          <details>
            <summary>封面 00 · 标题与独立插画</summary>
            <label>
              <input
                type="checkbox"
                checked={cover.enabled}
                onChange={(e) =>
                  onProject({
                    ...project,
                    cover: { ...cover, enabled: e.target.checked },
                  })
                }
              />
              启用独立封面
            </label>
            <Field
              label="封面中文大标题"
              value={cover.title}
              onChange={(title) =>
                onProject({ ...project, cover: { ...cover, title } })
              }
              rows={1}
            />
            <Field
              label="封面英文小标题"
              value={cover.englishTitle}
              onChange={(englishTitle) =>
                onProject({ ...project, cover: { ...cover, englishTitle } })
              }
              rows={1}
            />
            <Field
              label="封面图片提示词"
              value={cover.prompt}
              onChange={(prompt) =>
                onProject({ ...project, cover: { ...cover, prompt } })
              }
            />
            <label className="field">
              封面时长（1–10秒）
              <input
                type="number"
                min="1"
                max="10"
                step=".1"
                value={cover.duration}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 1 && n <= 10)
                    onProject({ ...project, cover: { ...cover, duration: n } });
                }}
              />
            </label>
            <SceneImageSettings
              scene={coverScene({ ...project, cover })}
              project={{ ...project, ratio: "9:16" }}
              generation={generation}
              onSetStandard={onReference}
              onChange={(patch) =>
                onProject({ ...project, cover: { ...cover, ...patch } })
              }
            />
            <p>
              标题由网页/渲染器绘制，不让图片模型写字。封面不朗读，单独计入视频时长。
            </p>
          </details>
          <div className="ai-actions">
            <button
              disabled={
                busy ||
                !!generation.busy ||
                !!generation.pending ||
                !!ai.busy ||
                !!draft ||
                !project.scenes.length
              }
              onClick={async () => {
                if (lock.current) return;
                lock.current = true;
                setBusy(true);
                setAllowLostVoice(false);
                setError("");
                try {
                  const restored =
                    ((await generation.restoreMissing?.()) || 0) +
                    ((await ai.restoreCached?.()) || 0);
                  await new Promise((resolve) => setTimeout(resolve, 0));
                  if (restored)
                    setProgress(
                      `已从本机媒体备份恢复${restored}项，不调用付费API。`,
                    );
                  setConfirmBatch(true);
                } catch (error) {
                  setError(error.message);
                } finally {
                  lock.current = false;
                  setBusy(false);
                }
              }}
            >
              审核并继续未完成的生成
            </button>
            <button onClick={onVideo}>进入字幕、音乐与视频预览</button>
            {busy && (
              <button
                onClick={() => {
                  running.current = false;
                  setProgress("将于当前请求完成后停止，不会自动追加请求。");
                }}
              >
                停止后续生成
              </button>
            )}
          </div>
          {confirmBatch && (
            <section
              role="alertdialog"
              className="recovery-panel"
              aria-label="确认批量制作费用"
            >
              <p>
                英文共 {project.english.trim().length} 字符，目标语速 {ai.speed}
                。本次最多生成缺失图片 {missing(project).length}{" "}
                张（含启用的封面），有效音频未完成请求{" "}
                {voiceMissing(project).length}{" "}
                次。已有图片不会覆盖，当前语速有效的音频会跳过。OpenAI图片按token、ElevenLabs按账户规则计费，无法在未调用前提供精确金额。参考图可能增加输入费用。失败立即停止，不自动重试；刷新后MP3不在JSON，需要重新导入，不能假装音频已恢复。
              </p>
              {lostVoice(project) && (
                <label>
                  <input
                    type="checkbox"
                    checked={allowLostVoice}
                    onChange={(e) => setAllowLostVoice(e.target.checked)}
                  />
                  已有生成记录，但MP3文件未恢复。我已核查，仍明确同意重新生成并可能再次计费；也可取消并导入原MP3。
                </label>
              )}
              <button
                disabled={
                  (lostVoice(project) && !allowLostVoice) ||
                  busy ||
                  !!generation.busy ||
                  !!ai.busy ||
                  !!generation.pending
                }
                onClick={batch}
              >
                确认本次预计请求并开始
              </button>
              <button onClick={() => setConfirmBatch(false)}>取消制作</button>
            </section>
          )}
          <p role="status">{progress}</p>
          {error && (
            <p role="alert" className="validation-error">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
