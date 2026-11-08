import CreativeAssistant from "./components/CreativeAssistant.jsx";
import { voiceMode, appendVoiceRecord } from "./creation/voiceRecovery.js";
import CreationStudio from "./components/CreationStudio.jsx";
import { SIGNATURE_STYLE } from "./creation/project.js";
import { verifyProjectImages } from "./services/images.js";
import React, { useState, useEffect, useRef } from "react";
import {
  BookOpen,
  Clapperboard,
  Users,
  AudioLines,
  Download,
  Upload,
  Save,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  ChevronRight,
  Film,
  Check,
  Volume2,
} from "lucide-react";
import {
  initialProject,
  splitArticle,
  parseProject,
  downloadProject,
  uid,
  downloadText,
  textError,
  TITLE_LIMIT,
  PROJECT_BYTES_LIMIT,
  PROJECT_FILE_BYTES_LIMIT,
} from "./model.js";
import { browserVoiceProvider as voice } from "./services/providers.js";
import Preview from "./components/Preview.jsx";
import Field from "./components/Field.jsx";
import VideoStudioPanel from "./components/VideoStudioPanel.jsx";
import ServiceStatus from "./components/ServiceStatus.jsx";
import CharacterReference from "./components/CharacterReference.jsx";
import useImageGeneration from "./hooks/useImageGeneration.js";
import TemplateSettings from "./components/TemplateSettings.jsx";
import SceneImageSettings from "./components/SceneImageSettings.jsx";
import AIVoicePanel from "./components/AIVoicePanel.jsx";
import useVoiceStudio from "./hooks/useVoiceStudio.js";
import { isFresh } from "./services/aiVoice.js";
import {
  loadProject,
  saveProject,
  scheduleProjectSave,
} from "./services/projectStorage.js";
const tabs = [
  ["article", "文章编辑", BookOpen],
  ["scenes", "故事分镜", Clapperboard],
  ["characters", "角色与画风", Users],
  ["audio", "配音与字幕", AudioLines],
  ["ai", "AI 配音", Sparkles],
  ["video", "视频预览与导出", Film],
  ["assistant", "AI 创作助手", Sparkles],
];
function load() {
  let result;
  try {
    result = loadProject(window.localStorage);
  } catch {
    result = {
      project: null,
      recovery: true,
      raw: null,
      error: "无法访问本地存储。请检查浏览器权限，或导入 JSON 备份。",
    };
  }
  if (result.project || result.recovery) return result;
  const project = initialProject();
  project.scenes = splitArticle(project.english, project.chinese);
  return { ...result, project };
}
const startup = load();

export default function App() {
  const [p, setP] = useState(startup.project || initialProject()),
    [tab, setTab] = useState("article"),
    [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [message, setMessage] = useState(""),
    [voices, setVoices] = useState([]),
    [voiceName, setVoiceName] = useState("");
  const [lastSavedProject, setLastSavedProject] = useState(p);
  const [saveStatus, setSaveStatus] = useState("");
  const [recovery, setRecovery] = useState(startup.recovery ? startup : null);
  const [backups, setBackups] = useState(startup.backups || []);
  const [blocked, setBlocked] = useState(
    !!startup.recovery && !startup.project,
  );
  const [videoEpoch, setVideoEpoch] = useState(0);
  const [autoPrepareRequest, setAutoPrepareRequest] = useState(null);
  function commitCreationProject(next, options = {}) {
    if (blocked || recovery) {
      setMessage("请先处理原存档恢复，再使用智能制作；原始内容未覆盖。");
      return false;
    }
    if (!options.saveNow) {
      setP(next);
      return true;
    }
    try {
      const result = saveProject(localStorage, next);
      setP(next);
      setLastSavedProject(next);
      setBackups(result.backups);
      setSaveStatus("创作内容已保存到当前网址；原始音频仍需单独备份。");
      return true;
    } catch (error) {
      setSaveStatus(
        `规划保存失败：${error.message} 请先导出JSON；原存档未覆盖。`,
      );
      return false;
    }
  }
  const videoPause = useRef(null),
    videoTransport = useRef(null);
  const [videoPlayback, setVideoPlayback] = useState({
    ready: false,
    playing: false,
  });
  const [videoFrame, setVideoFrame] = useState(null);
  const ai = useVoiceStudio(p, {
    onAssetCreated: (record) =>
      setP((prev) => ({
        ...prev,
        voiceRecords: appendVoiceRecord(prev.voiceRecords || [], record, prev),
      })),
    onStart: () => {
      videoPause.current?.();
      setPlaying(false);
      voice.stop();
    },
    onFrame: setIndex,
    onSpeedChange: (aiSpeed) => setP((prev) => ({ ...prev, aiSpeed })),
  });
  const imageGeneration = useImageGeneration(p, (id, imageRef) =>
    setP((prev) => ({
      ...prev,
      ...(id === "cover-00"
        ? {
            cover: {
              ...prev.cover,
              imageRef,
              imageFit: "contain",
              imageScale: 1,
              imagePosition: { x: 50, y: 50 },
            },
          }
        : {}),
      scenes: prev.scenes.map((scene) =>
        scene.id === id
          ? {
              ...scene,
              imageRef,
              imageFit: "contain",
              imageScale: 1,
              imagePosition: { x: 50, y: 50 },
            }
          : scene,
      ),
    })),
  );
  const editCharacter = (key, value) =>
    setP((prev) => ({
      ...prev,
      character: { ...prev.character, [key]: value },
      ...(prev.creation
        ? {
            creation: {
              ...prev.creation,
              characters: prev.creation.characters.map((c, i) =>
                i === 0 ? { ...c, [key]: value } : c,
              ),
            },
          }
        : {}),
    }));
  const setCharacterReference = (referenceImage) =>
    setP((prev) => ({
      ...prev,
      character: { ...prev.character, referenceImage },
    }));
  const previewProject = {
    ...p,
    scenes: p.scenes.map((scene, i) => {
      const clip = ai.assets[scene.id];
      const range =
        ai.selected === "article" && isFresh(ai.current, p.english, ai.speed)
          ? ai.timeline.ranges.find((r) => r.index === i)
          : null;
      return {
        ...scene,
        duration: range
          ? range.end - range.start
          : isFresh(clip, scene.english, ai.speed) && clip.duration
            ? clip.duration
            : scene.duration,
      };
    }),
  };
  const frameDuration = previewProject.scenes[index]?.duration;
  const input = useRef(null),
    projectImportEpoch = useRef(0);
  const [importingProject, setImportingProject] = useState(false);
  useEffect(
    () => () => {
      projectImportEpoch.current++;
    },
    [],
  );
  const update = (patch) => setP((prev) => ({ ...prev, ...patch }));
  const stop = () => {
    setPlaying(false);
    voice.stop();
    ai.pause();
    videoPause.current?.();
  };
  useEffect(() => {
    if (!voice.available()) return;
    const refresh = () =>
      setVoices(
        window.speechSynthesis
          .getVoices()
          .filter((v) => v.lang.toLowerCase().startsWith("en")),
      );
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => {
      voice.stop();
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
    };
  }, []);
  useEffect(() => {
    if (index >= p.scenes.length) setIndex(Math.max(0, p.scenes.length - 1));
  }, [p.scenes.length, index]);
  useEffect(() => {
    if (!playing || !p.scenes[index]) return;
    const t = setTimeout(() => {
      if (index < p.scenes.length - 1) setIndex(index + 1);
      else setPlaying(false);
    }, frameDuration * 1000);
    return () => clearTimeout(t);
  }, [playing, index, p.scenes, frameDuration]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 6500);
    return () => clearTimeout(t);
  }, [message]);
  function save() {
    try {
      const result = saveProject(localStorage, p);
      setLastSavedProject(p);
      setSaveStatus("已保存到当前网址；MP3 需单独备份。");
      setBackups(result.backups);
      setRecovery(null);
      setMessage(
        result.archived
          ? "项目已保存；原无效存档已保留在恢复备份中，可随时下载。"
          : "项目已保存到当前网址的浏览器，包含提示词与图片；MP3 仅在当前页面，需单独备份。请定期导出 JSON。",
      );
    } catch (err) {
      setMessage(`保存失败：${err.message} 当前编辑内容和原有存档均已保留。`);
    }
  }
  useEffect(() => {
    if (blocked || recovery || p === lastSavedProject) return;
    setSaveStatus("正在自动保存到当前网址…");
    return scheduleProjectSave(() => window.localStorage, p, {
      onSaved(result) {
        setLastSavedProject(p);
        setBackups(result.backups);
        setSaveStatus("已自动保存到当前网址；MP3 需单独备份。");
      },
      onError(error) {
        setSaveStatus(
          `自动保存失败：${error.message} 当前修改仍在页面内，请先导出 JSON；原存档未覆盖。`,
        );
      },
    });
  }, [p, lastSavedProject, blocked, recovery]);
  useEffect(() => {
    if (
      p === lastSavedProject &&
      !videoPlayback.rendering &&
      !videoPlayback.pendingDownload &&
      !videoPlayback.timingDraftDirty
    )
      return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [
    p,
    lastSavedProject,
    videoPlayback.rendering,
    videoPlayback.pendingDownload,
    videoPlayback.timingDraftDirty,
  ]);
  function exportProject() {
    try {
      downloadProject(p, { maxBytes: PROJECT_FILE_BYTES_LIMIT });
    } catch (err) {
      setMessage(`导出失败：${err.message} 当前内容未被修改。`);
    }
  }

  function split() {
    if (
      p.scenes.length &&
      !window.confirm(
        "重新拆分会替换当前分镜、画面提示词及图片，并使原时间轴失效。请先导出 JSON 备份。是否继续？",
      )
    )
      return;
    stop();
    const scenes = splitArticle(p.english, p.chinese);
    if (scenes.length > 500) {
      setMessage("最多支持 500 个分镜，请缩短文章。");
      return;
    }
    update({ scenes });
    setIndex(0);
    setTab("scenes");
    setMessage(
      `已生成 ${scenes.length} 个分镜；中英文按句序配对，请检查对应关系。`,
    );
  }
  const editVisualScene = (id, patch) =>
    setP((prev) => ({
      ...prev,
      scenes: prev.scenes.map((scene) =>
        scene.id === id ? { ...scene, ...patch } : scene,
      ),
    }));
  const editScene = (id, patch) => {
    stop();
    update({
      scenes: p.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  };
  function move(i, delta) {
    stop();
    const scenes = [...p.scenes];
    [scenes[i], scenes[i + delta]] = [scenes[i + delta], scenes[i]];
    update({ scenes });
    setIndex(i + delta);
  }
  async function importFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const epoch = ++projectImportEpoch.current;
    setImportingProject(true);
    try {
      if (file.size > PROJECT_FILE_BYTES_LIMIT)
        throw Error(
          "项目文件超过 50 MB，原工作区未修改。请保留原图并减小副本。",
        );
      const project = parseProject(await file.text(), {
        maxBytes: PROJECT_FILE_BYTES_LIMIT,
      });
      if (epoch !== projectImportEpoch.current) return;
      if (
        !(await verifyProjectImages(project, {
          isCurrent: () => epoch === projectImportEpoch.current,
        }))
      )
        return;
      if (!window.confirm("导入将替换当前工作区，未保存内容会丢失。是否继续？"))
        return;
      stop();
      ai.reset();
      setVideoEpoch((v) => v + 1);
      imageGeneration.reset();
      setP(project);
      setBlocked(false);
      setIndex(0);
      setMessage(
        file.size > PROJECT_BYTES_LIMIT
          ? "已导入大项目；超过浏览器 5 MB 限额，请用导出 JSON 文件保存最新修改，刷新前务必备份，MP3 请另存。"
          : "导入成功，点击保存可存入当前浏览器。",
      );
    } catch (err) {
      if (epoch === projectImportEpoch.current)
        setMessage(`导入失败：${err.message}`);
    } finally {
      if (epoch === projectImportEpoch.current) setImportingProject(false);
    }
  }
  function speak(s) {
    stop();
    if (!s.english.trim()) {
      setMessage("请先填写英文句子。");
      return;
    }
    voice.speak({
      text: s.english,
      rate: p.rate,
      voice: voices.find((v) => v.voiceURI === voiceName),
      onError: setMessage,
    });
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#">
          <span className="brand-icon">
            <Film size={24} />
          </span>
          <span>
            STORY<span className="brand-light">STUDIO</span>
          </span>
        </a>
        <div className="workspace-label">
          创作工作台 <span>V4.1</span>
        </div>
        <nav>
          {tabs.map(([id, label, Icon], i) => (
            <button
              key={id}
              aria-label={label}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              <small>0{i + 1}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-dot" />
          本地创作，安心保存<p>你的故事，从一句话开始。</p>
          <span>AI Story Video Studio</span>
        </div>
      </aside>
      <div className="main-shell">
        <header>
          <div className="breadcrumb">
            我的工作室 <ChevronRight size={14} />
            <span>新建故事项目</span>
          </div>
          <div className="header-actions">
            <button
              disabled={importingProject}
              onClick={() => input.current.click()}
            >
              <Upload size={16} />
              <span>{importingProject ? "读取项目中…" : "导入项目"}</span>
            </button>
            <button onClick={exportProject} disabled={blocked}>
              <Download size={16} />
              <span>导出 JSON</span>
            </button>
            {saveStatus && (
              <span className="muted" role="status">
                {saveStatus}
              </span>
            )}
            {p !== lastSavedProject && (
              <span className="muted" role="status">
                有未保存更改
              </span>
            )}
            <button className="primary" onClick={save} disabled={blocked}>
              <Save size={16} />
              保存项目
            </button>
            <input
              ref={input}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={importFile}
            />
          </div>
        </header>
        {(recovery || backups.length > 0 || startup.backupError) && (
          <section className="recovery-panel" aria-label="存档恢复">
            {recovery && (
              <>
                <strong>原存档需要恢复，未被覆盖</strong>
                <p>{recovery.error}</p>
                <p>
                  {blocked
                    ? "无法安全打开此存档。请先下载原始数据，再导入有效的 JSON 项目；不会自动用示例替换。"
                    : recovery.project
                      ? "原始文本已完整载入。请缩短标红字段后重新保存；原存档会先备份，备份失败则停止保存。"
                      : "当前显示的是导入项目，原无效存档仍保留。保存时会先备份原存档，备份失败则停止保存。"}
                </p>
                {recovery.raw !== null && (
                  <button
                    onClick={() =>
                      downloadText(recovery.raw, "story-original-recovery.json")
                    }
                  >
                    下载原始存档（保留全部内容）
                  </button>
                )}
              </>
            )}
            {startup.backupError && <p role="alert">{startup.backupError}</p>}
            {backups.map((raw, i) => (
              <button
                key={i}
                onClick={() =>
                  downloadText(raw, `story-recovery-${i + 1}.json`)
                }
              >
                下载恢复备份 {i + 1}
              </button>
            ))}
          </section>
        )}
        {!blocked && (
          <>
            <div className="project-heading">
              <div>
                <div className="eyebrow">YOUR NEXT STORY STARTS HERE</div>
                <input
                  aria-label="项目名称"
                  className="title-input"
                  aria-invalid={!!textError(p.title, "项目名称", TITLE_LIMIT)}
                  value={p.title}
                  onChange={(e) => update({ title: e.target.value })}
                />
                {textError(p.title, "项目名称", TITLE_LIMIT) && (
                  <p className="validation-error" role="alert">
                    {textError(p.title, "项目名称", TITLE_LIMIT)}
                  </p>
                )}
                <p>把灵感写成故事，把故事变成画面。</p>
              </div>
              <span className="project-status">
                <span />
                本地项目
              </span>
            </div>
            <div className="studio-grid">
              <main className="editor">
                <div className="editor-title">
                  <div>
                    <span className="step-number">
                      0{tabs.findIndex((x) => x[0] === tab) + 1}
                    </span>
                    <h1>{tabs.find((x) => x[0] === tab)[1]}</h1>
                  </div>
                  <span className="muted">
                    {p.scenes.length} 个分镜 ·{" "}
                    {previewProject.scenes
                      .reduce((a, s) => a + s.duration, 0)
                      .toFixed(1)}{" "}
                    秒
                  </span>
                </div>
                <VideoStudioPanel
                  key={videoEpoch}
                  pauseRef={videoPause}
                  transportRef={videoTransport}
                  onPlaybackChange={setVideoPlayback}
                  onPreviewFrame={setVideoFrame}
                  project={p}
                  ai={ai}
                  hidden={tab !== "video"}
                  onStart={stop}
                  onFrame={setIndex}
                  autoPrepareRequest={autoPrepareRequest}
                  onProjectChange={update}
                  onTimingChange={(videoTiming) => update({ videoTiming })}
                />
                {tab === "ai" && <ServiceStatus />}
                <AIVoicePanel project={p} studio={ai} hidden={tab !== "ai"} />
                {tab === "assistant" && (
                  !blocked && !recovery ? (
                    <CreativeAssistant
                      key={videoEpoch}
                      project={p}
                      onProject={commitCreationProject}
                      generation={imageGeneration}
                      ai={ai}
                      onReference={setCharacterReference}
                      onVideo={(prepare) => {
                        setTab("video");
                        if (prepare === true)
                          setAutoPrepareRequest({
                            id: Date.now(),
                            source: voiceMode(p, ai.assets, ai.speed),
                          });
                      }}
                    />
                  ) : (
                    <p role="status">请先处理原项目恢复，再使用创作助手。</p>
                  )
                )}
                {tab === "article" && (
                  <>
                    {!blocked && !recovery && (
                      <CreationStudio
                        project={p}
                        key={videoEpoch}
                        onProject={commitCreationProject}
                        generation={imageGeneration}
                        ai={ai}
                        onVideo={(prepare) => {
                          setTab("video");
                          if (prepare === true)
                            setAutoPrepareRequest({
                              id: Date.now(),
                              source:
                                isFresh(
                                  ai.assets.article,
                                  p.english,
                                  ai.speed,
                                ) || p.english.trim().length <= 5000
                                  ? "article"
                                  : "scenes",
                            });
                        }}
                        onReference={setCharacterReference}
                      />
                    )}
                    {(blocked || recovery) && (
                      <p role="status">
                        请先修复或导入原项目并保存，再使用智能制作；恢复模式不会自动覆盖原存档。
                      </p>
                    )}
                    <div className="intro">
                      <span className="intro-icon">
                        <BookOpen size={22} />
                      </span>
                      <div>
                        <strong>好故事，从文字开始</strong>
                        <p>粘贴英文故事，添加中文译文，一键拆分为分镜。</p>
                      </div>
                    </div>
                    <Field
                      label={
                        <>
                          英文文章 <em>ENGLISH</em>
                        </>
                      }
                      value={p.english}
                      onChange={(english) => update({ english })}
                      rows={9}
                      placeholder="在这里写下你的英文故事…"
                    />
                    <div className="word-count">
                      {p.english.trim().split(/\s+/).filter(Boolean).length}{" "}
                      个英文词
                    </div>
                    <Field
                      label={
                        <>
                          中文译文 <em>可选</em>
                        </>
                      }
                      value={p.chinese}
                      onChange={(chinese) => update({ chinese })}
                      rows={6}
                      placeholder="输入对应中文译文；本版本不自动翻译。"
                    />
                    <div className="tip">
                      中英文按句序配对。建议每句英文对应一句中文，拆分后可单独调整。
                    </div>
                    <div className="editor-footer">
                      <button
                        className="text-button"
                        onClick={() => {
                          if (
                            window.confirm(
                              "清空英文文章和中文译文？已生成的分镜会保留。",
                            )
                          )
                            update({ english: "", chinese: "" });
                        }}
                      >
                        <Trash2 size={16} />
                        清空文章
                      </button>
                      <button
                        className="primary"
                        disabled={!p.english.trim() && !p.chinese.trim()}
                        onClick={split}
                      >
                        <Sparkles size={17} />
                        自动拆分分镜
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </>
                )}
                {tab === "scenes" && (
                  <>
                    <div className="toolbar">
                      <span className="muted">编辑每一幕，让故事更生动</span>
                      <button
                        disabled={p.scenes.length >= 500}
                        onClick={() => {
                          stop();
                          update({
                            scenes: [
                              ...p.scenes,
                              {
                                id: uid(),
                                english: "",
                                chinese: "",
                                description: "",
                                duration: 5,
                              },
                            ],
                          });
                          setIndex(p.scenes.length);
                        }}
                      >
                        <Plus size={16} />
                        添加分镜
                      </button>
                    </div>
                    {!p.scenes.length && (
                      <div className="empty">
                        还没有分镜。从文章拆分或手动添加第一幕。
                      </div>
                    )}
                    {p.scenes.map((s, i) => (
                      <section
                        className={`scene-card ${index === i ? "selected" : ""}`}
                        key={s.id}
                      >
                        <div className="scene-head">
                          <button
                            onClick={() => {
                              stop();
                              setIndex(i);
                            }}
                          >
                            <Clapperboard size={16} />
                            分镜 {String(i + 1).padStart(2, "0")}
                          </button>
                          <div>
                            <button
                              aria-label={`上移分镜 ${i + 1}`}
                              disabled={i === 0}
                              onClick={() => move(i, -1)}
                            >
                              <ArrowUp size={16} />
                            </button>
                            <button
                              aria-label={`下移分镜 ${i + 1}`}
                              disabled={i === p.scenes.length - 1}
                              onClick={() => move(i, 1)}
                            >
                              <ArrowDown size={16} />
                            </button>
                            <button
                              aria-label={`删除分镜 ${i + 1}`}
                              onClick={() => {
                                if (window.confirm("删除这个分镜？")) {
                                  stop();
                                  update({
                                    scenes: p.scenes.filter(
                                      (x) => x.id !== s.id,
                                    ),
                                  });
                                }
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <Field
                          label="英文"
                          value={s.english}
                          onChange={(english) => editScene(s.id, { english })}
                          rows={2}
                        />
                        <Field
                          label="中文"
                          value={s.chinese}
                          onChange={(chinese) => editScene(s.id, { chinese })}
                          rows={2}
                        />
                        <Field
                          label="画面描述 / 图片生成提示词"
                          placeholder="请填写场景、人物动作与镜头描述；不会自动生成英文提示词"
                          value={s.description}
                          onChange={(description) =>
                            editScene(s.id, { description })
                          }
                          rows={2}
                        />
                        <SceneImageSettings
                          scene={s}
                          project={p}
                          generation={imageGeneration}
                          onSetStandard={setCharacterReference}
                          onChange={(patch) => editVisualScene(s.id, patch)}
                        />
                        <div className="scene-bottom">
                          <label>
                            时长{" "}
                            <select
                              value={s.duration}
                              onChange={(e) =>
                                editScene(s.id, {
                                  duration: Number(e.target.value),
                                })
                              }
                            >
                              {Array.from({ length: 60 }, (_, n) => (
                                <option key={n + 1} value={n + 1}>
                                  {n + 1} 秒
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            onClick={() => speak(s)}
                            disabled={!voice.available()}
                          >
                            <Volume2 size={16} />
                            逐句试听
                          </button>
                        </div>
                      </section>
                    ))}
                  </>
                )}
                {tab === "characters" && (
                  <>
                    <p className="muted">
                      统一人物设定与视觉语言，供后续图片生成服务使用。
                    </p>
                    {[
                      ["name", "人物名称"],
                      ["appearance", "外貌特征"],
                      ["clothing", "固定服装"],
                    ].map(([key, label]) => (
                      <Field
                        key={key}
                        label={label}
                        value={p.character[key]}
                        onChange={(value) => editCharacter(key, value)}
                      />
                    ))}
                    {p.creation?.characters.slice(1).map((c, i) => (
                      <details key={i}>
                        <summary>
                          人物 {i + 2} · {c.name}
                        </summary>
                        {["name", "appearance", "clothing"].map((key, n) => (
                          <Field
                            key={key}
                            label={`人物${i + 2}${["名称", "固定外貌", "固定服装"][n]}`}
                            value={c[key]}
                            onChange={(value) =>
                              update({
                                creation: {
                                  ...p.creation,
                                  characters: p.creation.characters.map(
                                    (item, index) =>
                                      index === i + 1
                                        ? { ...item, [key]: value }
                                        : item,
                                  ),
                                },
                              })
                            }
                          />
                        ))}
                      </details>
                    ))}
                    <p className="muted">
                      参考图主要约束主角；固定描述会发送到每镜，但不能保证多人物外貌完全一致，请审核插画。
                    </p>
                    <CharacterReference
                      reference={p.character.referenceImage}
                      onChange={setCharacterReference}
                    />
                    <label className="field">
                      <span>统一画风</span>
                      <div className="style-options">
                        {[
                          SIGNATURE_STYLE,
                          "绘本水彩",
                          "电影质感",
                          "温暖插画",
                          "极简剪纸",
                        ].map((s, i) => (
                          <button
                            key={s}
                            className={p.style === s ? "chosen" : ""}
                            onClick={() => update({ style: s })}
                          >
                            <div className={`style-swatch swatch-${i}`} />
                            <span>
                              {s}
                              {p.style === s && <Check size={14} />}
                            </span>
                          </button>
                        ))}
                      </div>
                    </label>
                    <label className="field">
                      <span>画面比例</span>
                      <select
                        value={p.ratio}
                        onChange={(e) => update({ ratio: e.target.value })}
                      >
                        <option value="9:16">9:16 · 竖屏短视频</option>
                        <option value="16:9">16:9 · 横屏故事</option>
                        <option value="4:5">4:5 · 社交媒体图文</option>
                      </select>
                    </label>
                    <div className="tip">
                      配图请到故事分镜点击“AI
                      生成配图”，或上传本地图片。只有用户确认后才调用图片
                      API；人物一致性和无文字效果需人工检查。
                    </div>
                    <button className="primary" onClick={save}>
                      <Save size={16} />
                      保存角色与项目
                    </button>
                  </>
                )}
                {tab === "audio" && (
                  <>
                    <TemplateSettings project={p} onChange={update} />
                    <div className="intro">
                      <AudioLines size={25} />
                      <div>
                        <strong>让故事拥有声音</strong>
                        <p>使用设备提供的英文语音，无需 API 密钥。</p>
                      </div>
                    </div>
                    {!voice.available() && (
                      <p role="alert">
                        当前浏览器不支持语音合成，仍可预览字幕。
                      </p>
                    )}
                    <label className="field">
                      <span>英文声音</span>
                      <select
                        value={voiceName}
                        onChange={(e) => {
                          voice.stop();
                          setVoiceName(e.target.value);
                        }}
                      >
                        <option value="">系统默认英文语音</option>
                        {voices.map((v) => (
                          <option key={v.voiceURI} value={v.voiceURI}>
                            {v.name} ({v.lang})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>
                        朗读语速 <em>{p.rate.toFixed(1)}×</em>
                      </span>
                      <input
                        type="range"
                        min="0.5"
                        max="1.5"
                        step="0.1"
                        value={p.rate}
                        onChange={(e) => {
                          voice.stop();
                          update({ rate: Number(e.target.value) });
                        }}
                      />
                    </label>

                    <div className="toolbar">
                      <strong>逐句试听</strong>
                      <button onClick={() => voice.stop()}>停止朗读</button>
                    </div>
                    {p.scenes.map((s, i) => (
                      <button
                        className="sentence-row"
                        key={s.id}
                        disabled={!voice.available()}
                        onClick={() => {
                          setIndex(i);
                          speak(s);
                        }}
                      >
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        <span>{s.english || "（英文为空）"}</span>
                        <Volume2 size={17} />
                      </button>
                    ))}
                    <div className="tip">
                      声音取决于设备已安装的英文语音。部分声音需要网络；Safari
                      请点击逐句试听。ElevenLabs 配音请使用左侧“AI 配音”。
                    </div>
                  </>
                )}
              </main>
              <Preview
                project={
                  tab === "video"
                    ? { ...previewProject, ratio: "9:16" }
                    : previewProject
                }
                videoFrame={tab === "video" ? videoFrame : null}
                onSeekScene={
                  tab === "video" && videoPlayback.ready
                    ? (i) => videoTransport.current?.seekScene(i)
                    : null
                }
                audioRef={ai.audioRef}
                audioSelected={
                  ai.selected === "article"
                    ? isFresh(ai.current, p.english, ai.speed)
                    : ai.selected === p.scenes[index]?.id &&
                      isFresh(
                        ai.current,
                        p.scenes[index]?.english || "",
                        ai.speed,
                      )
                }
                audioRange={
                  ai.selected === "article"
                    ? ai.timeline.ranges.find((r) => r.index === index)
                    : null
                }
                syncLabel={
                  ai.playing
                    ? ai.timeline.mode === "aligned"
                      ? "AI 音频 · API 字符时间戳同步"
                      : ai.selected === "article"
                        ? ai.timeline.mode === "unavailable"
                          ? "AI 音频 · 等待真实时长"
                          : "AI 音频 · 估算同步"
                        : "AI 音频 · 单镜真实时长同步"
                    : null
                }
                index={index}
                setIndex={setIndex}
                playing={
                  tab === "video" && videoPlayback.ready
                    ? videoPlayback.playing
                    : playing || ai.playing
                }
                stop={stop}
                toggle={() => {
                  voice.stop();
                  if (tab === "video" && videoPlayback.ready) {
                    videoTransport.current?.toggle();
                    return;
                  }
                  if (ai.playing || (tab === "ai" && ai.selected)) {
                    ai.toggle();
                    return;
                  }
                  ai.pause();
                  setPlaying(!playing);
                }}
              />
            </div>
          </>
        )}
        {imageGeneration.error && (
          <div className="recovery-panel" role="alert">
            {imageGeneration.error}
          </div>
        )}
        {imageGeneration.pending && (
          <div className="recovery-panel">
            <a
              href={imageGeneration.pending.imageRef.dataUrl}
              download="unapplied-illustration.jpg"
            >
              下载未应用的生成结果
            </a>
            <button
              onClick={() => {
                if (window.confirm("将结果应用到原分镜？会替换该镜当前图片。"))
                  imageGeneration.applyPending();
              }}
            >
              应用到原分镜
            </button>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "放弃这张未应用的生成图片？如尚未下载，结果将无法恢复。",
                  )
                )
                  imageGeneration.clearPending();
              }}
            >
              放弃未应用图片
            </button>
          </div>
        )}
        <footer>
          用故事连接语言，用创作发现可能。<span>STORY STUDIO / V4.1</span>
        </footer>
      </div>
      {message && (
        <div className="toast" role="status">
          {message}
          <button aria-label="关闭提示" onClick={() => setMessage("")}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
