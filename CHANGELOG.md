# 更新日志

## [0.7.11] - 2026-02-25

### 新功能
- **消息编辑重发**：hover 用户消息显示编辑按钮，点击后 inline 编辑并重发，截断后续对话重新生成
- **ask_user 交互支持（Web）**：WS 新增 prompt/prompt_reply 协议，ask_user 工具不再卡死，问题显示为对话消息，输入框可直接回复

### 改进
- **Skill 目录恢复短描述**：纯名称列表改为 `name(中文描述)` 格式，修复 LLM 无法匹配 comfyui 等名字不自解释的 skill
- **消息 meta 精简**：移除模型名称，改为端到端用时（发送→完成）
- **UI 去线条**：page-header、chat-header 移除 border-bottom

### 修复
- **对话压缩边界崩溃**：`turns.length === compressAfter` 时 `oldTurns` 为空导致 `createdAt` 读取失败，条件改为严格大于

## [0.7.10] - 2026-02-25

### 新功能
- **Web 语音输入**：输入框新增麦克风按钮，使用浏览器 Web Speech API 实时语音转文字，点击开始/停止，识别结果填入输入框

## [0.7.9] - 2026-02-25

### 优化
- **系统提示词瘦身**：移除 5 条冗余路由规则（PDF/docx/xlsx/pptx/email），已被 skill 目录动态注入覆盖，减少 ~80 token
- **长期记忆注入精简**：搜索结果从 10 条降至 5 条，总字符上限 2000，避免 prompt 膨胀
- **Skill 目录压缩**：从 `name: description` 格式改为纯逗号分隔名称列表，~250 tok → ~30 tok
- **工具失败自动熔断**：同一工具连续失败 2 次后自动跳过，阻止 LLM 反复重试同一失败工具导致的错误雪崩

## [0.7.8] - 2026-02-25

### 改进
- **移动端侧边栏加宽**：260px → 300px，内容不再拥挤
- **移动端侧边栏左滑关闭**：打开状态下在侧边栏区域左滑可拖回关闭，与右滑打开对称

### 修复
- **claude_code 嵌套会话报错**：spawn 时清除 `CLAUDECODE` 环境变量，修复从 Claude Code 会话内启动 gateway 时子进程拒绝运行
- **claude_code 输出重复+刷新丢失**：移除伪流式 `streamText` 推送和 `autoComplete`，改由外层 LLM 正常回复并持久化

## [0.7.7] - 2026-02-25

### 改进
- **Header 操作菜单**：右上角 Export 按钮替换为 `...` 下拉菜单，包含 Rename / Export / Delete 三项操作
- **移动端侧边栏精简**：触摸设备隐藏会话条目的 X 删除按钮，通过 Header 菜单操作替代

### 修复
- **移动端侧边栏导航失效**：`setSidebarOpenWithHistory(false)` 中 `history.back()` 异步执行会撤销 NavLink 的 `navigate()`，改为 `history.replaceState()` 同步覆盖 dummy 条目

## [0.7.6] - 2026-02-25

### 安全修复
- **命令注入漏洞（RCE）**：`routes/tools.ts` 中 `execSync` 拼接用户输入改为 `execFileSync` 参数数组，消除 git clone / tar / powershell 命令注入风险

### 修复
- **Gemini 工具调用失败**：tool use ID 从随机 UUID 改为函数名，修复 `functionResponse.name` 匹配不上导致 API 拒绝
- **deleteSession 数据不一致**：5 条 SQL 操作包裹 `db.transaction()`，中途失败自动回滚
- **Trace JSON 解析崩溃**：`rowToTrace` 中 `JSON.parse(row.steps)` 加 try-catch，损坏数据不再导致服务崩溃
- **ensureConversation 竞态**：CHECK-THEN-INSERT 改为 `INSERT OR IGNORE`，消除并发 PRIMARY KEY 冲突
- **Agent stop 后仍重试**：retry 循环添加 `this.aborted` 检查，用户停止后立即中断
- **WhatsApp LID undefined**：`lid` 为空时不再拼出 `"undefined@lid"` 误拒合法消息

## [0.7.5] - 2026-02-24

### 新功能
- **claude_code 工具**：集成 Claude Code CLI，通过 `claude -p --dangerously-skip-permissions --output-format stream-json` 将编码任务委托给 Claude Code
- **claude_code 流式输出**：Claude Code 的文本实时流入用户聊天气泡（通过 `streamText` 回调直推 WS），工具完成后返回精简摘要给外层 LLM + `autoComplete` 跳过外层总结，大幅节省 token

### 改进
- **手机端侧边栏手势**：左边缘右滑打开侧边栏；打开时浏览器返回键/手势关闭侧边栏（而非离开页面），通过 `history.pushState` 实现
- **Artifacts 预览**：代码块支持 HTML / SVG / Mermaid 实时预览（Preview 按钮切换）；HTML 文件链接显示为紧凑卡片，点击弹出全屏 overlay 渲染（← Back + Open ↗ + ESC 关闭）；`claude_code` 生成的输出文件自动 sendFile；`/files/` 路由同时服务 `data/tmp` 和 `data/temp`
- **工具调用格式化**：JSON 用 `react-json-view-lite` 可折叠树形展示（适配亮/暗主题），Markdown 用 `remark-gfm` 渲染表格等 GFM 语法（行内代码保持 inline），INPUT/OUTPUT 标签右侧 hover 显示 Copy 按钮一键复制整段

### 修复
- **claude_code 输出路径**：自动注入 `data/tmp/` 目录约束到 Claude Code prompt，防止文件生成在项目根目录导致预览按钮不显示
- **WS 断连崩溃**：所有 `socket.send()` 替换为 `safeSend()`（readyState 检查 + try/catch），防止 socket 关闭后 send 抛异常级联崩溃；ping 超时从 1 轮（30s）放宽到 2 轮（60s），容忍长任务期间的瞬时延迟
- **工具调用 Markdown 渲染崩溃**：`ToolResultContent` 中 `markdownComponents` 未定义，修正为 `mdComponents`
- **Cloudflare Tunnel 503**：Fastify `keepAliveTimeout` 从默认 5s 增至 120s，防止 Tunnel 复用已关闭连接导致 502/503
- **WS 长推理断连**：服务端每 30s 发 ping 帧保活，防止 Cloudflare Tunnel / 反代因空闲超时关闭 WebSocket
- **WS 自动重连**：断连后 3s 自动重连，无需手动点击 Reconnect
- **`/files/` 缓存**：生成文件加 `Cache-Control: max-age=7d, immutable`，加载成功后浏览器直接走缓存，避免 VPN/Tunnel 慢速链路重复下载
- **Stop 按钮无效**：点击停止后服务端仍在发 text chunk 导致创建新 assistant 消息，加 `stoppedRef` 在 `done` 到达前忽略所有流式事件
- **手机回车误发送**：触控设备（`pointer: coarse`）Enter 键改为换行，通过发送按钮发送；桌面端保持 Enter 发送
- **手机侧边栏自动弹出**：窄屏（≤768px）默认关闭侧边栏
- **手机侧边栏导航不关闭**：点击 Skills / Traces / Token Logs / Memory / Settings / 会话列表后自动收起侧边栏
- **非 Chat 页面无侧边栏入口**：`PageHeader` 组件统一处理，侧边栏关闭时在 header 栏内显示汉堡图标，与 Chat 页样式一致

## [0.7.4] - 2026-02-24

### 新功能
- **URL 路由驱动会话**：`/chat` 为新对话空界面，`/chat/{sessionId}` 加载指定会话，支持浏览器前进/后退、刷新保持、直接分享链接

### 修复
- **New Chat 按钮 415 错误**：`createSession()` POST 无 body 导致 Fastify 报 Unsupported Media Type，按钮点击无响应
- **New Chat 零请求**：改为本地清空（`setActiveSessionId(null)`），不再发 POST+history+WS 三连请求，会话延迟到发首条消息时创建
- **新会话消息闪跳**：`ensureSession` 改变 activeSessionId 后 loadHistory effect 覆盖乐观消息，加 `skipHistoryRef` 跳过空历史加载
- **New Chat 后 Connection Lost**：WS 关闭时 `wsGenRef` 未递增导致旧 onClose 回调触发断连横幅
- **移动端按钮持久高亮**：加 `-webkit-tap-highlight-color: transparent` + `@media (hover: none)` 重置 sticky hover
- **移动端 300ms 点击延迟**：button/a/input 加 `touch-action: manipulation`
- **会话并发创建**：`handleNewChat` 加互斥锁，`ensureSession` 加共享 Promise 去重
- **CDN 缓存旧资源**：`index.html` 加 `Cache-Control: no-cache` 头，Cloudflare 等 CDN 不再缓存过期的 HTML

## [0.7.3] - 2026-02-23

### 改进
- **yt-dlp `--no-warnings`**：所有 yt-dlp 命令模板加 `--no-warnings`，避免弱模型把成功操作的 WARNING 误判为失败
- **yt-dlp `--write-auto-subs`**：下载字幕命令增加 `--write-auto-subs`，同时拉取人工上传和自动生成的 CC 字幕
- **bilingual-subtitle CC 快路径**：新增 Step 1 先尝试下载 CC 字幕（`--write-auto-subs --convert-subs srt`），有 CC 字幕时跳过 Whisper；`sub-langs` 修正为 `'en,zh*'` 以匹配 `zh-Hans`/`zh-Hant`

## [0.7.2] - 2026-02-23

### 新功能
- **bilingual-subtitle skill**：视频字幕提取/翻译/烧录一体化技能，GPU 加速 Whisper（CUDA/mlx/CPU 三级降级）+ Google Translate 批量翻译 + NVENC/AMF/QSV 自动编码，支持双语 SRT、仅中文、仅原文、卡拉OK 逐词高亮模式
- **会话重命名**：双击顶部标题即可编辑会话名称，Enter 确认、Escape 取消
- **全局字号提升**：所有页面和组件 font-size 统一 +1px（body 基准 15px），提升整体可读性

### 修复
- **Telegram/WhatsApp 广播持久化**：聊天目标（chatId/JID）持久化到 SQLite `chat_targets` 表，应用重启后自动恢复，提醒通知不再丢失
- **Telegram 文件持久化**：Telegram 网关的 `sendFile` 回调补充 `sentFiles` 跟踪，生成的图片/文件会以 markdown 链接持久化到数据库，WebUI 查看同一会话时可正常显示
- **会话懒创建**：刷新页面不再自动创建空会话，仅在用户发送第一条消息时按需创建（`ensureSession`），避免空会话堆积
- **会话列表刷新可靠性**：移除 SessionContext 中所有自动创建逻辑，刷新时正确加载并选中最近活跃会话

### 改进
- **Memory 语义去重**：记忆写入（自动提取 + remember 工具）从"文本完全匹配"升级为"语义相似度阈值（0.75）"去重，"User prefers to be called 主人" 和 "User prefers to be addressed as 主人" 不再重复存储；新增 `MemoryStore.findSimilar()` 方法
- **Browser batch 模式**：新增 `batch` 命令，一次提交多步浏览器操作（open→click→type→click→screenshot），从 6 轮 LLM 调用压缩到 2 轮，速度提升 3 倍以上。batch 模式内 click/type 自动等待元素出现（5s），适配 SPA 动态渲染
- **Browser wait_for / sleep**：新增 `wait_for`（等待选择器出现）和 `sleep`（固定等待）命令

### 修复（续）
- **Shell 输出文件始终实时显示**：`data/tmp/` 下的文件不再依赖 `auto_send: true` 才发送 WS file 事件，截图等文件始终在 WebUI 中实时显示（`auto_send` 仅控制是否跳过 LLM 下一轮回复）
- **文件去重（三层）**：ws.ts `sentFiles` 按 URL 去重防止同一文件重复持久化；agent-loop `allSentFiles` 跨迭代按 URL 去重（修复 drain 清空后下轮 shell auto-detect 再次匹配的问题）；前端 WS file 事件按 URL 去重避免重复注入 markdown
- **Browser type 支持 contentEditable**：`type` 命令改用 `document.execCommand('insertText')` 处理富文本编辑器（如 X/Twitter 发推框），解决 `el.value` 对 contentEditable 元素无效的问题

### 移除
- **Plans 页面**：移除前端 Plans 页面、侧边栏入口和后端 API 路由（plan_task 在对话中执行，独立页面无实际用途）

## [0.7.1] - 2026-02-23

### 改进
- **Settings 页面优化**：移除 Provider Configuration（.env 已管理）；Usage Statistics 去掉 Provider 列并合并 System Info；Tools 改为折叠式 badge 布局
- **Skills 独立页面**：从 Settings 拆分为独立 `/skills` 路由，2 列卡片网格布局，支持搜索/导入/开关/删除，侧边栏新增 Skills 导航
- **临时文件自动清理**：每次对话结束后自动删除 `data/tmp/*.py` 临时脚本，避免无限累积

## [0.7.0] - 2026-02-23

### 新功能
- **5 个新技能**：`docx`（Word 文档）、`xlsx`（Excel 表格）、`pptx`（PowerPoint 演示文稿）、`pdf`（PDF 处理）、`imap-smtp-email`（收发邮件），均通过 Python 脚本实现
- **技能开关**：Web UI 设置页可启用/禁用单个技能，状态持久化到 `data/skill-settings.json`，重启后自动恢复
- **技能导入**：支持从 GitHub URL 克隆或上传 .zip 安装新技能，Web UI 设置页提供导入面板和删除按钮
- **技能删除**：`DELETE /api/skills/:id` 端点 + 前端删除确认

### API
- `PUT /api/skills/:id/enabled` — 切换技能启用/禁用
- `POST /api/skills/import/github` — 从 GitHub 导入技能
- `POST /api/skills/import/zip` — 上传 zip 导入技能
- `DELETE /api/skills/:id` — 删除技能

## [0.6.1] - 2026-02-23

### 新功能
- **WebUI 视频/音频播放器嵌入**：消息中的视频链接（mp4/mkv/webm/mov/avi）自动渲染为 `<video>` 播放器，音频链接（mp3/wav/ogg/flac/m4a）渲染为 `<audio>` 播放器
- **WebUI 图片多模态支持**：上传的图片不再仅作为 URL 文本发送，WS handler 会读取文件转 base64 构建 `ContentBlock[]`，LLM 原生看到图片，与 Telegram/WhatsApp 行为统一
- **侧边栏会话搜索**：搜索按钮改为过滤会话列表（按标题匹配），移除原来的会话内消息搜索
- **移动端侧边栏优化**：毛玻璃遮罩（`backdrop-filter: blur`）+ iOS 风格 cubic-bezier 滑出动画 + 点击空白收回

### 改进
- **工具调用卡片标题增强**：`bash` 显示执行的命令、`use_skill` 显示技能名称、`file_read/write` 显示路径、`send_file` 显示文件名
- **use_skill 状态显示**：Telegram/WhatsApp 现在会发送 `⚙️ use_skill: 技能名` 状态消息
- **ReactMarkdown components 稳定化**：提取为模块级常量，避免侧边栏开关导致 video/audio 元素重载

### 修复
- **WebSocket 切换会话断连**：`wsConnected` 改为在 `onOpen` 回调中设置（而非立即设置），引入 generation counter 防止旧连接回调污染新连接状态
- **auto_send 路径检测**：`FILE_PATH_RE` 正则支持相对路径 `data/tmp/file.mp4`（无前导分隔符），修复 yt-dlp 下载后不自动发送的问题
- **Telegram bot 重启冲突**：`bot.start({ drop_pending_updates: true })` 避免与旧实例冲突，`bot.stop()` 加 catch 防止 shutdown 崩溃

## [0.6.0] - 2026-02-22

### 重构
- **WebUI 单侧边栏布局**：合并原有双侧边栏（主导航 + 会话列表）为 Claude 风格统一侧边栏
  - 侧边栏包含：品牌标识、新建会话、搜索、页面导航、会话历史、设置/API/主题切换
  - 移除顶部模型选择器（已有智能路由，无需手动切换）
  - 搜索从 header 移入侧边栏（搜索对象是会话，属于侧边栏功能）
  - 主题切换从独立按钮收缩为侧边栏底部小图标
  - 输入框加大（rows=2、border-radius=16px、font-size=15px）
  - 所有 emoji 替换为 SVG 图标（导航、工具状态、按钮等）
  - ChatContext 提升会话状态，Layout 和 ChatPage 共享
  - ChatPage 瘦身：只负责消息区 + 输入框

## [0.5.0] - 2026-02-22

### 新功能
- **Light/Dark 主题切换**：Claude.ai 风格的 light 配色（暖棕 accent、奶白背景、米色用户气泡），sidebar 底部切换按钮，localStorage 持久化
- **代码高亮 + 复制按钮**：`react-syntax-highlighter` + `oneDark` 主题，语言标签左上角，hover 显示 Copy 按钮
- **Stop 按钮**：生成中时发送按钮变红色方块，点击通过 WebSocket 中止 agent loop
- **Session 标题**：首轮对话自动提取用户输入前 50 字符作为标题，sidebar 优先显示标题
- **文件上传/拖拽**：拖拽文件到聊天区或点击附件按钮上传，支持图片预览，通过 `@fastify/multipart` 处理上传
- **消息重新生成**：最后一条 AI 回复下方显示 Regenerate 按钮，重新发送上一条用户消息
- **浏览器通知**：agent 完成长任务时，若页面不在前台则推送浏览器通知
- **模型切换**：聊天页 header 内嵌模型下拉框，实时切换 LLM 模型无需进入设置
- **会话删除**：sidebar 会话列表 hover 显示删除按钮
- **对话导出**：header 导出按钮，将对话导出为 Markdown 文件下载
- **消息搜索**：Ctrl+F 打开搜索框，实时过滤匹配消息并滚动定位
- **工具执行状态**：agent 调用工具时顶部显示 "Running xxx..." 状态条

### 改进
- **ToolCallCard 主题适配**：从硬编码色值迁移到 CSS 变量，Light/Dark 主题下都正常显示
- **移动端响应式**：sidebar 改为固定定位滑入、输入区/消息区/工具卡片间距收紧、代码块字号缩小

## [0.4.0] - 2026-02-22

### 新功能
- **模型 Failover 链**：配置多个 LLM API Key 时自动按优先级尝试，主 provider 失败后无缝切换备用 provider
  - `FailoverProvider` 包装多个 provider，stream 未开始输出时 failover，已输出则抛出
  - 失败 provider 进入 60 秒冷却期，避免反复重试
  - `embed` 委托给第一个支持嵌入的 provider
  - bootstrap 自动收集所有已配置 provider（Anthropic → OpenAI → Gemini），仅主 provider 使用 `DEFAULT_MODEL`
- **Shell 沙箱**：拦截不可逆破坏性命令（`rm -rf /`、`shutdown`、`format`、`mkfs`、fork bomb、`dd` 写磁盘设备等）
  - 不拦截日常工具命令（`curl|bash`、`sudo`、`pip install`、项目内 `rm -rf ./dist`）
  - `SHELL_SANDBOX=false` 环境变量可完全禁用
- **子 Agent 委派**：`delegate_task` 工具，主 agent 可 spawn 独立子 agent 执行子任务
  - 子 agent 拥有独立上下文（不污染主对话历史）
  - 共享 provider、工具集和 skill，但不可递归委派
  - 适用于并行调研、独立计算、文件生成等可隔离的任务

### 技能
- **yt-dlp 技能**：下载视频/音频（YouTube、Bilibili、Twitter 等），支持格式选择、字幕嵌入、分辨率指定、Bilibili cookies

### 修复
- **auto_send 路径检测**：`FILE_PATH_RE` 支持反斜杠路径和 Unicode 文件名，Windows 上 yt-dlp 输出不再漏检
- **send_file 路径解析**：尝试 `resolve()` 绝对路径兜底，修复相对路径 + Unicode 文件名找不到文件的问题
- **yt-dlp 文件名编码**：输出文件名改用视频 ID（ASCII），避免 emoji/中文标题导致的 Windows 路径问题
- **大文件自动转链接**：WhatsApp/Telegram 发送文件超过 50MB 时，自动改发下载链接（`PUBLIC_URL` 环境变量可配置外部地址）
- **流式消息碎片化**：修复工具执行后首个 token 单字发送的问题——flush 超时改为从 buffer 开始累积时计算，而非从上次发送时计算

### 改进
- **System Prompt 压缩**：精简 ~400 tokens/轮（删除冗余规则、代码块、重复强调）

## [0.3.0] - 2026-02-22

### 新功能
- **TTS 语音回复**：用户发语音时，AI 回复也以语音气泡发送（WhatsApp ptt / Telegram sendVoice）
  - 支持 edge-tts（默认）和 vibevoice 两种 TTS 引擎（`TTS_PROVIDER` / `TTS_VOICE` 环境变量）
  - 自动清理 markdown 格式（粗体、链接、代码块）以适配语音输出
  - 回复超过 500 字自动 fallback 到文字消息
  - TTS 失败时静默降级为文字回复

## [0.2.0] - 2026-02-22

### 新功能
- **对话历史压缩**：超过 20 轮后自动摘要旧对话，减少 token 消耗（`compressAfter` 可配置）
- **Fast Provider 路由**：简短聊天自动路由到轻量模型（`FAST_API_KEY` / `FAST_MODEL` 环境变量配置）
- **MCP 服务器加载**：通过 `data/mcp-servers.json` 配置外部 MCP 工具，支持 stdio 和 HTTP 传输
- **Session 持久化**：会话信息写入 SQLite，重启后可恢复；`MemoryStore` 接口新增 session CRUD 方法
- **SOUL.md 人格设定**：`data/SOUL.md` 定义 AI 名字、性格、称呼、语言和风格，注入 system prompt（`{{soul}}` 模板变量）

### 改进
- **use_skill 不消耗迭代预算**：skill 指令加载不计入 `maxIterations`，实际工作轮次不被挤占
- **maxIterations 提升至 10**：复杂任务（多 skill 组合）不再轻易触发 `max_iterations_reached`
- **工具名 shell → bash**：更准确反映实际使用的 shell 类型
- **工具状态展示优化**（Telegram/WhatsApp）：`use_skill` 静默不推送；bash 显示当前技能名（`⚙️ bash: comfyui`）；搜索显示查询词（`🔍 query...`）
- **对话压缩改用 LLM 真摘要**：调用 LLM 生成 3-5 条 bullet point 摘要（优先用 fastProvider），带缓存，失败回退截断
- **Model 运行时切换**：`PUT /api/config` 修改 model 即时生效，无需重启（provider 切换仍需重启）
- **流式推送重构**（Telegram/WhatsApp）：用事件循环内 buffer flush 替代 `setInterval` 轮询，消除竞态；双触发条件（`\n\n` 段落断点 + 3 秒超时）
- **Shell 输出截断**：双重截断（exec 层 20K + 返回层头尾各 3K），防止长输出撑爆上下文
- **Shell timeout 自动纠正**：检测到 `<1000` 的超时值自动乘以 1000（防止 LLM 传秒而非毫秒）

### 修复
- 修复 Session 删除不级联清理 turns/traces 表，导致数据残留
- 修复 `@types/ws` 缺失导致 gateway typecheck 失败
- 修复对话压缩阈值判断 `>` → `>=`，确保恰好达到阈值时触发压缩
- 修复 `handleDocumentMessage`（语音/文件）缺少 activeSkill 跟踪，导致 `use_skill` 状态泄露、bash 不显示技能名
- 修复 send_file 已发送的文件仍以 markdown 链接重复显示为文本消息（`stripFileMarkdown` 去重）
- 修复工具状态发送后 3 秒计时器未重置，导致首个响应 token 单字吐出

### 清理
- 删除 7 个遗留工具文件（web-search/http-request/python/comfyui/google-*），已被 Skill 系统替代
- 移除 Web UI 中永远为 0 的成本显示（Total Cost 卡片和表格列）

## [0.1.0] - 2026-02-22

首次发布。

### 核心
- Agent 循环（思考-行动-观察）支持流式 LLM 输出
- 多供应商适配：Claude、OpenAI 兼容（DeepSeek/Kimi/Qwen/Doubao）、Gemini
- 视觉模型自动路由（图片输入时切换 visionProvider）
- 上下文管理器：记忆注入 + 技能目录
- 记忆提取器：自动从对话中抽取事实
- 规划器：通过 plan_task 工具分解任务

### 工具
- 核心工具（4个）：shell, file_read, file_write, ask_user
- 条件工具（6个）：send_file, set_reminder, schedule, remember, plan_task, use_skill
- 分层加载：Gateway 加载全部工具，CLI 仅加载核心工具

### 技能
- 13 个技能：browser, coding, comfyui, create-skill, google-calendar, google-tasks, http-request, python-exec, research, weather, web-fetch, web-search, writing
- LLM 自主判断是否需要技能，通过 use_skill 工具 + 系统提示词目录驱动

### 网关
- Fastify HTTP/WS 服务，API Key 认证
- Telegram 机器人（图片/文档/视频/音频/语音）
- WhatsApp 机器人（仅自聊，QR 扫码认证，Baileys）
- 定时任务调度器（cron 提醒）
- REST API：会话、消息、Traces、Token 日志、配置、记忆

### Web 前端
- React 19 + Vite
- 聊天页（流式响应、文件展示）
- Traces 页（LLM/工具执行时间线）
- Token 日志、记忆、设置、API 页面

### 修复
- 修复 MIME 类型文件名泄露 bug：`audio/ogg; codecs=opus` 的参数不再混入文件名
- 语音转文字改用 faster-whisper（`scripts/transcribe.py`），输出到 `data/tmp/`
