import { validateCues } from "./alignment.js";
// Draft edits are applied atomically. Invalid/blank fields never change the confirmed timeline.
export function parseTimingDraft(draft, count, duration) {
  if (!Array.isArray(draft) || draft.length !== count)
    throw Error("请填写全部分镜的开始和结束时间。");
  const cues = draft.map((c, i) => {
    for (const key of ["start", "end"])
      if (
        c?.[key] === undefined ||
        c[key] === null ||
        String(c[key]).trim() === ""
      )
        throw Error(
          `分镜 ${i + 1} 的${key === "start" ? "开始" : "结束"}时间不能为空。`,
        );
    return { start: Number(c.start), end: Number(c.end) };
  });
  if (!validateCues(cues, count, duration))
    throw Error(
      "时间必须在 MP3 时长内，结束晚于开始、每镜至少一帧，并且分镜不能重叠。已确认时间轴未修改。",
    );
  return cues;
}
