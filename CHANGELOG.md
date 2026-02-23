# 更新日志

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
