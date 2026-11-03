// Public configuration only. Never put credentials in this module.
export const VOICE_ID = "NDTYOmYEjbDIVCKB35i3";
export const MODEL_ID = "eleven_v3";
export const LANGUAGE = "en";
export const DEFAULT_SPEED = 0.8;
export const MIN_SPEED = 0.7;
export const MAX_SPEED = 1.2;
export const TTS_TEXT_LIMIT = 5000;
export function validateSpeechInput(text, speed) {
  if (typeof text !== "string" || !text.trim())
    throw Error("请先填写英文文章或分镜英文。");
  if (text.length > TTS_TEXT_LIMIT)
    throw Error(
      "Eleven v3 单次最多生成 5,000 字符，请缩短文章或逐个分镜生成。",
    );
  if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED)
    throw Error("AI 配音语速必须在 0.7–1.2 之间。");
  return { text: text.trim(), speed };
}
