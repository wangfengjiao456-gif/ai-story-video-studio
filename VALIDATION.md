# V3.1 完整流程回归记录

本轮在 `feat/story-studio-v3-1` 上增量修改，未更改原网站设计、Production 或既有 ElevenLabs Voice ID / eleven_v3 / en / 默认 0.8。没有真实付费 AI 请求。

## 已通过的验证

- `npm test`：111 项，包括既有 V1–V3.1、文本上限、保存失败保护、语音参数、对齐、JSON、图片与新增韧性测试。
- `npm run test:renderer`：7 项真实 FFmpeg 测试。
- `npm run build`：通过。构建分别注入三类无效标记密钥，`dist` 无标记泄漏。
- Docker 镜像实际构建成功；非 root 用户、2CPU / 2GB 约束下同样 7 项编码测试通过；另在 1CPU / 2GB 下实际完成十镜、34.582秒、H.264/AAC 样片。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`：实际运行本地 Vercel 处理代码、Vite、FFmpeg、浏览器和真实部署验证脚本。费用接口仅使用模拟上游，测试不会读取或调用真实 AI Key。

十镜素材为程序插画、Flite 英文语音和对应中文，句长不同；每句配音先独立合成、解码取得已知时间，然后合成整篇 MP3。浏览器回归使用这些实际片段边界做人工时间轴输入，不以字符或词数分配分镜长度。Forced Alignment 的模拟返回只证明合约/状态处理，不证明真实模型的语音定位质量。

浏览器链路包括：上传 → 强制对齐费用确认前零调用/确认后一次模拟调用 → 起止时间校准 → 播放、暂停、拖动、右侧跳镜 → 两处预览画布一致 → 保存刷新后重导同一 MP3 恢复 → 导出故障注入 → 显示真实失败 → 手动重试 → 实际 H.264/AAC 编码 → HEAD/下载验证 → 更换 MP3 停止旧音频并停用旧时轴 → 仍保留已完成视频下载入口。

单独的真实 HTTP 验证脚本还检查 CORS 预检、服务密钥/来源、十段 MP3、完整下载、Safari 所需 Range、ffprobe 编码与时长；拒绝 Production。

## 实际覆盖的边界

- 同大小不同 MP3 的 SHA-256 绑定；替换音频、重生成、改英文或改生成语速使旧快照失效。
- 并发导入时后选 MP3 生效；取消过期元数据读取并释放 Blob URL；卸载与迟到响应不覆盖新项目。
- 句前/句后静音与句间无字幕区间；连字符词、缺词、错词、时间倒序、非有限值、稀疏数组和重叠时间拒绝。
- 真实输出十镜顺序和逐帧边界，尾部有声样本、前后静音、30fps / yuv420p / AAC；网页和实际解码长度不符时拒绝，不裁切/变速/逐段补长。
- 缺图片、过期 MP3、无时长、超长字幕分页等由既有测试覆盖；估算预览不得直接导出，需用户校准确认。
- 网络失败、无效完成元数据、文件不可下载、状态异常、总超时、图片解码等待取消、显式重试创建新任务；不自动重复提交。
- Docker 0600 文件权限问题已修复；文件上传原子替换，重复上传不累计计费大小，上传不锁住全局状态；取消结果不能迟到变成完成。
- 下载 HEAD/Range/后缀 Range/416、Content-Disposition、跨域暴露头；定时过期/取消和重启孤立文件清理。
- JSON 文件 50MB 与浏览器本地 5MB 分开校验；大文件能按同一字段规则导出/导入，本地保存失败不覆盖旧数据，文本长度限制不放宽。
- 已有图片生成审查 P2：未处理的生成结果会阻止新生成，下载/应用/明确放弃前不覆盖，自动化验证第二次调用不触发上游。

## 尚不能声称已验收的部分

没有用户浏览器中的原项目、原插画与 ElevenLabs MP3；没有 Render/Vercel 管理权限和真实 AI Key，也没有实体 iPad。当前浏览器为 Chromium 的 iPad 尺寸/触控模拟，不能等同 Safari 真机。真实 Forced Alignment 质量、声音权限/额度、线上环境变量范围和付费 API 链路必须由所有者配置后验证。

服务仍需独立部署，Vercel Preview 构建成功不代表 worker 已上线。任务为单实例临时存储，服务重启/约一小时过期后无法恢复下载。需保留 JSON、MP3 和原图备份；对齐上传上限 3MB、渲染 MP3 50MB、任务 200MB/10分钟、JSON 文件 50MB/本地5MB，老 iPad 大图片内存表现需实机检查。长字幕镜内翻页仍按句内时间比例分配，不是逐词高亮；Cover 裁切/主体位置需人工检查。

## 复现与线上配置

完整命令、准确环境变量和控制台位置见 [DEPLOYMENT.md](DEPLOYMENT.md)。`npm run test:e2e` 自动启动/关闭隔离服务；部署后的 `STUDIO_URL=https://your-preview.vercel.app npm run verify:preview` 实际创建合成素材的渲染任务、下载并核验。GitHub CI 自动上传 `video-regression` 日志/MP4 artifact（7天），不包含服务密钥或任务 token。

## GitHub CI 留档

代码提交 `e4a37ca5c49d4cf0ccb665939bc999519743b9ab` 的 [Studio checks #19](https://github.com/wangfengjiao456-gif/ai-story-video-studio/actions/runs/42353149559) 已通过：依赖、111项测试、构建、主机/容器编码、浏览器回归和真实HTTP下载验证；`video-regression` artifact 已上传（约2.06MB、7天保留），包含两份实际生成的 MP4。Vercel 也已报告该提交 Preview Ready。以上不是用户原始项目或真实收费 API 验收。
