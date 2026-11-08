# 独立 MP4 渲染服务（真实 FFmpeg，不是 Vercel Function）

Vercel 保留网页、ElevenLabs / OpenAI 代理和短任务创建代理。CPU 密集的 H.264 / AAC 渲染在独立容器中执行；PNG 字幕帧与 MP3 由浏览器直接上传到工作容器，不通过 Vercel 的响应/请求大小限制，也不在 iPad 上运行 ffmpeg.wasm。

## 部署

在支持长运行 Docker 容器和 HTTPS 的服务（例如自有 VPS、Render/Railway 容器服务）部署。使用单实例，建议 2 vCPU、2 GB RAM 和 3 GB 可写临时空间（本地 1CPU/2GB 也已完成约35秒十镜样片，长项目需实测），不设置多副本或自动休眠；当前任务状态在进程内，重启会失去任务。HTTPS 由平台或反向代理终止。

从仓库根目录构建：

```sh
docker build -f renderer/Dockerfile -t story-renderer .
docker run --rm -p 8000:8000 --env-file /path/to/private-renderer.env story-renderer
```

私有环境文件只放在部署机器，不提交仓库：

- `RENDERER_API_KEY`：自己生成 32 字节以上随机密钥；不要使用文档示例弱口令。
- `ALLOWED_ORIGINS`：逗号分隔的**精确前端来源**，例如 `https://你的当前分支预览域名.vercel.app`。不要带路径或结尾斜杠，不使用 `*`；预览部署域名变化时要更新并重启服务。也可使用稳定的分支 Preview 别名。
- `PORT`：默认 8000，宿主平台可注入。
- `RENDERER_DATA_DIR`：默认 `/tmp/story-renderer`，需可写。

反向代理须允许单文件 50 MB 上传，保留 Authorization、Origin、Range 请求头，支持 PUT / POST / GET / HEAD / DELETE / OPTIONS，读写超时至少 20 分钟。不要记录 URL query（包含短期 job token）或媒体请求体。服务自身不记录访问 URL、密钥或文章内容。

在**当前 Vercel Preview** 新增：

- `RENDERER_URL`：容器的 HTTPS 根地址。
- `RENDERER_API_KEY`：与容器相同的随机密钥，只在 Vercel 服务端使用。

同时将 `ELEVENLABS_API_KEY` 和 `OPENAI_API_KEY` 的 Preview 范围覆盖 `feat/story-studio-v3-1` 或所有 Preview，并重新部署该 Preview。原 `feat/elevenlabs-v2` 分支专用变量不会自动继承到其他分支；不要为了修复 Preview 修改 Production 的 ElevenLabs 密钥。

先访问容器 `/health`，再在网页点击“检查当前分支配置”，最后用现有 MP3 完成一次实际任务。变量“已配置”只表示存在，不代表 Key 已验证或渲染服务可达。保护 Vercel Preview 和付费 API 接口，只对可信用户开放。

## 协议与限制

1. Vercel 使用服务密钥创建任务；浏览器只得到一小时有效、仅限该任务的随机 token，不得到服务密钥或 AI 密钥。
2. 浏览器直接上传由网页同一 `framePlan/paintFrame` 绘制的 PNG 字幕页及真实 MP3，启动编码并轮询进度。
3. 单个任务最多 10 分钟、300 PNG 页、100 MP3、200 MB 总上传；单帧最多 10 MB，单 MP3 最多 50 MB。最多保留 10 个任务，单实例一次编码一个任务，繁忙时明确拒绝，不自动重复付费 AI 请求。
4. 服务校验 PNG 为 1080×1920、实际 MP3 时长与声明基本一致。FFmpeg 强制 MP3 解码、PNG 输入，禁用网络协议；不接受输入 URL 或用户提供的命令行/文件路径。
5. 按 30fps 帧数合成，H.264 High level 4.0、yuv420p、AAC 48kHz / 192kbps、faststart；每段音频按所测时长补齐尾部，避免多 MP3 编码延迟累积导致切镜漂移。
6. 视频使用任务 token 直接播放/下载，支持 Range 以便 Safari 拖动；token 是短期任务访问凭证，不是 API Key。页面只在内存保存，不写入项目 JSON/localStorage。
7. 一小时后过期任务在后续请求时清理。重启、休眠或域名变更可能使任务失效；及时下载 MP4。取消会终止编码，但上传内容保留到过期清理。

## 本地验证

安装 Python 3.12+、FFmpeg（含 libx264/libmp3lame）和 ffprobe；无需 Python 第三方依赖：

```sh
python3 renderer/test_renderer.py
```

测试会真实启动 HTTP 服务，验证鉴权、上传、不可重复启动、H.264/AAC 编码和 Range 下载；不调用 AI。Docker 镜像中已安装 FFmpeg。此实现按单实例个人创作工作室设计，未提供分布式队列、长期云存储、恢复中断任务或多租户账户系统。


## 当前完整验证

根目录 `npm run test:renderer` 执行真实解码/编码测试；`npm run test:e2e` 自主启动本地服务，验证十镜、浏览器和真实下载；`STUDIO_URL=https://your-preview.vercel.app npm run verify:preview` 对部署后的 Preview/worker 实际运行同样链路。安装与资源生成说明见 [DEPLOYMENT.md](../DEPLOYMENT.md)。不调用收费 AI。

服务核对每段实际解码样本时长，拒绝单段或累计偏差超过一帧的任务，不擅自裁切、拉伸或插入逐段静音。渲染全程超时为 15 分钟；取消不会被后到的完成结果覆盖。定时清理过期/取消任务及启动时清理孤立目录。媒体上传先完整接收后原子替换，上传等待不锁住所有任务状态查询。下载支持 HEAD、标准 Range、Content-Disposition，跨域暴露必要响应头。

Docker 使用非 root 用户，COPY 显式设置文件所有者，避免宿主机文件权限为 0600 时镜像能构建但无法启动。CI 在 2CPU/2GB 的实际容器中运行同一编码测试。
