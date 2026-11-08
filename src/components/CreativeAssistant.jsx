import {mediaKey,readMedia,writeMedia} from "../creation/mediaStore.js";
import React, { useEffect, useRef, useState } from "react";
import Field from "./Field.jsx";
import CreationStudio from "./CreationStudio.jsx";
import { TEMPLATES, cleanAssistant, cleanContent, cleanTopics, adoptContent } from "../assistant/model.js";
import { downloadProject, PROJECT_FILE_BYTES_LIMIT } from "../model.js";
const defaults = () => ({ request: "", template: TEMPLATES[0], mode: "full" });
function CreativeAssistant({ project, onProject, generation, ai, onVideo, onReference }) {
  const [draft, setDraft] = useState(project.assistant || defaults()), [error, setError] = useState(""), [busy, setBusy] = useState(false), [pending, setPending] = useState(null), [replace, setReplace] = useState(false), [ready, setReady] = useState(project.assistant?.adopted === true);
  const lock = useRef(false), alive = useRef(true), latest = useRef(project), current = useRef(draft);
  latest.current = project;
  current.current = draft;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function save(next) {
    setDraft(next);
    current.current = next;
    setReplace(false);
    setReady(false);
    try {
      const cleaned = cleanAssistant(next);
      if (onProject({ ...latest.current, assistant: cleaned }, { saveNow: true }) === false) throw Error("浏览器保存失败。请保留页面并导出JSON；不要刷新。");
      setError("");
      return true;
    } catch (e) {
      setError(`当前编辑尚未保存：${e.message}`);
      return false;
    }
  }
  async function run() {
    if (lock.current || !pending) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const job = pending, base = latest.current, snapshot = current.current;
    setPending(null);
    try {
      const response = await fetch("/api/creative-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true, context: {english:base.english,chinese:base.chinese}, mode: job.mode, request: snapshot.request, template: snapshot.template, ...job.mode === "rewrite" ? { pair: snapshot.content.pairs[job.index] } : {} }) });
      const data = await response.json();
      if (!response.ok) {
        const failure=Error(data.error?.message || "创作失败，请先检查用量。");
        failure.safeResponse=true;
        throw failure;
      }
      let next;
      if (job.mode === "topics") next=cleanAssistant({...snapshot,topics:cleanTopics({topics:data.topics})});
      else if (job.mode === "content" || job.mode === "article") next=cleanAssistant({...snapshot,content:cleanContent(data.content)});
      else {
        const content=cleanContent(snapshot.content);
        content.pairs[job.index]=data.pair;
        refreshBeat(content,job.index);
        next=cleanAssistant({...snapshot,content});
      }
      let backupWarning="";
      try {await writeMedia(await mediaKey("assistant",JSON.stringify([snapshot.request,snapshot.template,base.english,base.chinese])),next);}
      catch {backupWarning="本机额外恢复备份失败；请立即使用‘备份当前草稿JSON’，不要刷新。";}
      if (!alive.current) return;
      if (latest.current !== base || current.current !== snapshot) throw Error("请求期间项目或草稿已改变，未覆盖当前内容。可返回原需求，免费恢复已收到的结果。");
      if(save(next) && backupWarning) setError(backupWarning);
    } catch (e) {
      if (alive.current) setError(e.safeResponse ? e.message : `${e.message || "创作失败"} 若请求已发送，可能已计费；请先检查API用量，不会自动重试。`);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function restore() {
    if(lock.current) return;
    lock.current=true;setBusy(true);const snapshot=current.current,base=latest.current;
    try {
      const saved=await readMedia(await mediaKey("assistant",JSON.stringify([snapshot.request,snapshot.template,base.english,base.chinese])));
      if(!alive.current)return;
      if(current.current!==snapshot||latest.current!==base)throw Error("项目已变化，请重新恢复。");
      if(!saved)throw Error("当前需求与模板没有本机备份；不同Preview网址不共享浏览器数据。");
      save(cleanAssistant(saved));
    }catch(e){if(alive.current)setError(e.message);}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  function refreshBeat(content, i) {
    const pair = content.pairs[i], old = content.plan.beats[i];
    content.plan.beats[i] = { ...old, scene: (pair.chinese || pair.english).slice(0, 1e3), action: pair.english.slice(0, 1e3), prompt: `Vertical 9:16 picturebook. Depict: ${pair.english}. Fixed characters: ${JSON.stringify(content.plan.characters).slice(0, 1400)}. Style: ${content.plan.style}. ${old.camera}. No text, no watermark.`.slice(0, 3e3) };
  }
  function editPair(i, key, value) {
    const content = structuredClone(draft.content);
    content.pairs[i][key] = value;
    refreshBeat(content, i);
    save({ ...draft, content });
  }
  function adopt() {
    if (!replace || lock.current) return;
    try {
      downloadProject(latest.current, { maxBytes: PROJECT_FILE_BYTES_LIMIT });
      const next = adoptContent({ ...latest.current, assistant: cleanAssistant(draft) }, draft.content);
      if (onProject(next, { saveNow: true }) === false) throw Error("保存失败，正式作品未替换。请检查浏览器存储。");
      setReady(true);
      setReplace(false);
      setError("");
      setDraft(next.assistant);
    } catch (e) {
      setError(e.message);
    }
  }
  return <section className="creation-studio">
    <div className="intro"><h2>AI 智能创作工作台</h2><p>从话题到双语文章，再进入现有视频制作流程。API按使用计费，ChatGPT Plus不包含API额度。</p></div>
    <label className="field"><span>创作模式</span><select aria-label="创作模式" value={draft.mode || "full"} disabled={busy} onChange={(e)=>save({...draft,mode:e.target.value})}><option value="topics">A. 话题策划</option><option value="article">B. 文章生成</option><option value="full">C. 一键完整创作</option></select></label>
    <label className="field"><span>创作模板</span><select aria-label="创作模板" value={draft.template} disabled={busy} onChange={(e) => save({ ...draft, template: e.target.value })}>{TEMPLATES.map((t) => <option key={t}>{t}</option>)}</select></label>
    <Field label="告诉助手你想做什么" value={draft.request} maxLength={6e3} disabled={busy} placeholder="例如：帮我写一篇关于自律的英语跟读文章；或粘贴已有文章并说明制作要求。" onChange={(request) => save({ ...draft, request })} />
    <p>模式 A：话题策划 · 模式 B：文章生成 · 模式 C：一键完整创作（文章与全部分镜规划一次生成，审核后再付费制作媒体）。</p>
    <div className="actions"><button disabled={busy || !draft.request.trim()} onClick={() => setPending({ mode: "topics" })}>生成话题</button><button disabled={busy || !draft.request.trim()} onClick={() => setPending({ mode: draft.mode === "article" ? "article" : "content" })}>生成完整内容</button><button disabled={busy || !draft.content} onClick={() => {
    setReplace(true);
    setReady(false);
  }}>制作视频</button></div>
    <div className="ai-actions"><button disabled={busy} onClick={restore}>恢复上次创作结果（免费）</button><button disabled={busy} onClick={() => {
    try {
      downloadProject({ ...project, assistant: cleanAssistant(draft) }, { maxBytes: PROJECT_FILE_BYTES_LIMIT });
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }}>备份当前草稿JSON</button>{project.assistant?.adopted && <button disabled={busy} onClick={() => setReady(true)}>继续当前项目制作</button>}</div>
    {busy && <p role="status">正在创作，请勿重复提交。离开此页不会自动发起后续请求。</p>}
    {error && <p role="alert" className="notice">{error}</p>}
    {pending && <div className="notice" role="region" aria-label="创作费用确认"><p>本次将发送 1 次 OpenAI 文本请求，模型 gpt-5-mini。费用由实际输入和输出决定，请先确认API Billing与Limits。不包含图片、配音或Render任务；不会自动重试。</p><p>如果替换草稿，现有正式文章与媒体不会改变。</p><button disabled={busy} onClick={run}>确认一次付费创作</button><button onClick={() => setPending(null)}>取消</button></div>}
    {draft.topics && <div><h3>10 个候选话题</h3>{draft.topics.map((t, i) => <article className="notice" key={i}><h4>{t.title}</h4><p>{t.englishTitle}</p><p>方向：{t.direction}</p><p>推荐：{t.reason}</p><p>开头：{t.hook}</p><button disabled={busy} onClick={() => save({ ...draft, mode:"article", request: `请根据以下话题创作完整双语文章与绘本视频规划：${t.title}。${t.direction}。开头建议：${t.hook}` })}>选择此话题写文章</button></article>)}</div>}
    {draft.content && <div><h3>双语文章审核</h3><p>朗读时长仅是写作目标，实际时长以生成或上传的音频为准。编辑或局部改写仅修改选中一组，并免费更新该镜头的规则提示词；采用后可逐镜精修。</p><Field label="中文标题" maxLength={120} value={draft.content.plan.title} disabled={busy} onChange={(title) => save({ ...draft, content: { ...draft.content, plan: { ...draft.content.plan, title } } })} /><Field label="英文标题（可选）" maxLength={120} value={draft.content.plan.englishTitle} disabled={busy} onChange={(englishTitle) => save({ ...draft, content: { ...draft.content, plan: { ...draft.content.plan, englishTitle } } })} />{draft.content.pairs.map((p, i) => <div className="notice" key={i}><strong>分镜 {String(i + 1).padStart(2, "0")}</strong><Field label={`英文 ${i + 1}`} value={p.english} disabled={busy} maxLength={1e3} onChange={(v) => editPair(i, "english", v)} /><Field label={`中文 ${i + 1}`} value={p.chinese} disabled={busy} maxLength={1e3} onChange={(v) => editPair(i, "chinese", v)} /><button disabled={busy || !draft.request.trim()} onClick={() => setPending({ mode: "rewrite", index: i })}>仅改写这一组</button></div>)}</div>}
    {replace && <div className="notice"><p>采用后将替换正式文章、分镜和封面规划，旧音频时间轴不会沿用。先下载当前项目JSON备份（原始MP3与音乐仍需单独保留），再进入原有制作工作流。新图片与配音尚未生成。</p><button onClick={adopt}>备份原项目并确认采用</button><button onClick={() => setReplace(false)}>返回编辑</button></div>}
    {ready && <><p role="status">内容已采用并保存。请审核下面的角色、画风与提示词，再确认图片和配音费用。</p><CreationStudio project={project} onProject={onProject} generation={generation} ai={ai} onVideo={onVideo} onReference={onReference} /></>}
  </section>;
}
export {
  CreativeAssistant as default
};
