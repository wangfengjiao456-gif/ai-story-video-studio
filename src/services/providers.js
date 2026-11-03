// Future providers implement generate({ scene, character, style, ratio, signal })
// and speak({ text, rate, onEnd, onError }). Keep paid API keys on a server.
export const demoImageProvider = {
  name: "演示占位画面",
  async generate() {
    return { type: "placeholder", generated: false };
  },
};
export const browserVoiceProvider = {
  available: () => typeof window !== "undefined" && "speechSynthesis" in window,
  stop() {
    if (this.available()) window.speechSynthesis.cancel();
  },
  speak({ text, rate, voice, onEnd, onError }) {
    if (!this.available()) {
      onError?.("此浏览器不支持语音朗读。");
      return;
    }
    this.stop();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = rate;
    if (voice) u.voice = voice;
    u.onend = onEnd;
    u.onerror = (e) => {
      if (!["interrupted", "canceled"].includes(e.error))
        onError?.("朗读失败，请检查系统英文语音并重试。");
    };
    window.speechSynthesis.speak(u);
  },
};
