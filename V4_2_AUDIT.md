# V4.2 功能与集成审查清单

## 审查基线与证据标准

从 V4.1 `68adaf3`（PR #7，未合并）创建 `feat/story-studio-v4-2`。检查了实际 src、全部8个api路由、renderer、工作流、测试、README与部署指南，而不是沿用旧报告结论。V4 PR #6、V4.1 PR #7 是增量堆叠，本PR仍不合并Production。

“实现并自动测试通过”指实际代码运行。外部AI测试使用Mock；实际生成的MP4由本地FFmpeg编码。Vercel Ready只证明部署构建状态，不证明密钥/账号/模型额度/线上Render或真实iPad验收。

## 功能清单

| 功能 | 状态 | 实际实现与验证边界 |
|---|---|---|
| 文章与中文翻译编辑、保存、清空、分句 | 已实现并自动测试 | model.js、App.jsx；验证长度后保存，JSON与刷新回归 |
| 分镜新增、删除、排序、独立图片 | 已实现并自动测试 | 图片绑定scene ID，JSON保留次序；10镜浏览器回归 |
| 角色外貌/服装/统一风格/主参考图 | 已实现并自动测试；真实图像质量待验收 | imageConfig.js结构化cast优先；参考图调用images.edit；不保证模型绝对一致 |
| 话题策划与自然语言写作、三模板 | 已实现；真实API输出质量未验证 | creative-assistant.js实际Responses API；结构化10话题/双语/计划；非静态演示 |
| 话题选择到文章生成 | V4.1部分实现，本轮补齐并自动测试 | 选择后直接进入一次文章费用确认，不自动扣费，不再要求再点生成按钮 |
| 双语文章/局部改写/自动分镜规划 | 已实现并自动测试 | 严格配对和计数，采用后直接传递；局部变更保留未变化分镜图和可恢复配音记录 |
| 保存失败与重复采用保护 | V4.1存在问题，本轮修复 | 规划保存失败保留草稿；相同已采用内容直接继续，避免重置素材 |
| 封面00/独立插画/可调时长/标题叠加 | 已实现并实际编码验证 | coverScene + 同一frameRenderer，默认3秒，无需图像生成文字 |
| AI图片单图/缺失批量/免费恢复/费用锁 | 已实现；真实账号权限未验证 | openai-image.js + useImageGeneration；SDK无自动重试，429/额度/权限分别提示 |
| ElevenLabs整篇/逐镜MP3、速度、播放和下载 | 已实现并自动测试；本轮未调用真实收费服务 | 服务器固定Voice ID、eleven_v3、en、speed0.8；请求契约及播放回归 |
| API字符时间戳 | 已实现；长静音处理本轮修复 | 不再把实际语音末尾拉到下一句或音频尾部；完整预览与MP4使用真实语音区间，静音留图但隐藏字幕 |
| 外部MP3 Forced Alignment/手动起止 | 已实现并自动测试；真实对齐服务未验证 | align-audio.js按确认调用，严格核对词文本；失败不伪造，允许逐句手动校准 |
| 无时间戳配音 | 部分自动化（明确估算） | 可估算预览；必须人工确认/真实对齐或逐镜音频后才导出，不冒充精确同步 |
| 背景音乐上传、循环、压低、淡入淡出 | 已实现并实际编码验证 | OfflineAudioContext生成同一份WAV供预览/FFmpeg；以句子区间压低，并非声学逐词检测 |
| 合法内置音乐曲库 | 尚未实现 | 没有授权音乐资源，不伪造曲库；支持上传有权使用的MP3 |
| MP4任务与H.264/AAC下载 | 已实现并实际本地HTTP/FFmpeg验证；线上未验收 | Vercel建任务/检查；大媒体与进度经受限任务令牌直接到worker；1080×1920、30fps、48kHz AAC |
| 渲染中断/刷新恢复 | V4.1部分实现，本轮完善并自动测试 | sessionStorage保存当前标签页任务；只GET/HEAD恢复，避免重建。上传未完成不能刷新补传，明确放弃入口后重做 |
| 浏览器持久化/JSON/媒体备份 | 已实现并自动测试，有浏览器限制 | 提示词、图片、时轴、草稿在项目模型；MP3/音乐必须保留原文件。已收到付费媒体尽力写IndexedDB，不等于云存储 |
| 跨Preview网址同步、账号云项目库 | 尚未实现 | 不同origin数据隔离；必须JSON+原媒体迁移，没有新增收费数据库 |
| 真实iPad Safari | 待人工验证 | 自动覆盖Chromium触控390/820视口、上传/播放/拖动/下载/恢复；不能冒充实机Safari |

## API与部署契约

| 路由 | 服务端变量/上游 | 费用与安全 |
|---|---|---|
| creative-assistant / plan-story | OPENAI_API_KEY → 官方Responses API、gpt-5-mini | 费用确认、严格结构、无SDK重试；助手有实例内冷却和在途锁，非分布式账单上限 |
| openai-image | OPENAI_API_KEY → 官方Images generate/edit | 单图n=1、medium、JPEG；无自动重试；人物参考用编辑接口 |
| elevenlabs | ELEVENLABS_API_KEY → 固定声音with-timestamps | 不接受浏览器密钥，50秒上游超时，4MB响应限制；未改变声音与速度参数 |
| align-audio | ELEVENLABS_API_KEY → Forced Alignment | 用户确认后才调用；音频/英文需匹配，不承诺免费 |
| renderer-status / video-jobs | RENDERER_URL + RENDERER_API_KEY | 同源检查，服务端读取共享密钥。new URL('/jobs',base)避免尾斜杠拼接错误；PCM能力检查先于建任务 |
| service-status | 仅返回配置存在与否 | 不是账号权限、额度或真实连接成功证明，不返回密钥 |

Render `/healthz` 无需鉴权快速200；`/check`检查共享密钥、来源、FFmpeg/磁盘。`ALLOWED_ORIGINS`明确白名单，不开放星号。Docker非root、单任务渲染、文件/时长限制、取消/超时/TTL清理已实现。免费实例资源能力与冷启动仍需线上验收。render.yaml是已有V4模板，本轮没有应用Blueprint、改套餐或创建服务；模板standard方案可能收费，必须由所有者决定。

## 官方参数复核（非真实生成测试）

- [OpenAI图片指南](https://developers.openai.com/api/docs/guides/image-generation)与已安装官方SDK的ImageModel类型均包含现有 `gpt-image-2.5-sunburst`，支持generate/edit与参考图。本轮没有静默换模型。尺寸与质量仍由既有imageConfig集中管理。
- [ElevenLabs timing接口](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)返回音频与字符对齐数据；[官方voice-settings参考](https://github.com/elevenlabs/skills/blob/main/text-to-speech/references/voice-settings.md)说明v2/v3支持speed。保留0.8，不把v4限制套到v3。具体声音权限、额度与实际听感仍未验证。

## 错误与失败矩阵

- API缺配置/无额度/429/权限/网络：assistant、openai-image、elevenlabs-api、external-alignment各测试以Mock覆盖，页面不泄露上游私密原文，不自动重试付费调用。
- 图片错误/保存失败/过期音频/切换项目：image-generation-state、creation-state、assistant-state、persistence、voice-playback测试。
- Render不可达、创建失败、上传失败、超时、HEAD下载失败：video-resilience与浏览器回归；新render-checkpoint验证恢复只读、过期/服务重启/未上传完成不假成功。
- 用户刷新、退出返回、不同域名：浏览器真实存储/JSON回归；只能同origin恢复。系统Safari下载失败只能用模拟网络失败覆盖，真实系统下载待验收。

## 剩余限制

1. 真实付费API、实际Render环境变量/CORS/资源能力与Safari实机，不能用Mock替代。
2. 没有全局分布式付费请求幂等数据库；界面锁、无自动重试、实例锁降低风险。公开开放时应设置API项目Limits/Billing和部署保护。
3. 上传未完成时无法刷新补传；关闭标签页会清除会话任务入口，Render重启/TTL后不能恢复。不会暗中重复创建任务。
4. 本机媒体与会话存储是尽力恢复，Safari可清理。JSON不携带MP3/音乐，也不携带Render能力令牌或API密钥。
5. 写作时长与角色一致性是目标，不是承诺；用户仍需一次内容审核与最终试听。
