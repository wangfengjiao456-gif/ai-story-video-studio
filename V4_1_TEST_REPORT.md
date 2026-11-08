# V4.1 自动验收记录

本报告记录代码与本地自动验收，不代表真实API、线上Render或真实iPad Safari已通过。

## 已执行

- `npm test` 通过；为核对当前Node文件级汇总，另逐个执行全部测试文件，合计 **162个实际测试用例**通过（原148个 + 新14个）。
- 新14个用例：双语草稿/正式项目/JSON兼容、采用后的媒体时间轴失效、长度与数量限制、结构化单次请求、费用与来源和密钥前置检查、分类型上游错误、10话题/局部改写/非法结果、当前文章上下文与文章模式、首次请求/长耗时并发锁、前端重复确认锁、离开页面晚响应、切换项目保护、保存失败与局部隔离、超长旧文章下独立请求不附带原文、明确引用时在付费前拦截超限上下文。
- `npm run lint`、`npm run build` 通过。
- `npm run test:renderer`：**11项**通过（沙箱最初阻止本地监听，允许本地网络后重新运行通过）。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` 完整通过；使用已安装的系统Chromium，未把缺少的Playwright默认二进制误报为网站错误。
- 新助手回归单独重复执行通过，包含免费恢复已收到结果，不额外调用付费接口。

## 实际产物

CI `video-regression` artifact 包含以下文件（自动上传，默认保留7天）：

- `work/v41-regression/report.json`：Mock OpenAI + 实际API处理器/Chromium触控视口/浏览器存储/JSON下载；2次模拟请求、10话题、10组双语、原作品采用前不变、旧作品备份下载、免费恢复草稿、刷新继续、390/820宽度无横向溢出；没有图片或配音付费请求。
- `work/v41-regression/original-backup.json` 和 `assistant.png`：测试作品JSON及工作台截图，均为合成资源。
- `work/v4-regression/cover-music.mp4`：实际FFmpeg编码，1080×1920、30fps、H.264/AAC；3秒封面+10分镜+上传合成背景音乐+34.602667秒旁白，输出37.603秒。
- `work/v4-regression/report.json`：Mock规划/图片/TTS，真实混音、渲染、下载；封面画布与编码关键帧MAE约1.049，刷新后免费恢复媒体。
- `work/mp4-regression/browser-export.mp4`、`frame-verification.json`：真实MP4，11个首/第二/中间/末镜及边界探针验证。
- `work/deployment-verification/preview-render.mp4`：本地Vercel处理器到Render同构服务的真实HTTP任务链路，34.582秒、H.264/AAC，文件1,183,413字节；报告环境是development，不是线上Preview连接。

## 尚未验证

- OpenAI真实模型权限、真实输出质量、费用与真实账户Limits/Billing。
- ElevenLabs真实收费生成/音频质量；固定Voice ID / eleven_v3 / 默认0.8沿用既有代码，自动回归使用Mock。
- 当前Vercel Preview变量及实际Render服务连接、容量、线上下载。
- 真实iPad Safari上传、播放、存储、系统文件下载与实机成片试听。Chromium触控视口不等于Safari。

没有读取或记录真实密钥，没有调用付费API，没有修改Production配置，没有创建收费服务。
