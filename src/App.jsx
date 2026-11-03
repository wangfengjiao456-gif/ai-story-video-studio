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
} from "./model.js";
import { browserVoiceProvider as voice } from "./services/providers.js";
import Preview from "./components/Preview.jsx";
import Field from "./components/Field.jsx";
const KEY = "story-studio-v1";
const tabs = [
  ["article", "文章编辑", BookOpen],
  ["scenes", "故事分镜", Clapperboard],
  ["characters", "角色与画风", Users],
  ["audio", "配音与字幕", AudioLines],
];
function load() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved)
      return { project: parseProject(saved), message: "已恢复本地项目" };
  } catch {
    return {
      project: initialProject(),
      message: "本地存档不可用，已打开示例。请使用 JSON 备份。",
    };
  }
  const p = initialProject();
  p.scenes = splitArticle(p.english, p.chinese);
  return { project: p, message: "" };
}
const startup = load();

export default function App() {
  const [p, setP] = useState(startup.project),
    [tab, setTab] = useState("article"),
    [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [message, setMessage] = useState(startup.message),
    [voices, setVoices] = useState([]),
    [voiceName, setVoiceName] = useState("");
  const input = useRef(null);
  const update = (patch) => setP((prev) => ({ ...prev, ...patch }));
  const stop = () => {
    setPlaying(false);
    voice.stop();
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
    }, p.scenes[index].duration * 1000);
    return () => clearTimeout(t);
  }, [playing, index, p.scenes]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 6500);
    return () => clearTimeout(t);
  }, [message]);
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
      setMessage("项目已保存到当前浏览器，请定期导出 JSON 备份。");
    } catch {
      setMessage("本地保存失败，请导出 JSON 备份。");
    }
  }
  function split() {
    if (
      p.scenes.length &&
      !window.confirm("重新拆分会替换当前分镜，包括手动修改，是否继续？")
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
    try {
      if (file.size > 5 * 1024 * 1024) throw Error("文件不能超过 5 MB。");
      const project = parseProject(await file.text());
      if (!window.confirm("导入将替换当前工作区，未保存内容会丢失。是否继续？"))
        return;
      stop();
      setP(project);
      setIndex(0);
      setMessage("导入成功，点击保存可存入当前浏览器。");
    } catch (err) {
      setMessage(`导入失败：${err.message}`);
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
          创作工作台 <span>V1.0</span>
        </div>
        <nav>
          {tabs.map(([id, label, Icon], i) => (
            <button
              key={id}
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
            <button onClick={() => input.current.click()}>
              <Upload size={16} />
              <span>导入项目</span>
            </button>
            <button onClick={() => downloadProject(p)}>
              <Download size={16} />
              <span>导出 JSON</span>
            </button>
            <button className="primary" onClick={save}>
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
        <div className="project-heading">
          <div>
            <div className="eyebrow">YOUR NEXT STORY STARTS HERE</div>
            <input
              aria-label="项目名称"
              className="title-input"
              maxLength={120}
              value={p.title}
              onChange={(e) => update({ title: e.target.value })}
            />
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
                {p.scenes.reduce((a, s) => a + s.duration, 0)} 秒
              </span>
            </div>
            {tab === "article" && (
              <>
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
                                scenes: p.scenes.filter((x) => x.id !== s.id),
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
                      value={s.description}
                      onChange={(description) =>
                        editScene(s.id, { description })
                      }
                      rows={2}
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
                    onChange={(value) =>
                      update({ character: { ...p.character, [key]: value } })
                    }
                  />
                ))}
                <label className="field">
                  <span>统一画风</span>
                  <div className="style-options">
                    {["绘本水彩", "电影质感", "温暖插画", "极简剪纸"].map(
                      (s, i) => (
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
                      ),
                    )}
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
                  </select>
                </label>
                <div className="tip">
                  当前预览使用固定演示图形；人物和画面描述不会生成真实图片。图片服务接口已预留。
                </div>
                <button className="primary" onClick={save}>
                  <Save size={16} />
                  保存角色与项目
                </button>
              </>
            )}
            {tab === "audio" && (
              <>
                <div className="intro">
                  <AudioLines size={25} />
                  <div>
                    <strong>让故事拥有声音</strong>
                    <p>使用设备提供的英文语音，无需 API 密钥。</p>
                  </div>
                </div>
                {!voice.available() && (
                  <p role="alert">当前浏览器不支持语音合成，仍可预览字幕。</p>
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
                <label className="field">
                  <span>字幕模式</span>
                  <select
                    value={p.subtitles}
                    onChange={(e) => update({ subtitles: e.target.value })}
                  >
                    <option value="both">英文 + 中文 · 双语字幕</option>
                    <option value="en">英文字幕</option>
                    <option value="zh">中文字幕</option>
                  </select>
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
                  请点击逐句试听。ElevenLabs 等服务尚未接入。
                </div>
              </>
            )}
          </main>
          <Preview
            project={p}
            index={index}
            setIndex={setIndex}
            playing={playing}
            stop={stop}
            toggle={() => {
              voice.stop();
              setPlaying(!playing);
            }}
          />
        </div>
        <footer>
          用故事连接语言，用创作发现可能。<span>STORY STUDIO / V1</span>
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
