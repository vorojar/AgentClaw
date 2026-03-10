# 更新日志

## [1.3.4] - 2026-03-10

### 改进
- **HTML 预览从全屏 overlay 改为侧边 panel**：点击预览卡片在右侧打开 panel 而非全屏遮罩，通过 PreviewContext 传递状态，支持切换不同预览文件
- **预览面板支持拖拽调整宽度**：左边缘可拖拽调整宽度（20%-70%），默认 50%，移动端仍全屏显示

### 修复
- **Lone surrogate 导致 Claude API 400 错误（彻底修复）**：之前只在 agent-loop 和 context-manager 清理不够彻底，surrogates 仍可能从 DB 历史、系统提示词等路径泄漏。现在在 Claude provider 的 `convertContent` 层做最后防线，所有发送给 API 的文本（text/tool_result/system prompt）统一清理

## [1.3.3] - 2026-03-10

### 新增
- **编辑消息支持历史截断**：编辑用户消息时，后端截断该时间点之后的对话历史再重发（`DELETE /api/sessions/:id/turns?from=`），而非仅前端截断
- **编辑首条消息自动更新会话标题**：编辑第一条用户消息后，会话名称自动更新为新内容的前 50 字符

## [1.3.2] - 2026-03-10

### 修复
- **file_write 工具容错非 string content**：弱模型（如 doubao）调用 `file_write` 时可能传 Object/Array 而非 String，现在自动 `JSON.stringify` 而不是报错；content 为 undefined 时返回明确的参数缺失提示
- **工具重试限制器误杀修复**：`buildFailKey` 从只用工具名改为包含参数签名，LLM 自我修正后的调用不再被"已失败 2 次"拦截

- **browser_cdp evaluate 输出截断**：限制 evaluate 结果最大 8000 字符，防止错误页面 232KB HTML 灌爆上下文（77K tokens）

## [1.3.1] - 2026-03-10

### 修复
- **任务 QuickAdd 走 LLM 分流**：Web 前端 QuickAdd 改为发送 `{ text }` 格式，经 `captureTask()` LLM 分析自然语言，自动判断 executor 为 agent 或 human（之前所有 QuickAdd 任务都默认为 human）
- **captureTask 返回值序列化**：POST /api/tasks 的自然语言创建路径返回值经 `serializeTask()` 转换，修复前端 NaN 时间和字段名不匹配问题
- **任务执行注入工作目录**：`executeTask()` 的 prompt 中注入 `[工作目录：data/tmp]`，确保 LLM 生成的文件保存到正确位置（之前保存到用户主目录）
- **文件预览 IconDownload 未定义**：`ChatPage.tsx` 中 `IconDownload` 组件未导入导致 md 文件预览崩溃，新增图标并补充导入

## [1.3.0] - 2026-03-09

### 新增
- **多语言支持（i18n）**：Web 前端完整国际化，支持英文/中文切换
  - 集成 `i18next` + `react-i18next`，语言检测优先级：localStorage → navigator.language → en
  - 翻译覆盖全部 13 个页面 + 7 个组件，约 200 个翻译键
  - Settings 页面新增语言切换器（下拉选择 English/中文）
  - 翻译文件：`packages/web/src/i18n/locales/en.json` / `zh.json`

## [1.2.1] - 2026-03-09

### 改进
- **schedule 工具参数描述完善**：message 字段明确标注"仅填写任务指令，不含时间信息"，防止 LLM 将调度时间混入 action
- **Scheduled Tasks 持久化**（`scheduler.ts` + `store.ts` + `database.ts`）：定时任务存入 SQLite `scheduled_tasks` 表，gateway 重启后自动恢复所有 enabled 任务的 cron 调度

### 新增
- **Projects 项目管理系统**（全栈）：类似 Claude.ai Projects，支持将会话按项目分组管理 — 完整 CRUD（创建/查看/编辑/删除）、自定义名称/描述/颜色/指令、会话关联（session.projectId）、删除项目时自动解绑会话（ON DELETE SET NULL）
  - `types/memory.ts`：新增 `Project` 接口和 `MemoryStore` 的 5 个 Project CRUD 方法
  - `memory/database.ts`：新增 `projects` 表 + `sessions.project_id` 迁移 + 索引
  - `memory/store.ts`：SQLiteMemoryStore 实现完整 Project CRUD
  - `gateway/routes/projects.ts`：REST API（POST/GET/PUT/DELETE /api/projects）
  - `web/ProjectsPage.tsx`：卡片网格布局 + 创建/编辑弹窗（12 色选择器 + 指令编辑器）
  - `web/SessionContext.tsx`：`pendingProjectId` 状态，创建会话时关联项目
  - `web/Layout.tsx`：侧边栏新增 Projects 导航链接
- **项目详情页 ChatGPT 风格重构**（`/projects/:id`）：从 Claude.ai 双栏布局改为 ChatGPT 风格的简洁文件夹视图
  - `web/ProjectDetailPage.tsx`：单栏布局 — 项目标题(色点)+描述 → 内联聊天输入框（"在「项目名」中新建聊天"）→ 会话列表（标题 + preview 预览 + 相对时间）
  - `web/Layout.tsx`：侧边栏新增可折叠 **PROJECTS 区域**，列出所有项目（色点 + 名称），点击直接进入详情
  - `web/Layout.tsx`：侧边栏会话右键菜单 **"移至项目"** — 弹出项目列表（含"无项目"选项），调用 PATCH /api/sessions/:id 移动
  - `memory/store.ts`：`listSessions()` 新增 `preview` 字段 — 子查询 turns 表获取首条用户消息（截取 100 字符）
  - `gateway/routes/sessions.ts`：`serializeSession` 返回 `preview` 字段
  - `web/api/client.ts`：`SessionInfo` 新增 `preview?: string | null`
  - `web/ProjectDetailPage.css`：移除 `max-width: 800px` 限制，改为全宽 `padding: 24px 32px`
  - `web/Layout.tsx`：侧边栏项目区优化 — 移除 Projects 导航链接，改用折叠式项目列表 + 「新项目」按钮
- **项目管理简化重构** — 删除 ProjectsPage 列表页，侧边栏成为唯一入口
  - 删除 `web/ProjectsPage.tsx` 和 `/projects` 路由，保留 `/projects/:id` 详情页
  - `web/SessionContext.tsx`：项目状态提升为共享 context（`projects`, `refreshProjects`, `handleCreateProject`, `updateProjectLocally`），解决编辑后侧边栏不同步问题
  - `web/Layout.tsx`：「New Project」直接弹出极简创建弹窗（仅 Name 字段），无需跳转页面
  - `web/ProjectDetailPage.tsx`：标题区域支持 inline rename（hover 显示编辑按钮），改名后侧边栏实时同步
  - 弹窗去掉 Description / Color / Instructions 字段，只保留 Name
  - 侧边栏文案统一为英文（Projects / New Project / Move to Project）
  - `web/ChatPage.tsx`：聊天页顶部标题显示「项目名 / 会话名」面包屑（项目名可点击跳转详情页）
- **会话统一操作菜单**（`web/Layout.tsx` + `global.css`）
  - 合并原右键菜单和 X 删除按钮为统一的 "..." 菜单（`IconMoreHorizontal`）
  - 菜单项：**Rename**（内联重命名）、**Move to Project**（二级子菜单，hover/click 展开）、**Delete**（红色危险样式）
  - 桌面端：鼠标 hover 会话时才显示 "..."；移动端：仅当前激活会话显示 "..."
  - 移除右键菜单中的 "No Project" 选项
  - `web/ChatPage.tsx`：聊天详情页右上角 "..." 菜单同步统一 — 移除 Export，改为 Rename / Move to Project（二级子菜单）/ Delete
- **工具调用折叠组**（`web/ChatPage.tsx` + `ChatPage.css`）
  - 当一条消息中已完成的工具调用 ≥3 个时，自动折叠为一行摘要：`✓ 7 tool calls (web-search, bash ×4, web-fetch, claude_code) ▶`
  - 点击展开查看所有工具调用详情，展开后顶部显示 "▼ Collapse" 可重新折叠
  - 合并连续的无文本 assistant+tool turn 为单个 DisplayMessage（`historyToDisplayMessages` 逻辑），解决数据库逐条存储导致每个 DisplayMessage 只有 1 个 tool call 无法触发折叠的问题
  - 无耗时数据时隐藏 duration 显示（旧数据兼容）

## [1.2.0] - 2026-03-08

### 新增
- **WeCom（企业微信）智能机器人渠道**（gateway/wecom）：使用 `@wecom/aibot-node-sdk` WebSocket 长连接模式接入（无需公网 IP）— 自动认证 + 心跳 + 指数退避重连、接收消息（text/image/voice/file/mixed，图片文件 SDK 内置 AES 解密）、流式回复（replyStream，支持 Markdown）、主动推送（sendMessage，支持 broadcast）、进入会话欢迎语、`/new` 会话重置、ask_user 5 分钟超时、会话持久化
- **social_post 工具**（tools/social-post）：一次调用发帖到 X/小红书/即刻，LLM 零参与浏览器操作。内置字数限制校验、自动截图确认、auto_close 标签页。支持 `images` 参数附加图片（URL 或本地路径，最多 4 张），自动下载转 base64 + ClipboardEvent 粘贴
- **浏览器扩展 click 文本选择器**：`cmdClick` 新增 `text=xxx` 格式，按可见文本匹配元素并点击（TreeWalker 精确匹配 + innerText fallback）
- **paste_image 智能去重**：paste → drop → file_input 三级 fallback，仅在前一级未被处理时才尝试下一级，避免重复上传
- **QQ Bot 富媒体消息支持**（gateway/qqbot）：处理 attachments 中的语音、图片、视频、文件，自动下载保存到 `data/uploads/`，兼容 QQ 省略协议的 URL（`//` 前缀）。语音消息在框架层自动调用 `transcribe.py` 转文字，LLM 直接收到 `[用户语音转文字: xxx]`
- **语音转录脚本增强**（scripts/transcribe.py）：自动检测 SILK_V3 格式（QQ/微信语音）→ pilk 解码为 PCM → WAV → faster-whisper 转录；强制 UTF-8 输出修复 Windows GBK 乱码
- **QQ Bot `/new` 命令**（gateway/qqbot）：发送 `/new` 或 `新会话` 重置会话
- **QQ Bot 语音回复**（gateway/qqbot）：收到语音消息后，回复也用 TTS 语音（base64 上传 → 富媒体消息），文本过长时 fallback 为文字
- **Telegram 语音框架层转录**（gateway/telegram）：语音消息在框架层自动调 transcribe.py，LLM 直接收到文字，省去 LLM 调 shell 转录的 ~50K tokens 和 ~60s 延迟
- **MAX_ITERATIONS 环境变量**（gateway/bootstrap）：Agent loop 最大迭代次数可通过 `MAX_ITERATIONS` 环境变量配置（默认 15）
- **浏览器登录态持久化**：Chrome 扩展新增 `save_login` action（`chrome.cookies` + `localStorage` 导出）→ gateway 自动保存为 Playwright storageState 格式 → `browser_cdp` 工具 `load_state` 加载。完整链路：主浏览器登录 → 保存 → Playwright 无人值守复用登录态
- **TaskManager 任务管理引擎**（core/task-manager）：完整的任务生命周期管理 — 自然语言捕获（LLM 解析）→ 分诊（agent/human）→ 队列调度 → 自动执行 → 决策请求 → 每日简报，60s 扫描器自动处理 queued 任务
- **Automations API**（gateway/routes/tasks）：新增 `/api/tasks/scheduled` GET/POST/DELETE 路由，对接 TaskScheduler 实现定时任务的增删查
- **Tasks 页面重构**（web/TasksPage）：5 个标签页（Today/All Tasks/Calendar/Decisions/Automations）、Task Runner Stats 卡片、QuickAdd 快速添加、Decision Queue 决策队列、Calendar 视图

### 改进
- **待办查询双源合并**（system-prompt）：系统提示词强制要求查待办/事项时同时查本地任务（update_todo）和 Google 端（gws-tasks/gws-calendar），合并结果统一回复
- **输入框图片粘贴**（web/ChatPage）：textarea 支持 Ctrl+V 粘贴图片，自动提取剪贴板中的图片文件加入待上传列表，复用已有的文件上传流程
- **语音输入 MediaRecorder fallback**（web/ChatPage）：不支持 Web Speech API 的浏览器（手机端）自动使用 MediaRecorder 录音，录完后作为音频附件发送；显示录音时长计时器，支持 webm/mp4 格式自适应
- **图片 vision 修复**（core/agent-loop + context-manager）：修复用户发送图片时 LLM 无法"看到"图片的 bug — 之前 DB 存储的是纯文本（丢弃 base64），导致 buildContext 重建消息时图片缺失，LLM 只能通过 OCR 工具间接识别。现在 DB 存储 ContentBlock[] JSON（image block 用 filePath 引用替代 base64，避免 DB 膨胀），turnToMessage 时从磁盘加载还原
- **SQLite 任务表迁移**（memory/database）：自动检测旧 CHECK 约束并重建，新增 `executor`/`deadline`/`parent_id` 索引和 `metadata` 列
- **任务状态扩展**（memory/store）：新增 `triaged`/`blocked` 状态统计，priority 排序支持 `urgent`/`normal`
- **每日简报定时推送**（gateway/index）：Cron job 每天定时广播任务简报（默认 09:00），有待处理任务才发送，发送时间可在 Tasks 页面配置
- **决策提醒机制**（gateway/heartbeat）：heartbeat tick 自动检查 waiting_decision 任务并广播提醒，不消耗 LLM token
- **Settings KV 存储**（memory/database+store）：新增 `settings` 表和 `getSetting`/`setSetting` 方法，支持运行时配置持久化
- **Tasks 页面样式优化**（web/TasksPage.css）：Tab 选中改用 box-shadow 避免浏览器默认 focus 圆角、Task Runner Stats 独立分区（顶部分割线 + 间距）、移除 QuickAdd 多余 border-top、Daily Brief 时间选择器
- **Daily Brief Save 按钮优化**（web/TasksPage）：Save 按钮仅在时间被修改后才显示，保存成功后短暂显示 "Saved ✓" 然后消失

## [1.1.0] - 2026-03-08

### 新增
- **QQ 机器人渠道**（gateway/qqbot）：接入 QQ 开放平台官方 Bot API v2，支持 C2C 私聊和群聊 @消息，WebSocket 网关连接 + 心跳 + 断线重连，被动回复跟踪（5 分钟 TTL），环境变量 `QQ_BOT_APP_ID` + `QQ_BOT_APP_SECRET` 配置

## [1.0.3] - 2026-03-08

### 修复
- **API 请求头覆盖**（web/client）：`renameSession()` 传入的 headers 会覆盖 `request()` 构建的 Authorization 头，改为仅由 `request()` 统一管理 headers
- **promptUser 超时保护**（gateway/ws+dingtalk+feishu）：WebSocket、钉钉、飞书的 `promptUser` 添加 5 分钟超时，防止 Promise 永远挂起导致 agent loop 卡死

## [1.0.2] - 2026-03-08

### 修复
- **WebSocket 自动重连增强**：移除 8 次重试上限改为无限重试；添加 visibilitychange/online 事件监听，切回标签页或网络恢复时立即重连
- **LLM 流异常捕获**（core/agent-loop）：`for await` 流式迭代添加 try-catch，网络断开时 token 统计和 trace 仍能保存
- **上下文截断污染修复**（core/context-manager）：截断工具结果前先浅拷贝消息数组，避免直接修改原始 Message 对象导致重复截断
- **WebSocket error 事件处理**（gateway/ws）：添加 `socket.on("error")` 防止未处理错误导致进程崩溃
- **promptUser 超时保护**（gateway/telegram+whatsapp）：5 分钟超时自动 resolve，防止 Promise 永远挂起
- **eventStream 资源泄漏**（gateway/ws）：客户端断开后 `aborted` 标记中止 for-await 循环，停止无意义的 LLM/工具调用
- **taskDecisions 内存泄漏**（gateway/index）：Map 超过 1000 条时自动清空
- **语音输入过期闭包**（web/ChatPage）：toggleVoice 改用 ref 获取最新 inputValue
- **Object URL 泄漏**（web/ChatPage）：页面卸载时 revoke 所有预览 URL
- **WebSocket onerror 处理**（web/client）：连接错误时强制触发 close 流程
- **FTS5 索引事务保护**（memory/store）：主表与 FTS5 的 insert/update/delete 用 transaction 包裹
- **向量相似度维度修复**（memory/store）：不同维度的 embedding 改为截断到最短维度而非 padding 零

## [1.0.1] - 2026-03-07

### 新增
- **单元测试覆盖**：为 memory、tools、gateway 三个包新增测试套件，共 152 个用例全部通过
  - `memory`：SQLite 存储层（会话/轮次/记忆 CRUD、FTS5 全文搜索、向量嵌入、Token 日志、Traces）— 63 个用例
  - `tools`：工具注册表、Shell 沙箱验证（18 条安全规则）、createBuiltinTools 分层加载 — 54 个用例
  - `gateway`：HTTP 认证中间件（Bearer/query 参数/免认证路由/SPA 路由）、路由集成测试（Session/Config/Agents）— 35 个用例

## [1.0.0] - 2026-03-06

### 新增
- **多 Agent 系统**：支持创建、编辑、删除自定义 Agent，每个 Agent 拥有独立的 Soul（人格/行为指令）、可选的 Model、Temperature、Max Iterations、Tools 过滤
- **5 个预设 Agent**：AgentClaw（默认）、Coder、Writer、Analyst、Researcher，开箱即用
- **Agent 管理页面**：Web UI 新增 `/agents` 路由，可视化管理所有 Agent 配置
- **Agent 文件系统存储**：配置存储在 `data/agents/<id>/`（config.json + SOUL.md），纯文件系统方案，可纳入 git 管理
- **会话级 Agent 选择**：创建会话时可指定 agentId，ChatPage 支持选择 Agent 发起新会话

### 改进
- **Agent 表单简化**：移除 ID 字段（从名称自动生成），Model 空时 placeholder 显示系统默认模型名，Temperature 和 Max Iterations 收到 Advanced 折叠区
- **UI 布局优化**：API 入口从侧栏底部移入 More 菜单；主题切换按钮与 Settings 并排；所有页面都显示 Recent 会话列表
- **Orchestrator 多 Agent 支持**：根据 Agent 配置注入 soul 到系统提示词、覆盖 model/temperature/maxIterations、过滤 tools

### 修复
- **Agent soul 注入失败**：当系统提示词不含 `{{soul}}` 占位符时 soul 被丢弃，现已修复为自动追加
- **gitignore 遗漏 SQLite 文件**：添加 `*.db`、`*.db-shm`、`*.db-wal` 到 .gitignore

## [0.9.9] - 2026-03-06

### 修复
- **WebUI 图片上传路径丢失**：上传图片与 Telegram/WhatsApp 统一存储到 `data/uploads/`，文本格式与 Telegram 一致（`[用户发送了图片，已保存到 {path}]`），不再经过 base64→traceTmpDir 重建。comfyui 等需要文件路径的工具可直接使用
- **comfyui 图片路径兜底**：`comfyui.py` 新增 `resolve_image_path`，即使 LLM 传错路径，也会在 `--output-dir` 中按文件名查找
- **textarea 聚焦边框**：聊天输入框聚焦时不再显示全局 focus 样式（border + box-shadow）
- **后台任务会话污染侧边栏**：Task Runner 等后台任务创建的会话不再出现在 Recent 列表

### 新增
- **Task Runner 统计卡片**：Tasks 页显示当日执行次数、LLM 调用数、Token 消耗、总耗时

## [0.9.8] - 2026-03-06

### 改进
- **全栈代码重构**：44 个文件，净减 ~800 行。提取公共工具函数（`gateway/utils.ts`、`tools/resolve-path.ts`、`web/utils/format.ts`），消除跨包重复代码；简化 WhatsApp 适配器、Claude/Gemini provider、SQLite memory store 等模块；统一类型定义和错误处理模式

## [0.9.7] - 2026-03-06

### 改进
- **Serene Sage 主题**：全站换肤为鼠尾草绿暖色调主题，Light 模式（暖白 #FAFAF7 + 橄榄绿强调色）和 Dark 模式（深橄榄 #1A1D17 + 亮鼠尾草绿）双套色板。替换 `global.css` 两套 CSS 变量 + 12 个页面级 CSS/TSX 文件中的 40+ 处硬编码颜色，统一使用语义化变量（`--accent-subtle-bg`、`--error-subtle-border`、`--mcp-color`、`--text-on-accent` 等）。圆角从 8px 提升至 10px，input:focus 增加 box-shadow 呼吸感，page-body 留白加大

## [0.9.6] - 2026-03-06

### 新增
- **Google Tasks 统一看板**：`/tasks` 页面重写，Google Tasks 作为唯一数据源。看板显示待办/已完成任务，支持创建、完成、重新打开、删除，所有操作直接同步到 Google Tasks
- **Google Calendar 日程展示**：`/tasks` 页面下方展示未来 14 天的 Google Calendar 事件，按日期分组显示时间、标题、地点
- **Google Tasks/Calendar 后端 API**：新增 `/api/google-tasks`（CRUD 代理到 gws CLI）和 `/api/google-calendar`（事件列表），通过 `gws` CLI 工具桥接 Google API
- **Task Runner 智能执行**：重构后台任务执行器，从 Google Tasks 获取待办，LLM 自动判断任务可执行性（区分"查天气"类 AI 可执行 vs "买牛奶"类人类任务），可执行任务自动完成并标记 Google Tasks completed
- **Automations 面板**：定时任务（Cron Jobs）管理从 Settings 迁移至 `/tasks` 页面，更名为 Automations，与 Tasks + Calendar 统一展示

### 移除
- 旧版本地 SQLite 任务看板（human/bot assignee 模式），统一由 Google Tasks 接管
- Settings 页中的 Scheduled Tasks 面板（已迁移到 Tasks 页的 Automations 区域）

## [0.9.5] - 2026-03-05

### 新增
- **Google Workspace CLI (gws) 集成**：通过 Skill 方式接入 gws CLI，新增 5 个 Skill——gws-calendar、gws-tasks、gws-gmail、gws-drive、gws-sheets，覆盖日历、待办、邮件、网盘、电子表格全场景。相比 MCP 方式（204 个工具定义）几乎零 token 开销
- **gws MCP 配置示例**：`data/mcp-servers.example.json` 新增 gws MCP server 配置，供需要 MCP 方式的用户参考

## [0.9.4] - 2026-03-05

### 新增
- **Settings 定时任务管理**：Settings 页新增 Scheduled Tasks 可折叠面板，支持查看、创建、删除定时任务，带二次确认删除和 inline 表单

## [0.9.3] - 2026-03-05

### 新增
- **频道管理面板**：`/channels` 页面，运行时控制 Telegram/WhatsApp/钉钉/飞书/WebSocket 五个频道的启停。每张卡片显示频道图标、状态指示灯、连接时长、错误信息，toggle 开关可实时 start/stop。5 秒自动刷新，未配置频道灰显禁用
- **任务看板**：`/tasks` 页面，Todo / In Progress / Done 三列看板，支持新建、编辑、删除任务，优先级颜色标记（高/中/低），指派人（human/bot）标签
- **子代理可视化**：`/subagents` 页面，展示所有子代理的运行记录（持久化到 SQLite）。状态筛选芯片（All/Running/Completed/Failed/Killed），可展开卡片显示目标、模型、token 用量、工具列表、迭代次数、耗时。运行中的子代理带脉冲动画
- **ChannelManager 统一管理**：`packages/gateway/src/channel-manager.ts`，封装五个频道的生命周期管理（start/stop/list/broadcast），替代 index.ts 中分散的 bot 初始化逻辑，代码大幅精简

### 改进
- **Settings 页精简**：移除定时任务管理，新增 Provider/Model 系统信息显示
- **数据库新增两张表**：`tasks`（任务管理，含优先级/截止日/指派人/标签）和 `subagents`（子代理历史记录，含 token/工具/迭代数据）
- **Store CRUD 扩展**：新增 `addTask/updateTask/deleteTask/listTasks/getCalendarItems/addSubAgent/updateSubAgent/listSubAgents/getSubAgent` 方法
- **4 组后端 API**：`/api/todos`（任务 CRUD）、`/api/calendar`（日历聚合）、`/api/subagents`（子代理查询）、`/api/channels`（频道控制）
- **侧边栏导航分层**：Chat + Tasks 为主导航（始终可见），Channels/Subagents/Memory/Traces/Token Logs/Skills 收入可折叠 "More" 组，默认折叠，当前路径在组内时自动展开
- **Task Runner 自动执行**：后台每 15 秒扫描 `assignee=bot, status=todo` 的任务，自动创建 session 执行，完成后标记 Done 并广播结果。失败自动重置为 Todo 下次重试
- **任务 Assignee 字段**：TaskForm 新增 Human/Bot 选择器，卡片显示 assignee 标签，`listTasks` 支持 assignee 过滤

## [0.9.2] - 2026-03-05

### 修复
- **工具停止机制**：用户点击"停止"后，正在执行的 `claude_code`/`bash` 子进程无法终止。新增 `AbortSignal` 传导链——`agent-loop.stop()` → `AbortController.abort()` → 工具监听信号 → 杀死子进程。Windows 使用 `taskkill /F /T` 确保进程树完全终止

### 改进
- `ToolExecutionContext` 新增 `abortSignal?: AbortSignal` 字段，所有工具均可感知用户停止操作
- `SimpleAgentLoop` 在 `stop()` 时触发 `AbortController.abort()`，信号传导到正在执行的工具
- `claude_code` 工具：监听 abort 信号，立即杀死 Claude CLI 子进程
- `bash` 工具：监听 abort 信号，立即杀死 shell 子进程
- **Traces 页 token 显示**：卡片头部从合计 `N tok` 改为 `tokensIn↑ tokensOut↓` 分开显示，与展开后格式一致，方便按不同单价计算成本

## [0.9.1] - 2026-03-05

### 新增
- **file_edit 工具**：精确字符串替换编辑文件，比 file_write 更安全——只修改匹配部分，其余内容不变。支持唯一匹配校验（多匹配时报错要求更多上下文）、`replace_all` 全量替换、空 old_string/相同值防御
- **glob 工具**：按文件名模式搜索文件（`**/*.ts`、`*.json` 等），基于 `fast-glob`。自动忽略 node_modules/dist/.git，支持 max_results 限制，替代 `shell('find ...')`
- **grep 工具**：按正则搜索文件内容，返回匹配行+文件路径+行号。支持大小写忽略、上下文行、文件类型过滤，自动跳过二进制/lock 文件，替代 `shell('grep ...')`
- **子代理 explore 模式**：`subagent spawn` 新增 `mode: "explore"` 参数，只读子代理仅可使用 file_read/glob/grep/web_fetch/web_search/shell 六个工具，专用系统提示词，搜索/阅读任务节省 token

### 修复
- **新工具导出缺失**：`packages/tools/src/index.ts` 顶层入口未 re-export `fileEditTool`/`globTool`/`grepTool`，外部包通过 `@agentclaw/tools` 导入时取不到这三个工具

### 依赖
- 新增 `fast-glob` ^3.3.3 用于 glob 工具

## [0.9.0] - 2026-03-05

### 新增
- **P0 子代理编排**：`subagent` 工具 + `SimpleSubAgentManager`。主 agent 可派生独立子 agent 并行处理任务（spawn/result/kill/list），子代理拥有独立 agent-loop 和会话上下文，不干扰主会话。类型定义 `packages/types/src/subagent.ts`
- **P1 Docker 沙箱**：`sandbox` 工具，在 Docker 容器内安全执行命令。默认 `node:22-slim` 镜像，`--rm` 自动清理，`--memory=512m --cpus=1` 资源限制，超时控制，Docker 可用性缓存检测，Windows 路径自动转换
- **P2 浏览器 CDP 直连**：`browser_cdp` 工具，通过 Playwright `connectOverCDP()` 直连 Chrome（专用 profile `~/.agentclaw/browser/`）。支持 navigate/snapshot/click/type/screenshot/tabs/evaluate/wait/close，DOM 快照自动标记交互元素 ref ID
- **P3 混合记忆搜索**：FTS5 全文索引 + BM25 评分 + 向量语义 + 时间衰减 + MMR 去重，四路融合提升记忆召回。权重可配置（bm25=0.2, vector=0.4, recency=0.15, importance=0.25），`escapeFtsQuery()` 安全转义
- **P4 工具执行钩子**：`ToolHooks`（before/after）+ `ToolPolicy`（allow/deny）类型定义，`ToolHookManager` 管理器，agent-loop 集成策略检查和钩子执行链
- **P4 预置钩子**：`file_write` 后自动 Biome lint（.ts/.js 文件）、`shell` 非零 exit code 自动警告。orchestrator 启动时注册

### 修复
- **Browser CDP ESM 兼容**：`require("node:fs")` 改为顶层 `import { existsSync }`，修复 ESM 构建中 Dynamic require 错误

### 文档
- AgentClaw vs OpenClaw 对比文档：基于源码核查的准确对比（能力 7:7 持平 + Token 效率分析 + 代码量 27K vs 1M 规模分析）
- ARCHITECTURE.md：新增子代理/沙箱/CDP浏览器/混合记忆/工具钩子/钉钉飞书/FTS5 Schema
- ROADMAP.md：新增 Phase 11（Agent Autonomy）、更新竞品对比（沙箱/IM/记忆反超）、更新 Current Focus
- README.md：新增 sandbox/subagent/browser_cdp 工具、钉钉飞书接入、安全执行/子代理编排描述
- CLAUDE.md：更新各包职责描述（tools/core/memory/gateway）
- task.md：标记 9.1/9.4 完成、新增 v0.9.0 五大能力升级清单
- LESSONS.md：新增 v0.9.0 踩坑（ESM require/schedule 误调/Playwright API 变化）

### 依赖
- 新增 `playwright-core` 用于浏览器 CDP 直连

## [0.8.30] - 2026-03-04

### 新增
- **钉钉机器人**：`packages/gateway/src/dingtalk.ts`，基于 `dingtalk-stream-sdk-nodejs` Stream 模式（无需公网 IP）。支持文本消息收发、会话管理、ask_user 交互、文件链接推送、OpenAPI 群聊/单聊广播。环境变量 `DINGTALK_APP_KEY` + `DINGTALK_APP_SECRET`
- **飞书机器人**：`packages/gateway/src/feishu.ts`，基于 `@larksuiteoapi/node-sdk` WebSocket 模式（无需公网 IP）。支持文本消息收发、@bot 提及过滤、会话管理、ask_user 交互、文件链接推送、主动消息广播。环境变量 `FEISHU_APP_ID` + `FEISHU_APP_SECRET`
- 两个 bot 均已集成到 gateway 启动流程（env 按需启动）、broadcastAll 统一广播、优雅关停

## [0.8.29] - 2026-03-04

### 新增
- **OpenAI Compatible Embedding**：`OpenAICompatibleProvider.embed()` 方法，调用标准 `/v1/embeddings` 端点，支持 OpenAI、DeepSeek 等兼容 API。可通过 `OPENAI_EMBEDDING_MODEL` 环境变量或构造参数 `embeddingModel` 配置模型名
- **Embedding 质量 Benchmark**：`scripts/embedding-benchmark.ts` 对比脚本，评估 Recall@3 和 MRR 指标。实测：SimpleBagOfWords 28%/36% → Volcano doubao-embedding 83%/95%

### 修复
- **Volcano Embedding 响应解析**：修复 `volcano-embedding.ts` 中 multimodal endpoint 响应格式（`data.embedding` 而非 `data[0].embedding`），doubao-embedding-vision 模型现在正常工作

### 改进
- **文档同步**：更新 `docs/ARCHITECTURE.md`（修正 SkillRegistry/ContextManager/工具分层/skills schema/部署架构/Web Search 共 6 处过时描述）和 `docs/ROADMAP.md`（修正 Token Optimization 矛盾描述，补充 Phase 10 工程质量章节，更新 Current Focus）

## [0.8.28] - 2026-03-04

### 新增
- **Vitest 测试框架**：安装 vitest 4.x，配置 turbo test 任务。core 包 29 测试（agent-loop + orchestrator），providers 包 16 测试（openai-compatible 流式/非流式/工具调用），共 45 个测试全部通过
- **Sentry 错误监控**：gateway 端 `@sentry/node` 条件初始化（SENTRY_DSN），Fastify 全局错误处理器 + WS/Telegram/定时任务关键 catch 点。web 端 `@sentry/react` ErrorBoundary（VITE_SENTRY_DSN）。未配置 DSN 时零开销
- **API 路由输入校验**：所有 13 个 REST API 端点添加 Fastify 原生 JSON Schema 校验（params、body、querystring），替代手动 if 校验
- **Gateway 优雅关停**：SIGTERM/SIGINT 信号处理 + 10s 超时强制退出；新增 `/health` 健康检查端点（无需认证）

### 改进
- **knip 死代码清理**：删除 5 个未引用文件（create-skill.ts, ModelSelector, SearchDialog），移除 3 个未使用 API 函数，9 个 export 降级为内部 interface，移除 root package.json 冗余依赖。knip 零报告通过
- **Biome 代码格式化**：接入 @biomejs/biome 2.4.5（formatter + linter），全量格式化 52 个文件，0 errors / 194 warnings
- **GitHub Actions CI**：push/PR to master 自动运行 lint → build → typecheck → test

## [0.8.27] - 2026-03-04

### 新增
- **Office/表格文件预览**：docx、pptx 通过 LibreOffice headless 转 PDF 预览（mammoth 作为 docx 降级方案），xlsx/xls/csv 通过 SheetJS 转 HTML 表格预览；复用现有 HtmlPreviewCard + iframe 架构，体验与 Markdown 预览一致
- **预览模块独立**：从 `server.ts` 提取 `/preview/*` 路由到 `routes/preview.ts`，统一管理 md/docx/xlsx/csv/pptx 转换器，含 LRU 缓存（50 条）和 20MB 大小限制
- **LibreOffice 并发控制**：soffice headless 在 Windows 上只允单实例，添加 mutex 序列化 + 自动清理残留 soffice.bin 进程，避免"等待打印机"弹窗
- **预览加载动画**：HtmlPreviewOverlay 添加 loading spinner，LibreOffice 转换期间显示加载状态

### 修复
- **xlsx/csv 表格左边距过大**：wrapHtml 默认 `max-width: 860px; margin: 0 auto` 导致宽表格居中留白，表格预览改用 `max-width: none; padding: 12px` 全宽显示

## [0.8.26] - 2026-03-02

### 改进
- **web_fetch SPA 自动降级增强**：新增已知 SPA 域名列表（x.com/zhihu/bilibili/weibo 等 18 个），命中时直接走 Playwright；Playwright 降级新增 `--scroll` 重试；通用阈值从 500→1500 chars。x.com 推文抓取从 7 轮 LLM 降至 3 轮，token 节省 50-67%
- **send_file autoComplete**：send_file 成功后自动结束 agent-loop，省去最终的"已完成"回复轮（典型省 ~14K tokens 输入）
- **上下文膨胀控制**：agent-loop 多轮迭代时，只保留最近 2 条 tool result 完整内容，更早的截断到 500 chars
- **系统提示词优化**：新增规则"web_fetch 返回内容已是 Markdown，直接保存不要改写"+"同一轮输出多个工具调用"
- **删除 web-fetch 技能**：功能已被内置 web_fetch 工具完全覆盖（SPA 域名列表 + Playwright 自动降级 + scroll 重试），删除 SKILL.md 避免 LLM 绕开内置工具走低效手动流程；保留 scripts/fetch.py 供内置工具调用
- **Playwright 直接 scroll**：SPA 降级时直接带 `--scroll` 一次抓取，省去"先不 scroll → 内容不够 → 再 scroll"的两次 Playwright 启动开销（典型省 10-15s）
- **Telegram 流式输出（sendMessageDraft）**：利用 Bot API 9.5 新增的 `sendMessageDraft` 方法，LLM 生成过程中消息在原地实时更新（类似 ChatGPT 网页端），替代之前分段 sendMessage 刷屏的方式；tool_call 状态也实时显示在 draft 中；300ms 节流防止 API 过载；需要官方 Telegram 客户端支持

### 新增
- **Markdown 文件预览**：新增 `/preview/*` 路由，服务端用 `marked` 将 .md 文件渲染为带样式的 HTML 页面（含下载按钮、代码高亮、暗色模式适配）；Web UI 中 .md 文件链接点击后在 overlay 中渲染预览，体验与 .html 文件一致
- **Claude Code 执行过程透明化**：claude_code 工具执行期间，实时推送 Claude Code 的每一步操作（Read/Edit/Bash/Grep 等）到前端和 Telegram；Web UI 的 tool_call 卡片下方显示进度行（最多 20 行，自动滚动）；工具完成后进度行自动隐藏

### 修复
- **Markdown 预览 `/preview/` 路由浏览器空白页**：`@fastify/compress` 的 Brotli 压缩对动态生成的 HTML 响应产生 `content-length: 0`（curl 正常因为不发 Accept-Encoding）。使用 `reply.hijack()` + `reply.raw` 绕过 Fastify reply 管道，直接写入原始 HTTP 响应
- **Windows 下 Claude Code/Playwright 弹出黑色终端窗口**：`spawn`/`execFile` 缺少 `windowsHide: true`，子进程会弹出可见的 cmd 窗口后又消失。claude-code 和 web-fetch 的 Playwright 调用补上此参数
- **Telegram 发送文件显示为 DAT**：`InputFile` 构造时未传文件名，Telegram 无法识别扩展名，所有非图片/视频文件显示为"document xxx bytes DAT"。补传 `filename` 参数修复

### 修复
- **file_write 相对路径修复**：`file_write` 传入相对路径时自动解析到 `data/tmp/{traceId}/` 会话工作目录，而非项目根目录；配合 `sendFile` 自动复制兜底，彻底修复 Web UI `/files/` 下载 404
- **send_file 相对路径修复**：send_file 同样支持 workDir 解析，优先在会话目录查找文件
- **REST /chat 支持 sendFile**：REST API 的 `/api/sessions/:id/chat` 端点补充 sendFile 上下文，send_file 工具不再报 "not available"
- **移除多余的 `data/temp/` 目录**：文件服务统一使用 `data/tmp/`，清理 server/ws/claude-code 中的 temp 引用

### 修复
- **file_write 相对路径修复**：`file_write` 传入相对路径时自动解析到 `data/tmp/{traceId}/` 会话工作目录，而非项目根目录；配合 `sendFile` 自动复制兜底，彻底修复 Web UI `/files/` 下载 404
- **移除多余的 `data/temp/` 目录**：文件服务统一使用 `data/tmp/`，清理 server/ws/claude-code 中的 temp 引用

### 改进
- **Telegram 消息处理去重**：提取 `processAndReply()` 共享管线，text/file/photo 三条处理路径共用会话管理、typing indicator、工具上下文、事件流处理、错误处理逻辑，文件从 752 行精简到 515 行（-31%）

## [0.8.25] - 2026-03-02

### 新增
- **跨通道会话同步**：Telegram/WhatsApp 消息处理完成后向 Web UI 广播 `session_activity` 事件，会话列表自动刷新，无需手动 F5

### 改进
- **健康检查静默恢复**：服务恢复（fail→ok）不再广播通知，仅静默更新系统提示词；只有新增故障（ok→fail）才通知用户，避免 Chrome 扩展等不稳定服务反复刷屏

## [0.8.24] - 2026-03-02

### 新增
- **Browser Accessibility Snapshot**：`get_content` 从 raw `innerText` 升级为结构化无障碍快照
  - 交互元素自动标记 ref ID：`[e1] button "Submit"`, `[e2] link "Home" → /`
  - 标题转为 markdown 格式（`# Title`），图片显示 alt 文本
  - 隐藏元素、script/style/svg 自动跳过
  - 典型页面输出从 ~20K 压缩到 ~4-5K 字符，token 节省 70-80%
- **Ref ID 选择器**：`click`/`type`/`wait_for` 支持 ref ID（如 `e5`），自动转为 `[data-ac-ref="e5"]` CSS 选择器，原有 CSS 选择器完全兼容

## [0.8.23] - 2026-03-02

### 新增
- **Health-check 框架**：gateway 启动时自动检测 5 项服务（Google OAuth / IMAP / SearXNG / Chrome 扩展 / ComfyUI），每小时定时复检，状态变化时通过 Telegram/WhatsApp 通知用户；异常项注入系统提示词，LLM 自动知晓哪些能力不可用
- **Browser scroll action**：浏览器技能新增 `scroll` 动作（down/up/top/bottom），支持懒加载页面（知乎专栏等）滚动触发内容加载
- **Browser reload action**：新增 `reload` 命令，支持远程重载 Chrome 扩展
- **Claude Code 开发 hooks**：
  - `auto-build.ps1`：编辑 TS 源文件后自动增量构建（30s 防抖）
  - `check-changelog.ps1`：git commit 前检查 CHANGELOG.md 是否已 staged
  - `auto-restart-gateway.ps1`：构建完成后自动重启 gateway
  - `reload-browser-ext.ps1`：编辑扩展文件后自动重载 Chrome 扩展

### 改进
- **web_fetch 智能瀑布策略**：SPA 页面自动回退 Playwright 渲染（无需 LLM 多轮试错）；登录墙关键词检测（安全验证/请登录等），命中时明确提示使用 browser 技能；metadata 新增 `strategy` 字段标记采用的策略
- **get_content batch 截断**：浏览器技能 batch 模式下 get_content 输出上限从 500 → 5000 字符，避免内容被截断
- **orchestrator.updateSystemPrompt()**：支持运行时动态更新系统提示词（health-check 刷新用）
- **browser-ext.ts 导出 isExtensionConnected()**：供 health-check 检测扩展连接状态

## [0.8.22] - 2026-03-02

### 新增
- **web_search 内置工具**：SearXNG + Serper 搜索直接作为核心工具注册，LLM 无需走 use_skill 即可搜索，省掉一轮调用（~2-3s）

### 改进
- **Skill description 精确化**：明确 browser/web-fetch/web-search 三者职责边界，避免 LLM 混淆选择
  - browser：仅用于需要登录态或交互操作（点击/输入/截图）
  - web-fetch：仅用于需要 JS 渲染的页面（SPA/懒加载）
  - web-search：标注为备用，优先使用内置 web_search 工具
- **comfyui Skill**：补充前置条件说明（需 ComfyUI 运行在 localhost:8000）
- **imap-smtp-email Skill**：列出所需环境变量（IMAP_*/SMTP_*）

## [0.8.21] - 2026-03-02

### 新增
- **web_fetch 注册为核心工具**：web_fetch 从未注册状态升级为核心工具（永远加载），agent 可直接调用抓取网页
- **Readability 正文提取**：引入 `@mozilla/readability` + `linkedom`，文章类页面自动提取正文（去导航/广告/页脚），token 节省 70-80%；列表/首页等无文章结构的页面自动降级为全页转换

### 改进
- **HTML→Markdown 输出**：用 `turndown` 替换正则 `htmlToText()`，输出从纯文本升级为 Markdown，保留标题层级/列表/链接/代码块/粗体
- **浏览器 UA 伪装**：fetch 请求从 Bot UA 改为真实 Chrome UA + Accept/Accept-Language headers，减少反爬拦截

## [0.8.20] - 2026-03-01

### 新增
- **web-fetch Playwright 替代**：新增 `skills/web-fetch/scripts/fetch.py`，用 Playwright 无头 Chromium 替代 curl 抓取，支持 JS 渲染页面（知乎、SPA）、自动滚动懒加载（`--scroll`）、HTML→Markdown 转换、输出截断（`--max-length`）
- **LLM stopReason 管道**：`LLMStreamChunk` 添加 `stopReason` 属性，三个 provider（Claude/OpenAI-compatible/Gemini）均在 done chunk 中发射，agent-loop 检测 `max_tokens` 截断并 warn

### 修复
- **maxTokens 4096→8192**：默认 4096 频繁触发输出截断导致工具调用 JSON 被截断
- **temperature 0.7→0.5**：降低随机性，提高指令遵循确定性
- **use_skill 无限循环防护**：`useSkillRollbacks` 计数器上限 3，防止 use_skill 反复 rollback iterations
- **use_skill auto-install 命令注入**：白名单验证（前缀锚定 + 危险字符拦截 + 恶意 PyPI 源拒绝）
- **context-manager 缓存 key 碰撞**：`compressTurns` 缓存 key 从 `turns.length` 改为最后 turn ID
- **context-manager 内存泄漏**：dynamicContextCache 上限 200、summaryCache 上限 100
- **claude_code OUTPUT_DIR**：改用 `context.workDir` 优先，文件生成到正确会话目录
- **cleanupTmpScripts 不清理子目录**：改为递归遍历 `withFileTypes` + 子目录
- **isSimpleChat 误判任务为闲聊**：添加中英文任务关键词检测（帮我/创建/生成/write/build 等）
- **WS 重连无退避**：固定 3s 替换为指数退避（1s→30s cap）+ jitter + 最多 8 次 + 成功后重置
- **claude_code 规则与 CLI 可用性矛盾**：bootstrap 检测 `claude` CLI，system-prompt 条件注入规则

### 改进
- **Skill 质量**：google-calendar/google-tasks/create-skill 改为 JSON 模板 + Rules 段
- **删除低质量 Skill**：coding（纯浪费迭代）、weather（有 ask 逃生路径）、research（与 web-search 重复）

## [0.8.19] - 2026-03-01

### 修复
- **comfyui 图片生成到会话目录**：comfyui.py `OUTPUT_DIR` 硬编码 `data/tmp`，生成图片在 tmp 根目录而非 per-trace 会话目录。添加 `--output-dir` 命令行参数，SKILL.md 模板加 `--output-dir '{WORKDIR}'` + `auto_send: true`

## [0.8.18] - 2026-03-01

### 修复
- **use_skill 框架层替换 `{WORKDIR}`**：技能模板中的 `{WORKDIR}` 占位符之前依赖 LLM 从运行时 hint 读取路径来替换，弱模型做不到直接写 `./` → 文件下载到项目根目录、`/files/` URL 无法访问。改为 agent-loop 将 `traceTmpDir` 设到 `context.workDir`，use_skill 返回指令前自动 `replaceAll("{WORKDIR}", workDir)`，LLM 拿到的是带绝对路径的命令
- **移除系统提示词 Temp 路径**：`Temp: D:/mycode/agentclaw/data/tmp` 与运行时 hint `[工作目录：.../data/tmp/{traceId}]` 冲突，弱模型优先选了 Temp 路径。移除 Temp，运行时 hint 成为唯一路径来源
- **移除与技能冲突的路由规则**：`音视频 → bash + ffmpeg/ffprobe` 让模型跳过 use_skill 直接写 bash，与 yt-dlp/bilingual-subtitle 技能冲突。移除音视频、网页操作、编码的硬编码路由（保留 claude_code 工具约束和无技能对应的特殊规则）
- **强制 use_skill**：系统提示词改为"第一步必须调 use_skill"+"禁止跳过直接写命令"，防止模型从训练数据"认识"工具而跳过技能加载

## [0.8.17] - 2026-03-01

### 修复
- **技能目录注入 description**：`context-manager` 注入系统提示词的技能目录之前只有 name（如 `yt-dlp`），弱模型无法将用户意图（如"下载视频"）关联到技能名 → 跳过 `use_skill` 直接写 bash → 没用技能模板导致超时和循环重试。改为 `yt-dlp: 下载视频/音频（YouTube、Bilibili、Twitter等）` 格式，所有 17 个技能都带双语描述
- **yt-dlp 技能强调照抄模板**：新增规则：必须照抄 JSON 模板、timeout 必须 300000、下载成功后立即停止不重试

## [0.8.16] - 2026-03-01

### 修复
- **消除上传文件重复**：ws.ts 上传非图片附件改用 `renameSync`（移动而非复制）避免 `data/tmp/` 根目录残留副本；图片读取为 base64 后立即 `unlinkSync` 删除临时文件；agent-loop 将附件复制到 per-trace 目录后删除原文件。确保 `data/tmp/` 根目录不再有散落文件
- **技能输出路径使用工作目录**：7 个 SKILL.md（yt-dlp、bilingual-subtitle、docx、xlsx、pptx、pdf、imap-smtp-email）中所有硬编码的 `data/tmp/` 替换为 `{WORKDIR}/`，技能生成的文件自动进入 per-trace 会话目录

## [0.8.15] - 2026-03-01

### 修复
- **用户附件统一进 per-trace 工作目录**：ws.ts 将视频/文档等非图片附件保存在 `data/tmp/` 根目录，但 per-trace 工作目录在 `data/tmp/{traceId}/`，导致模型去工作目录找文件找不到。agent-loop 现在解析 `[用户附件：path]`，将文件复制到 per-trace 目录，并在每轮 buildContext 后重写消息中的路径。所有文件（图片、视频、附件、输出）统一在同一目录下
- **shell auto_send 不再误发 ls 列出的历史文件**：无 `auto_send` 时只扫描命令本身提取输出路径，不扫描 stdout（避免 `ls` 输出中的历史文件被全部发送）

### 改进
- **运行时 hint 全部中文化**：附件路径、图片路径、工作目录的 hint 统一为中文，hint 名从"输出目录"改为"工作目录"（所有文件都在这里，不仅是输出）

## [0.8.14] - 2026-02-28

### 改进
- **运行时 hint 全部中文化**：附件路径、图片路径、输出目录的 hint 从英文改为中文（如 `[用户附件：xxx]（直接使用此绝对路径，不要修改）`），与系统提示词语言一致，弱模型不再混淆附件路径和输出目录

## [0.8.13] - 2026-02-28

### 修复
- **图片路径 hint 丢失**：agent-loop 将图片保存路径 hint push 到 `input` 数组，但 `buildContext` 从 DB 取历史消息（不含 hint），LLM 看不到图片路径 → 自行编造文件名。改为每轮 `buildContext` 后注入 hint 到 messages 最后一条用户消息，DB 存干净内容（UI 不变）
- **输出文件按会话隔离**：系统提示词不再硬编码 `data/tmp`，改为引导 LLM 使用运行时 `[Working directory ...]` 提供的 per-trace 目录，避免多会话文件混在 `data/tmp/` 根目录
- **shell auto_send 正则支持子目录**：`FILE_PATH_RE` 原只匹配 `data/tmp/file.ext`，不支持 `data/tmp/subdir/file.ext`。修复后多级子目录文件也能被 `auto_send` 正确检测和发送

## [0.8.12] - 2026-02-28

### 修复
- **bash 失败计数按命令区分**：`toolFailCounts` 原按工具名计数，bash 是通用工具，不同命令共享失败配额（如 gcal.py 失败 2 次后 `echo` 排查也被拦截）。改为按命令前缀计数，不同命令不互相阻断
- **update_todo 工具 description 与系统提示词统一**：原 description 说"每步都调"，与系统提示词"开始和结束各调一次"矛盾，导致 LLM 反复调用造成进度"快速走完又重置"。统一为只调两次
- **gcal.py token 刷新错误处理**：`get_access_token` 的 `urlopen` 未 catch `HTTPError`，400 错误以裸 traceback 抛出，LLM 误判为"缺少凭据"。添加 try/except 打印具体错误

## [0.8.11] - 2026-02-28

### 改进
- **工具执行耗时持久化**：agent-loop 记录每个工具调用的 `durationMs`，写入 trace step 和 toolResults JSON，WS 转发给前端。刷新页面后工具卡片仍显示耗时
- **移除 todo auto-advance**：auto-advance 无法正确映射工具调用到 todo 项（3 个 todo 在搜索阶段就被全标完），改为模型自己在开始和结束各调一次 `update_todo`

### 修复
- **file_read/file_write `/tmp` 路径映射**：Windows 上 Git Bash 的 `/tmp/` 映射到 OS temp 目录，但 Node.js 解析为 `D:\tmp`。添加 `resolveFilePath()` 自动映射
- **web-search skill 内置 curl 抓取指令**：搜索结果出来后直接用 curl 抓取页面，不再需要额外调 `use_skill("web-fetch")`，省 1 轮 LLM

## [0.8.10] - 2026-02-28

### 代码精简
- **bootstrap 消除重复变量**：`tmpDir`（416 行）与 `tempDir`（303 行）是同一路径，合并为 `tempDir`
- **bootstrap shellDesc**：嵌套三元运算符改为 if/else，提升可读性
- **context-manager 记忆提示语**：英文改中文，与系统提示词风格统一
- **memory-extractor**：`existingSection` 改用 const 条件表达式，去掉 let 可变赋值
- **store.ts findSimilar JSDoc**：注释从 "same type" 更正为 "across all types"，与跨类型搜索行为一致

## [0.8.9] - 2026-02-28

### 优化
- **系统提示词精简**：全部改为中文，消除与 SOUL.md 的语言冲突和内容重复；Shell 描述精简；Frontend/Deno 路由规则移入 `coding` 技能
- **Skills 目录精简**：去掉中文描述，只列名字（`browser, coding, ...`），每轮省 ~100 tokens
- **路径正斜杠**：`homedir` 和 `tempdir` 注入模板前转正斜杠，Windows 下不再出现 `C:\Users\...`
- **系统提示词模板减少 35%**（2373→1543 字节）

### 修复
- **记忆去重双层防线**：解决记忆越用越臃肿的根因
  - 第一层（LLM 侧）：提取前加载已有记忆注入 prompt，LLM 自行避免提取重复/换种说法的记忆
  - 第二层（代码侧）：`findSimilar` 跨所有类型搜索，不再按 type 过滤导致同一信息换 type 绕过去重
  - 提取 prompt 改为中文，要求 content 用中文写，禁止提取系统/工具实现细节

## [0.8.8] - 2026-02-28

### 精简
- **删除 3 个冗余工具**：`set_reminder`（被 `schedule` 覆盖）、`plan_task`（LLM 自身能力 + `update_todo` 替代）、`delegate_task`（极少使用，`claude_code` 覆盖编码场景）
- **删除 2 个冗余技能**：`http-request`（`bash(curl)` 替代）、`python-exec`（`bash(python)` + `claude_code` 替代）
- **清理类型定义**：移除 `ToolExecutionContext` 中的 `planner` 和 `delegateTask` 字段
- **清理 gateway bootstrap**：移除 SimplePlanner 初始化和相关导入

### 性能
- 每轮 LLM 调用减少 ~450 tokens（3 个工具定义的 schema 开销），10 轮任务省 ~4.5k

## [0.8.7] - 2026-02-28

### 改进
- **删除 skill auto-injection**：移除邮箱地址/附件关键词自动注入 skill 的逻辑，统一走 `use_skill` 按需加载。系统提示词保持精简，多轮任务不再每轮多带 ~500 tokens
- **update_todo 自动推进**：LLM 只需在开始时调一次 `update_todo` 建计划，之后每个非 meta 工具（排除 update_todo/ask_user）执行成功后，agent-loop 自动标记下一项 done 并推送 UI。use_skill 成功也触发推进（表示上一阶段完成）。省去 2+ 次 LLM 调用
- **移动端文件选择**：移除 `accept="*/*"` 属性，避免部分手机浏览器限制为仅图片选择

### 性能
- 复合任务（写词+生图+发邮件）预期从 52k 降至 ~35k tokens（省去 update_todo 手动更新轮次）

## [0.8.6] - 2026-02-27

### 修复
- **历史消息 `/files/` URL 清理**：`turnToMessage` 加载用户历史消息时清理 `[Uploaded: name](/files/hex)` 格式的 URL，防止 LLM 从上下文中拾取错误的 web 路径而非文件系统路径
- **附件路径存储清理**：`originalUserText` 存入 DB 前清理 `/files/hex` URL，新消息不再带误导性路径
- **附件 hint 自然语言化**：`[Attached file: filepath="..."]` 改为 `The user attached a file. Its absolute path is: ...`，减少弱模型只提取文件名的概率
- **send.py 路径自动搜索**：`resolve_file()` 支持完整路径/相对路径/纯文件名，自动在 `data/tmp/` 中查找。LLM 即使只传文件名也能发送成功

### 性能
- 带附件发邮件：92k → 6.7k tokens（2轮完成，第1轮即成功）

## [0.8.5] - 2026-02-27

### 改进
- **Per-trace 临时目录**：每次会话生成 `data/tmp/{traceId}/` 隔离目录，所有输出文件存入其中，不再全部平铺在 `data/tmp/`。LLM 收到工作目录路径提示，自动使用
- **脚本文件不再自动发送给用户**：shell 工具的 `detectFilePaths` 过滤掉 `.py`/`.sh`/`.js`/`.ts`/`.rb`/`.bat`/`.cmd`/`.ps1`/`.pl` 等脚本扩展名，临时脚本不再作为"成果文件"推送到前端
- **Todo 进度持久化**：`done` 事件不再清空 todoItems，进度卡片在会话完成后保留。通过 localStorage 按 sessionId 持久化，切换/刷新后自动恢复
- **非图片附件对 LLM 可见**：`parseUserContent` 不再丢弃非图片文件链接，改为注入文件路径提示（`[Attached file: xxx, saved to: path]`），LLM 可用 `file_read` 读取内容
- **手机端文件选择**：`<input type="file">` 添加 `accept="*/*"`，确保移动端可选择所有类型文件

## [0.8.4] - 2026-02-27

### 修复
- **用户图片自动保存到文件**：用户发送的图片自动 base64 decode 保存到 `data/tmp/`，在消息中注入文件路径提示。LLM 直接使用文件路径作为附件，不再截屏。同时避免后续迭代重发 base64 浪费 token
- **强制 use_skill 优先**：系统提示词新增 Skills 规则——任务匹配可用 skill 时必须先调 `use_skill` 加载指令，禁止从零写代码
- **update_todo 使用规范**：明确要求在任务开始前创建计划、每步更新，不要在全部完成后才调用
- **PowerShell 自动路由**：shell 工具检测 `powershell` 开头的命令自动切到 PowerShell 执行器，避免 Git Bash 吃掉 `$` 变量
- **Skill 自动注入（结构信号匹配）**：用户输入包含邮箱地址时自动注入 email skill 指令到系统提示词，LLM 不需要自己调 use_skill。这不是关键词意图匹配（已被证明是死胡同），而是检测结构化信号（邮箱地址模式），确定性触发
- **windowsHide**：所有 `execFile` 调用加 `windowsHide: true`，防止 pm2 后台运行时弹出终端窗口
- **连续错误阈值 2→3**：给 LLM 更多纠错机会
- **max_iterations 停止后保留 LLM 文本**：不再返回空响应，保留最后一次输出并持久化到 DB

## [0.8.3] - 2026-02-27

### 修复
- **记忆回归系统提示词**：KV-Cache 优化误将记忆从系统提示词移到 user/assistant 消息对，导致新会话中 LLM 忽略已存储的记忆（如用户邮箱），反复索要已知信息。现已回归系统提示词，确保记忆作为最高权威上下文可见
- **Email Skill 强制检查环境变量**：删除"问用户要凭证"的误导性引导，Step 0（检查 .env 环境变量）标注为强制执行，杜绝跳过检查直接 ask_user 的问题
- **Shell 默认超时 30s→120s**：pip install / npm install 在 30s 内经常超时导致任务链断裂，提升到 120s
- **Skill 依赖自动安装**：`use_skill` 激活 skill 时自动执行 Step 0 的 install 命令（pip/npm install），依赖就绪后才返回指令，LLM 不再需要自己处理安装步骤
- **Skill 指令约束性前缀**：`use_skill` 返回内容增加 "Follow these instructions exactly, use ONLY the libraries shown" 前缀，防止 LLM 无视模板自己造轮子
- **删除 writing skill**：纯鸡汤式指令（"match tone, use clear language"），无可执行内容，每次调用浪费一轮迭代
- **maxIterations 10→15**：多步任务（写内容+转格式+发邮件）需要更多迭代容错空间
- **Token 统计刷新后不一致**：最终 assistant turn 存的是单次迭代 token 而非累计值，页面刷新后从 DB 读到的 token 远小于 WS 实时推送值。重构为：最终 turn 存累计 `totalTokensIn/totalTokensOut`，中间 turn 存单次增量；autoComplete turn 同步修复
- **Token 统计持久化完善**：turns 表新增 `duration_ms` 和 `tool_call_count` 列（含旧库迁移），addTurn INSERT/TurnRow/rowToConversationTurn 全链路补齐
- **Email 附件中文文件名变 .bin**：发送邮件时附件文件名未按 RFC 2231 编码，含中文时接收方无法识别。改用 `filename=("utf-8", "", filename)` 三元组编码
- **update_todo 兼容数组输入**：LLM 偶尔传入数组而非字符串，工具直接报错。新增 `Array.isArray` 检测，自动 join 为 markdown 文本

## [0.8.2] - 2026-02-27

### 修复
- **SearXNG 搜索质量修复**：移除 bing/brave/startpage 等中文搜索质量差的引擎，仅保留 yahoo + duckduckgo（`keep_only`）；恢复 `language=zh-CN` 参数（搜索脚本 + settings.yml `default_lang`）；`safe_search: 0` → `1`，过滤成人内容
- **知识类问题不再触发搜索**：系统提示词新增规则——定义、概念、"XX是什么"等知识类问题直接回答，仅实时数据（新闻、价格、天气）才触发 web search
- **ToolRegistry skill 自动重定向**：LLM 把 skill 名称当工具名调用时，registry 自动转发到 `use_skill` 工具，避免弱模型分不清 tool/skill 导致的 "Tool not found" 错误

## [0.8.1] - 2026-02-26

### 新功能
- **Todo 实时进度追踪**：借鉴 Manus AI，新增 `update_todo` 工具。Agent 执行复杂多步任务时自动创建进度清单，前端实时显示进度条 + checkbox 列表（WebSocket `todo_update` 事件）。工具返回值留在上下文末尾，防止 LLM 在长任务中迷失（lost-in-the-middle）

- **SearXNG 搜索引擎集成**：自托管免费元搜索引擎替代 Serper API（$2.50/1000次→$0）。SearXNG 为主搜索源，Serper 自动降级为 fallback。docker-compose 包含 SearXNG + Redis 容器，开箱即用

### 优化
- **上下文缓存优化**：Agent loop 多轮迭代复用首次上下文（`reuseContext`），避免重复搜索记忆。Claude provider 使用 `cache_control: { type: "ephemeral" }` 显式标记缓存点
- **代码块简化**：消息正文中的代码块移除复制按钮和语言标签，仅保留 Preview 按钮（html/svg/mermaid/jsx/tsx）
- **单行代码块轻量渲染**：单行代码块不再使用 SyntaxHighlighter，改用轻量 `.code-block-single` 样式
- **隐藏 update_todo 工具卡片**：同 send_file，不在聊天中显示工具调用卡片

## [0.8.0] - 2026-02-26

### 新功能
- **Docker 化部署**：多阶段构建 Dockerfile + docker-compose.yml，`docker compose up -d` 一键启动。包含 ffmpeg/git/curl/python/deno 等 CLI 工具
- **React 实时预览（Artifacts）**：JSX/TSX 代码块支持 Preview 按钮，动态加载 @babel/standalone 编译 + React 19 CDN 渲染，iframe 沙箱隔离
- **Deno 前端开发**：系统提示词引导 AI 使用 Deno 替代 npm/Vite 生成前端项目，消除 node_modules 依赖
- **.env.example**：完整的环境变量示例文件，注释说明每项配置

### 修复
- **sendFile 子目录路径**：保留 `data/tmp/` 下的子目录结构，修复子目录文件（如 `calculator/index.html`）404 问题
- **Vite 项目预览降级**：检测非自包含 HTML（引用本地 module script），自动切换 iframe 到 dev server 地址，底部提示启动命令
- **HTML 预览安全**：移除 `allow-same-origin` sandbox 属性，修复浏览器安全警告

### 文档
- **README 更新**：新增 Docker 部署说明（推荐方式），新增 Artifacts 预览功能说明

## [0.7.15] - 2026-02-26

### 修复
- **Shell 工具文件自动发送**：`detectFilePaths` 正则不再硬编码扩展名白名单，改为匹配 `data/tmp/` 下任意带扩展名的文件。修复 `.srt`/`.txt`/`.csv`/`.xlsx` 等文件类型无法自动发送的问题
- **欢迎页附件按钮**：文件 input 移到全局渲染位置，修复 new chat 时点击附件按钮无反应的问题
- **欢迎页 pending files**：附件预览气泡在 new chat 时显示在输入框下方，不再错位到页面底部

## [0.7.14] - 2026-02-25

### 新功能
- **语义向量化（Volcano Engine Embedding）**：接入火山引擎 doubao-embedding-vision 多模态 API，记忆存储和检索使用真实语义向量替代 BagOfWords fallback。环境变量 `VOLCANO_EMBEDDING_KEY` + `VOLCANO_EMBEDDING_MODEL`

## [0.7.13] - 2026-02-25

### 新功能
- **欢迎页重设计**：新会话居中展示输入框 + 技能快捷入口（Image Gen/Excel/PDF/Web Search/More），对齐 Claude/Gemini 风格
- **输入框两行布局**：textarea 在上、操作按钮在下（附件/技能在左，麦克风/发送在右），对齐主流 AI 产品交互
- **技能弹出菜单**：输入框内技能图标点击弹出 Top 5 技能列表
- **品牌标识**：新会话左上角显示 AgentClaw，右上角 ... 菜单仅在有会话时显示

## [0.7.12] - 2026-02-25

### 新功能
- **Skill 预选芯片**：输入框上方显示已启用的 skill 快捷按钮，点击预选后发送消息直接注入 skill 指令到系统提示词，跳过 use_skill 工具轮，每次节省 ~3000 token（1 轮 LLM 调用）

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
