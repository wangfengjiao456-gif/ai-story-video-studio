import { uid } from "../model.js";
import React, { useState, useRef } from "react";
import { musicDefaults } from "../creation/project.js";
export default function MusicSettings({ settings, onChange, asset, onUpload }) {
  const s = { ...musicDefaults(), ...settings },
    [error, setError] = useState(""),
    input = useRef(null);
  return (
    <details>
      <summary>背景音乐 · 上传、音量、自动压低与淡入淡出</summary>
      <p>
        没有捆绑音乐曲库；请上传你有权使用的MP3，不会抓取商业歌曲。推荐类型：
        {s.recommendation}
      </p>
      <label>
        <input
          type="checkbox"
          checked={s.enabled}
          onChange={(e) => onChange({ ...s, enabled: e.target.checked })}
        />
        启用背景音乐（默认关闭）
      </label>
      <button onClick={() => input.current.click()}>
        {asset ? "替换音乐" : "上传授权音乐 MP3"}
      </button>
      <input
        hidden
        ref={input}
        type="file"
        accept="audio/mpeg,.mp3,audio/mp3"
        onChange={async (e) => {
          const file = e.target.files[0];
          e.target.value = "";
          if (!file) return;
          try {
            if (file.size > 20 * 1024 * 1024 || !file.size)
              throw Error("音乐须为非空MP3，最多20MB。");
            if (!/\.mp3$/i.test(file.name)) throw Error("请上传MP3音乐。");
            onUpload({ blob: file, id: uid(), name: file.name });
            onChange({ ...s, enabled: true });
            setError("");
          } catch (err) {
            setError(err.message);
          }
        }}
      />
      {asset && (
        <p>当前音乐：{asset.name}（仅本页面内存，刷新后需重新上传原文件）</p>
      )}
      {[
        ["volume", "音乐音量", 0, 0.4, 0.01],
        ["duck", "有人声时保留的音乐比例", 0, 1, 0.05],
        ["fade", "淡入淡出秒数", 0, 5, 0.1],
      ].map(([k, label, min, max, step]) => (
        <label className="field" key={k}>
          {label}：{k === "fade" ? `${s[k]}秒` : `${Math.round(s[k] * 100)}%`}
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={s[k]}
            onChange={(e) => onChange({ ...s, [k]: Number(e.target.value) })}
          />
        </label>
      ))}
      <p>
        音乐循环适配视频；估算时轴下混音也仅供估算预览，导出前必须校准。按当前句子时轴压低，不伪称逐词声学检测。准备视频时本地生成单声道32kHz
        WAV，预览/导出使用完全相同的混音。混音与原MP3分别保留，原配音不变速。长项目需要更多iPad内存。
      </p>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
