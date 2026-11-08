# V4.2 自动验收结果

## 本地结果

- `npm test`通过；逐文件执行核对 **172个实际JavaScript用例**（V4.1的162个 + 本轮10个）。测试使用Mock，不调用付费服务。
- `npm run lint`、`npm run build`通过。
- `npm run test:renderer`：**11项**通过，实际FFmpeg/HTTP/鉴权/Range/超时/清理验证。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`：经典10镜、V4封面音乐、V4.1助手以及新增V4.2完整话题工作流全部通过。
- 新增用例：只读任务恢复/安全会话记录/上传中断与过期/已启动任务网络故障不删除不重提/下载验证期间离开仍保留完成任务、规划保存失败不丢草稿、话题直达文章确认、真实API语音区间静音/越界截至真实音频长度与更换图片不动音轨、局部采用保留其他图片与逐镜配音。

## 从话题到真实文件（work/v42-regression）

输入「自律是一种自由」。实际使用前端与真实API处理器，外部OpenAI和ElevenLabs响应以Mock替代：

- 2次模拟文本请求：10话题→选题直接确认文章→10组双语/人物/全部提示词/标题封面。
- 11次模拟图片生成（封面+10镜）、1次模拟整篇配音；模型/Voice ID/默认0.8契约校验。
- 使用真实合成MP3资源与逐镜已知时长，导入并确认10组手动起止；没有把字符估算冒充真实对齐。
- 上传合成合法测试音调音乐；真实OfflineAudioContext混音，预览与导出同一份WAV。
- **仅创建1个实际本地FFmpeg任务**。生成37.603秒MP4（3秒封面+34.602667秒原旁白），1080×1920、30fps、H.264/AAC。
- 实际下载MP4；封面关键帧与浏览器画布MAE约1.045，解码确认音乐进入封面音轨，输出时长差小于一帧。
- 刷新后恢复原任务并检查下载，任务创建次数仍为1；之后免费恢复丢失图片/配音，没有新增模拟付费调用。
- Chromium触控390/820视口无横向溢出；没有页面运行时错误。真实iPad键盘/系统下载不在此范围。

## 其他实际视频证据

- `work/mp4-regression/browser-export.mp4`及11个首/第二/中间/最后与切换边界探针，验证图片与双语字幕。
- `work/v4-regression/cover-music.mp4`，保留原有8图，仅生成缺失2图与封面、配音；刷新恢复无重复计费。
- `work/v41-regression/report.json`：旧项目备份下载、编辑/刷新/免费恢复、已采用内容再次进入制作不重置上传图片。
- `work/deployment-verification/preview-render.mp4`是本地Vercel处理器到真实同构worker的HTTP集成验证，不是线上Render成功声明。
- CI的 `video-regression` artifact上传视频、关键帧、JSON报告与日志，默认保留7天。

## 失败覆盖

现有及新增Mock测试覆盖：OpenAI/ElevenLabs缺密钥、额度、429、模型权限、网络中断、非法响应、图片/音频失败、不自动重试；存储配额与损坏、晚响应/退出/切换项目；Render创建/上传/轮询/下载失败、过期、服务重启、超时、重复提交。浏览器测试实际模拟HEAD失败与恢复。

不能把这些Mock失败测试称为真实Safari系统错误测试；不能把本地FFmpeg或Preview Ready称为真实OpenAI、ElevenLabs、线上Render验证。

## 待人工

真实账号权限/额度与真实模型输出、实际Render来源与免费实例能力、真实iPad Safari播放/键盘/下载/Files成片，仍需所有者一次集中验收。未调用付费API、未修改Production密钥、未创建收费资源或合并分支。
