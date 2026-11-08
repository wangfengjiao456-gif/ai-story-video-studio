# MP3 对齐与真实 MP4：Preview 部署

V4.2最新任务恢复、使用与部署步骤见 [V4_2_GUIDE.md](V4_2_GUIDE.md)，功能状态以 [审查清单](V4_2_AUDIT.md) 为准。

V4.1 AI 创作助手增量操作及 Preview 环境变量说明见 [V4_1_GUIDE.md](V4_1_GUIDE.md)；原有制作与Render步骤保持适用。

**V4 用户先阅读 [V4_GUIDE.md](V4_GUIDE.md)**，使用 `feat/story-studio-v4`。以下 V3.1 部署记录保留作兼容参考；不要照旧分支部署 V4 混音任务。

Vercel 只运行前端、密钥代理和小型 API；FFmpeg 在独立 Docker 服务运行。**只部署 Vercel 不会具备 MP4 编码能力。** 本仓库包含完整服务，必须完成下面两部分配置；当前修复不会自动修改 Production。

## 1. 部署独立 MP4 服务（无需任何 AI 密钥）

在 Render 控制台选择 New → Blueprint，连接本 GitHub 仓库，选择 `feat/story-studio-v3-1` 分支，使用根目录 `render.yaml`。该配置使用付费 standard 实例（请先查看 Render 当期价格）；不要误把渲染服务当作免费的 Vercel Function。可改为其他 Docker 主机，建议 2 vCPU、2GB RAM、3GB 临时空间、HTTPS、单实例，禁止多实例自动扩容（任务状态在单机内存）。已在 1CPU / 2GB 容器中实际编码约 35 秒十镜样片；standard 方案的当期 CPU、内存和价格请以 Render 创建页面为准，较长项目若超时需升级资源。

Blueprint 提示时填写 `ALLOWED_ORIGINS`：当前 Vercel Preview **完整来源**，例如 `https://your-preview.vercel.app`，无末尾斜杠；多个来源用逗号分隔。建议先在 Vercel 绑定固定 Preview 域名，否则每次 Preview 域名变化需要更新。不要写 `*`。

`RENDERER_API_KEY` 由 Render 自动生成。在 Render 环境变量页复制此值，仅粘贴至 Vercel 服务端环境变量。记录服务 HTTPS 地址，例如 `https://story-studio-renderer-xxxx.onrender.com`。如果已有旧 worker，请重新构建并部署本分支最新提交，旧版本没有 `/check` 接口，不能通过连接验证。Render 的 **Health Check Path 请填写 `/healthz`**。它无需鉴权，直接返回 HTTP 200 和 `{"ok":true}`，不启动 FFmpeg、不查询磁盘；旧 `/health` 保留为工具/磁盘就绪检查，网站 `/check` 仍验证密钥、来源和就绪状态。服务监听 `0.0.0.0`，优先读取 Render 注入的 `PORT`（例如 10000）；Docker 的 EXPOSE 8000 仅是元数据，不限制运行端口。

其他 Docker 主机可执行：

```sh
docker build -f renderer/Dockerfile -t story-renderer .
docker run --rm --env-file renderer.env -p 8000:8000 story-renderer
```

`renderer.env`（不要提交）：

```text
RENDERER_API_KEY=<至少24字符的随机密钥>
ALLOWED_ORIGINS=https://your-preview.vercel.app
PORT=8000
```

在容器前配置 HTTPS 反向代理，允许每次最多 50MB 上传、至少 60 秒上传超时。媒体由浏览器直传此服务，避开 Vercel 4.5MB 请求限制。任务最多 10 分钟、200MB；单实例同时渲染一个任务；完成后约一小时过期，重启会丢失任务，请及时下载。

## 2. 当前 Vercel Preview 环境变量

在项目 Settings → Environment Variables 添加：

- `RENDERER_URL`：上面 Docker 服务的 HTTPS 地址。
- `RENDERER_API_KEY`：与 Docker 服务**完全相同**的密钥。
- `ELEVENLABS_API_KEY`：已有 ElevenLabs 密钥，需具备 Forced Alignment 权限；对齐可能消耗额度。

变量范围选择 **Preview** 并包含当前分支，随后 Redeploy。V2 分支专属配置不会自动覆盖 V3.1。不要添加任何 `VITE_*_API_KEY`，无需修改 Production 密钥。

进入「视频预览与导出」点击「检查 MP4 服务连接」：实际验证网络、服务密钥、当前来源白名单。未部署或配置错误时不开放导出，显示具体原因。

## 3. 外部 MP3：先建立真实时间轴

导入 MP3，点击「逐句音频对齐」，阅读并确认本次费用提示。服务端调用 ElevenLabs 官方 `/v1/forced-alignment`，传入 MP3 和全部英文分镜，验证返回单词与分镜一致后生成起止时间。它不是重新配音，也不是按字符估算；模型推断仍需听音校对，不能保证任意录音均逐词准确。

为避开 Vercel 请求体限制，此对齐上传最多 **3,000,000 字节**。较大 MP3 可先无损保留原件，另做 128kbps MP3；或者直接手动填写原文件的全部起止时间，不需要付费 API。渲染本身支持 50MB MP3。未完成对齐/手动确认时不允许以猜测时间轴导出。网站生成的整篇音频如果缺少有效 API 时间戳，也只允许估算预览，必须校准确认后才能导出。

起止时间可独立微调，允许句间静音但不允许重叠；静音期间保持上一图片并隐藏字幕。预览以实际音频时钟逐帧更新；导出使用同一帧时轴。30fps 切换误差最多半帧，字幕较长时镜内分页仍为比例分配，并非逐词高亮。MP4 终点按真实音频时长截取（容器帧粒度误差不超过一帧）。

时间轴保存进项目 JSON/localStorage，并绑定 MP3 内容 SHA-256、原文及音频时长。MP3 不写入 localStorage；刷新后重新导入**同一个 MP3**，已有时间轴可恢复。不同 MP3 即使大小/时长相同也不能误用旧时间轴。

## 4. 验收

先使用回归样本验证服务（不会调用付费 API），再导入你浏览器里的原项目 JSON、10 张图片及 MP3。自动对齐需你主动确认；试听并微调 → 准备完整视频 → 拖动检查第二句与最后一句 → 导出 → 等待百分比完成 → 播放并下载 MP4。iPad 使用 Safari，下载后通过「文件」打开；如出现播放页，可用分享菜单存储。

本地模拟测试与 FFmpeg 编码测试不等于真实 ElevenLabs、实际 Render/Vercel 连通测试或真机 iPad 验收。没有部署账户配置和你的原始 MP3 时，不能声称这些已验证。

## 5. 自主运行完整回归（不调用付费 AI）

```sh
npm ci
npm run lint
npm test
npm run test:renderer
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

需要 FFmpeg（含 libflite）和中文字体。Linux 可安装 `ffmpeg fonts-noto-cjk`。如已有系统 Chromium，可用 `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`，不需要下载另一个浏览器。

`test:e2e` 自动建立独立的本地 Vite、FFmpeg 服务及测试 API，创建十镜 Flite/程序插画样本。配音句子长短不同，使用每段真实解码长度组成已知时轴，不使用按字数估算。Forced Alignment 上游使用明确的模拟响应；真实 Vercel 处理函数、媒体上传、编码、HEAD/Range、失败重试和 MP4 下载均实际执行。还验证右侧跳镜、两处画布相同、暂停、刷新恢复、替换 MP3 停用旧时轴及保留已完成下载。隔离服务关闭后不会改动用户浏览器存档。仅使用测试密钥，禁止线上复用。

GitHub CI 运行以上测试，并构建 Docker 镜像，以非 root 用户在 2 CPU / 2GB 限制下运行编码测试；回归日志和 MP4 在该次 Actions 的 `video-regression` artifact 中保留 7 天。浏览器模拟 iPad 820×1180 触控尺寸，不等于实体 Safari 验收。

本地结果：

- `work/mp4-regression/browser-export.mp4`：浏览器上传的整篇 MP3 导出结果。
- `work/deployment-verification/preview-render.mp4`：真实 HTTP 验证脚本的十段 MP3 拼接结果。
- `work/e2e/*.log`：隔离服务和浏览器日志。日志不包含服务密钥或完整任务凭证。

## 6. 部署后真实连通 / 端到端验证（仍不调用付费 AI）

先在本机安装 FFmpeg 并生成固定回归资源，再对**已配置的 Preview**运行：

```sh
npm ci
node scripts/render-regression.mjs
STUDIO_URL=https://your-preview.vercel.app npm run verify:preview
```

将 `your-preview.vercel.app` 换成你实际打开的网站来源，必须与 worker `ALLOWED_ORIGINS` 一致。脚本读取当前环境，若是 Production 即停止，不创建生产渲染任务。随后实际检查 API、服务密钥、CORS 预检，上传十镜/配音，轮询编码，核对文件 HEAD、下载、Range、H.264/AAC、30fps、1080×1920 和完整时长；只有实际文件通过后才输出 PASS，并保存 MP4。

如果 Vercel Preview 开启了 Deployment Protection，脚本可能收到登录 HTML 或 401，这不代表 renderer 密钥错误。可由项目所有者在 Vercel → Settings → Deployment Protection → Protection Bypass for Automation 创建绕过密钥，在**本机环境变量** `VERCEL_AUTOMATION_BYPASS_SECRET` 中设置后重试。脚本只将该值发送给 Vercel 来源，不转发 worker、不写入文件、不放入 URL。无需关闭 Preview 保护，也不要把此密钥发到聊天或提交到仓库。

该命令会消耗你自己的 worker CPU/流量，不调用 ElevenLabs 或 OpenAI。它不证明真实 Forced Alignment 质量；最终仍应在 iPad Safari 导入你的原项目与 MP3、确认一次真实对齐、试听校准、导出并在「文件」中播放。

## 7. 时长、失败恢复和备份边界

- 服务逐帧解码 MP3，按解码样本数计算时长，排除文件头编码填充；不对每段音频裁切、变速或补长。网页与解码时长的单段/累计差超过一帧时拒绝渲染，要求重新导入/校准，不偷偷修改时轴。最终封装精度受 30fps / AAC 帧粒度约束。
- 后端完整任务处理预算 15 分钟；前端整体导出预算 20 分钟、每个上传/状态请求最多 60 秒。错误/取消会尽力停止并清理任务，不在后台自动反复渲染。失败后可手动点「重试导出」。已完成的旧视频仍明确标注为导出时快照，继续编辑或新导出失败不会丢失其下载入口。
- 定时每 30 秒清理过期/取消文件，无需下一次访问触发；重启清理无法恢复的旧任务目录。任务仍是单实例临时存储，不能横向扩容或保证重启后续传。
- 本地浏览器保存限 5MB（实际配额可能更小）；JSON 文件备份/重新导入限 50MB，保留文字、图片、样式和时间轴。单字段长度校验不变，不允许导出无法读取的文本。较大项目不能声称已保存到浏览器，刷新前必须先下载 JSON；超过 50MB 请保留原图并用较小图片副本。MP3 需单独下载/保留，JSON 不含音频。
- 对齐上传限 3MB、渲染 MP3 限 50MB、任务总上传限 200MB、最长 10 分钟。缺图、无效文件、过期音频、重叠时间或字幕分页超过上限会明确拒绝。

## 面向 iPad 用户的操作入口

非技术用户请先阅读 [IPAD_GUIDE.md](IPAD_GUIDE.md)：从旧网址备份、Render/Vercel 的具体点击位置、密钥本人复制、免费手动校准、第一次真实导出及 Safari「存储到文件」均逐步说明。Preview 与 Production、不同 Preview 来源的本地存档不共享，不要在迁移前清除旧网址数据。

本轮新增的验收不仅核对编码：会从实际下载 MP4 解码首镜、第二镜、中镜、末镜和切换前后一帧，与浏览器绘制的对应插画/中英字幕证据比较。报告为 `work/mp4-regression/frame-verification.json`，随 CI artifact 上传。它不执行 OCR，也不把模拟 Forced Alignment 当作真实模型验收。

非默认 `aiSpeed` 现在随项目 JSON/浏览器存档保存，旧项目缺失时仍默认 0.8。切换功能页、网页进入后台或 pagehide 会暂停预览；回到页面同步当前位置，不自动续播或重新生成音频。Safari 可能忽略离页提醒，仍须主动保存/导出备份。

只读进度/下载检查遇到临时网络、超时、408/429/5xx 时最多补试两次；创建/开始任务及付费调用均不自动重提。编码完成而下载检查失败时保留文件，提供单独恢复检查；结果过期明确标注。V4.2在当前标签页会话存储任务入口，支持刷新后恢复已提交/已完成任务；上传未完成不能补传，关闭标签页、服务重启或过期后不能保证恢复。

## 最终审计与放行条件

完整模块核对、测试证据边界和待用户事项见 [RELEASE_AUDIT.md](RELEASE_AUDIT.md)。状态为“等待用户授权和真实验收”。本轮新增原子时间草稿：应用前不能导出，错误不会覆盖已确认时轴；微调后须应用并再次保存。worker 最多额外保留十条失败记录，不影响正在运行的任务。

请保持 Preview 的 Deployment Protection，仅向可信使用者授权；同源请求校验不等于登录/付费额度控制。不要为方便验收将付费 API 公开到无保护网站。Production 放行仍需实际 Render/Vercel 连接及实体 iPad 验收。

## Render 首次部署健康检查超时

若日志显示端口 10000 已启动，但 `/healthz` 超时，旧版服务缺少该公开路由。使用本分支修复后的提交，Render → 服务 → Settings → Health Check Path 填 `/healthz`，然后 Manual Deploy → Deploy latest commit。无需改 Dockerfile Path `renderer/Dockerfile` 或根目录 Build Context `.`，无需更换密钥；`RENDERER_API_KEY` 仍需至少 24 字符，`ALLOWED_ORIGINS` 仍需有效 Preview 来源。

免费 0.1 CPU / 512MB 的健康检查不应执行编码。启动只加载 Python 标准库及本地模块，FFmpeg 仅在任务时运行；通过健康检查不代表这一级资源能可靠完成 1080×1920 编码。该资源等级未通过真实 Render 编码验收，可能超时或内存不足；先验证启动与连接，再由所有者决定是否升级资源，不自动购买。

## 连接检查提示来源未允许

`/healthz` 成功不验证域名白名单。连接检查返回 403 时，网站会显示本次请求的准确来源；由所有者核对它确实是自己的 Preview 后，在 Render → 服务 → Environment → `ALLOWED_ORIGINS` 的**原有值后**用英文逗号追加该来源，保留所有已有项。来源只包含协议和域名，不带末尾 `/`、路径或通配符。保存并重新部署 Render，再回到同一 Preview 点击连接检查。

`render.yaml` 的 `ALLOWED_ORIGINS: sync: false` 表示值由部署者维护，仓库提交不会覆盖当前后台值。单次部署网址与固定分支别名是不同来源，需分别允许或始终使用已经允许的同一个网址。不要从未经确认的历史记录自动添加域名。

## 集中稳定性修复分支

`fix/studio-v3-1-stability` 的修改见 [STABILITY_REVIEW.md](STABILITY_REVIEW.md)。连接检查/创建任务的上游超时为45秒，Vercel函数预算60秒；仍不自动重提任务。Render后台白名单仅做规范化，既有允许来源不会自动增加或删除；拒绝通配符与非来源路径。新分支Preview须在环境变量范围包含该分支，并在Render原有白名单追加实际新来源。不要改Production。

图片安全诊断在 Vercel → 当前 Preview Deployment → Runtime Logs，过滤 `image_api_failure`，只含已知分类/上游状态/request ID，不含原始密钥、描述或参考图。SDK原始错误正文不记录，避免意外泄密。

## V4部署入口

本轮独立分支 `feat/story-studio-v4`，需要更新已有Render worker以支持V4 PCM WAV，并将Vercel Preview变量范围覆盖新分支。不要修改Production。完整一次集中配置、白名单及最小真实验收见 [V4_GUIDE.md](V4_GUIDE.md)。旧项目关闭封面/音乐时仍支持原MP3；旧worker缺少PCM能力会明确拒绝V4混音任务，不假成功。
