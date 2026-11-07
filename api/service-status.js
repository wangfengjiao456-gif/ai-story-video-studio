export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET")
    return res.status(405).json({ error: { message: "仅支持 GET。" } });
  return res
    .status(200)
    .json({
      branch: process.env.VERCEL_GIT_COMMIT_REF || "本地开发",
      environment: process.env.VERCEL_ENV || "development",
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      renderer: !!(process.env.RENDERER_URL && process.env.RENDERER_API_KEY),
      guidance:
        "Vercel → 项目 Settings → Environment Variables：将变量添加到当前 Preview 分支或全部 Preview；新增后重新部署。仅为 feat/elevenlabs-v2 配置的变量不会覆盖其他分支。不要添加 VITE_ 前缀，也不需要修改 Production 密钥。",
    });
}
