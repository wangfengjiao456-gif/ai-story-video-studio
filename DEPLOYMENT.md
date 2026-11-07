# MP3 对齐与真实 MP4：Preview 部署

Vercel 只运行前端、密钥代理和小型 API；FFmpeg 在独立 Docker 服务运行。**只部署 Vercel 不会具备 MP4 编码能力。** 本仓库包含完整服务，必须完成下面两部分配置；当前修复不会自动修改 Production。

## 1. 部署独立 MP4 服务（无需任何 AI 密钥）

在 Render 控制台选择 New → Blueprint，连接本 GitHub 仓库，选择 `feat/story-studio-v3-1` 分支，使用根目录 `render.yaml`。该配置使用付费 standard 实例（请先查看 Render 当期价格）；不要误把渲染服务当作免费的 Vercel Function。可改为其他 Docker 主机，要求至少 2 vCPU、2GB RAM、3GB 临时空间、HTTPS、单实例，禁止多实例自动扩容（任务状态在单机内存）。

Blueprint 提示时填写 `ALLOWED_ORIGINS`：当前 Vercel Preview **完整来源**，例如 `https://your-preview.vercel.app`，无末尾斜杠；多个来源用逗号分隔。建议先在 Vercel 绑定固定 Preview 域名，否则每次 Preview 域名变化需要更新。不要写 `*`。

`RENDERER_API_KEY` 由 Render 自动生成。在 Render 环境变量页复制此值，仅粘贴至 Vercel 服务端环境变量。记录服务 HTTPS 地址，例如 `https://story-studio-renderer-xxxx.onrender.com`。如果已有旧 worker，请重新构建并部署本分支最新提交，旧版本没有 `/check` 接口，不能通过连接验证。`/health` 返回 `{"ok":true}` 表示进程已启动。

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

为避开 Vercel 请求体限制，此对齐上传最多 **3,000,000 字节**。较大 MP3 可先无损保留原件，另做 128kbps MP3；或者直接手动填写原文件的全部起止时间，不需要付费 API。渲染本身支持 50MB MP3。未完成对齐/手动确认时不允许以猜测时间轴导出。

起止时间可独立微调，允许句间静音但不允许重叠；静音期间保持上一图片并隐藏字幕。预览以实际音频时钟逐帧更新；导出使用同一帧时轴。30fps 切换误差最多半帧，字幕较长时镜内分页仍为比例分配，并非逐词高亮。MP4 终点按真实音频时长截取（容器帧粒度误差不超过一帧）。

时间轴保存进项目 JSON/localStorage，并绑定 MP3 内容 SHA-256、原文及音频时长。MP3 不写入 localStorage；刷新后重新导入**同一个 MP3**，已有时间轴可恢复。不同 MP3 即使大小/时长相同也不能误用旧时间轴。

## 4. 验收

先使用回归样本验证服务（不会调用付费 API），再导入你浏览器里的原项目 JSON、10 张图片及 MP3。自动对齐需你主动确认；试听并微调 → 准备完整视频 → 拖动检查第二句与最后一句 → 导出 → 等待百分比完成 → 播放并下载 MP4。iPad 使用 Safari，下载后通过「文件」打开；如出现播放页，可用分享菜单存储。

本地模拟测试与 FFmpeg 编码测试不等于真实 ElevenLabs、实际 Render/Vercel 连通测试或真机 iPad 验收。没有部署账户配置和你的原始 MP3 时，不能声称这些已验证。

## 可复现的离线浏览器回归

需要 FFmpeg（含 libflite）、中文字体、Chromium 和 Playwright Core。无需任何真实 API Key。脚本使用**模拟的强制对齐响应**，但媒体上传、FFmpeg 编码、Range 和下载均走真实本地服务，并检查暂停、拖动切镜、刷新恢复。不要将测试用密钥用于线上。

```sh
node scripts/render-regression.mjs
ffmpeg -i work/mp4-regression/video.mp4 -vn -c:a libmp3lame -b:a 128k -y work/mp4-regression/uploaded-test.mp3
# 终端一
npm run dev -- --port 5173
# 终端二
RENDERER_API_KEY=offline-browser-key-0123456789 ALLOWED_ORIGINS=http://localhost:5173 PORT=8099 python3 renderer/server.py
# 终端三（如尚未安装）
npm install --no-save --package-lock=false playwright-core
CHROMIUM_PATH=/usr/bin/chromium node scripts/browser-video-regression.mjs
```

可用 `PLAYWRIGHT_MODULE` 指定已有 Playwright Core 的绝对入口路径，`RENDERER_BASE` 指定本地服务地址。生成的视频保存在 `work/mp4-regression/browser-export.mp4`。此浏览器回归只模拟 iPad 尺寸/触控，不代替真实 Safari。
