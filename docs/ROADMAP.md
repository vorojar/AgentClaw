# AgentClaw Roadmap（路线图）

## Phase 1: Foundation — "能跑起来" (Make it Run)（第一阶段：基础——让它跑起来）✅ 已完成

**Goal**: CLI + multi-provider LLM + basic tools + conversation memory（目标：命令行 + 多提供商 LLM + 基本工具 + 对话记忆）

### 1.1 Project Setup（项目初始化）✅
- [x] Monorepo structure (pnpm + Turborepo)（Monorepo 项目结构）
- [x] TypeScript configuration（TypeScript 配置）
- [x] Shared types package（共享类型包）
- [x] Build pipeline (tsup)（构建流水线）

### 1.2 Core Agent Loop（核心智能循环）✅
- [x] Basic AgentLoop implementation (think-act-observe cycle)（基本 AgentLoop 实现：思考-行动-观察循环）
- [x] ContextManager (system prompt + history)（上下文管理器：系统提示 + 历史）
- [x] Simple Orchestrator (single session)（简单编排器：单会话）

### 1.3 LLM Providers（LLM 提供商）✅
- [x] Claude provider (Anthropic SDK)（Claude 提供商，基于 Anthropic SDK）
- [x] OpenAI-compatible provider (OpenAI, DeepSeek, Kimi, MiniMax, Qwen, Ollama)（OpenAI 兼容提供商，一个适配器通吃）
- [x] Gemini provider (@google/genai SDK)（Gemini 提供商，基于 Google GenAI SDK）
- [x] Smart Router for model selection（智能路由器，模型选择）
- [x] Streaming support（流式输出支持）
- [x] Tool call handling（工具调用处理）

### 1.4 Built-in Tools（内置工具）✅
- [x] Shell execution tool（命令行执行工具）
- [x] File read/write tools（文件读写工具）
- [x] Ask-user tool (CLI prompt)（询问用户工具，命令行提示）
- [x] ToolRegistry for managing tools（工具注册表）

### 1.5 Memory — Basic（记忆——基础版）✅
- [x] SQLite database setup (better-sqlite3)（SQLite 数据库初始化）
- [x] Conversation storage (conversations + turns)（对话存储：对话表 + 轮次表）
- [x] History retrieval for context（上下文的历史检索）
- [x] Memory CRUD operations（记忆增删改查）

### 1.6 CLI（命令行界面）✅
- [x] Interactive chat mode (Node.js readline)（交互式对话模式，基于 Node.js readline）
- [x] --provider flag for selecting LLM provider（--provider 参数选择 LLM 提供商）
- [x] Environment variable configuration (API keys)（环境变量配置：API 密钥）
- [x] --help and --version flags（--help 和 --version 参数）

### 1.7 Integration（集成）✅
- [x] End-to-end flow: user → CLI → agent → LLM → tool → response（端到端流程：用户 → 命令行 → 智能体 → LLM → 工具 → 响应）
- [x] Error handling with clear messages（清晰的错误提示）
- [x] Graceful shutdown (Ctrl+C)（优雅关闭）

---

## Phase 2: Intelligence — "变聪明" (Get Smart)（第二阶段：智能——让它变聪明）✅ 已完成

**Goal**: Planner + external tool integration + Skills + Advanced Memory（目标：规划器 + 外部工具集成 + 技能系统 + 高级记忆）

### 2.1 Advanced Routing（高级路由）✅
- [x] Cost tracking per provider/model（每个提供商/模型的成本追踪：`trackUsage()` + `getUsageStats()`）
- [x] Automatic fallback on provider failure（提供商失败时自动切换：`markProviderDown()` + fallback chain）
- [x] Task-type based routing rules（基于任务类型的路由规则：tier-based 默认映射 planning→flagship, coding→standard, chat→fast）

### 2.2 Planner（规划器）✅
- [x] Task decomposition via LLM（通过 LLM 分解任务：`SimplePlanner.createPlan()`）
- [x] Step dependency management（步骤依赖管理：`dependsOn` 字段，按拓扑顺序执行）
- [x] Execution monitoring（执行监控：通过 AgentLoop 执行每个步骤）
- [x] Re-planning on failure（失败时重新规划：`replan()` 保留已完成步骤，替换剩余步骤）

### 2.3 Web Tools（Web 工具）✅
- [x] Web search tool (DuckDuckGo, no API key needed)（网页搜索工具：DuckDuckGo，无需 API key）
- [x] Web fetch tool (HTML auto-clean, JSON pretty-print)（网页抓取工具：HTML 自动清洗、JSON 格式化）

### 2.4 MCP Protocol（MCP 协议）✅
- [x] MCP client implementation (stdio + HTTP transport)（MCP 客户端实现：stdio + HTTP 双传输）
- [x] Auto-discovery of tools from MCP servers（从 MCP 服务器自动发现工具：`MCPClient.listTools()`）
- [x] Tool adapter layer (MCP → AgentClaw Tool)（工具适配层：MCP 工具自动转换为 AgentClaw Tool）
- [x] Multi-server management（多服务器管理：`MCPManager` 管理多个 MCP 连接）

### 2.5 Memory — Advanced（记忆——高级版）✅
- [x] Vector embeddings (pure JS cosine similarity + bag-of-words fallback)（向量嵌入：纯 JS 余弦相似度 + 词袋模型兜底）
- [x] Long-term memory extraction via LLM (facts, preferences, entities, episodic)（通过 LLM 提取长期记忆：事实、偏好、实体、情景）
- [x] Hybrid retrieval (semantic × 0.5 + recency × 0.2 + importance × 0.3)（混合检索：语义×0.5 + 时效×0.2 + 重要性×0.3）
- [x] Periodic auto-extraction (every 5 turns)（定期自动提取：每 5 轮对话自动提取记忆）

### 2.6 Skill System（技能系统）✅
- [x] SKILL.md parser (hand-written YAML, zero dependencies)（SKILL.md 解析器：手写 YAML 解析，零依赖）
- [x] Trigger matching (keyword + intent + always)（触发匹配：关键词 + 意图 + 始终）
- [x] Skill display in CLI on match（CLI 匹配时显示激活的技能）
- [x] Built-in skills: coding, research, writing（内置技能：编码、研究、写作）

---

## Phase 3: Always On — "一直在" (Always There)（第三阶段：常驻——让它一直在）✅ 已完成

**Goal**: Background daemon + scheduled tasks + Web UI（目标：后台守护进程 + 定时任务 + Web 界面）

### 3.1 Gateway Daemon（网关守护进程）✅
- [x] Fastify HTTP server with CORS（Fastify HTTP 服务器 + CORS：`bootstrap.ts` 初始化所有核心组件，`server.ts` 注册插件和路由）
- [x] WebSocket support for real-time streaming（WebSocket 实时流式传输：`ws.ts` 处理 text/tool_call/tool_result/done/error 事件）
- [x] Full REST API (18 endpoints matching Web UI client)（完整 REST API：18 个端点对齐 Web UI 客户端）
- [x] Session management API (create/list/close/chat/history)（会话管理 API：创建/列表/关闭/对话/历史）
- [x] Graceful shutdown (SIGINT/SIGTERM)（优雅关闭）

### 3.2 Scheduled Tasks（定时任务）✅
- [x] Cron-based task scheduling via croner library（基于 croner 库的 Cron 任务调度：`scheduler.ts`）
- [x] Task CRUD API (create/list/delete)（任务增删查 API）
- [x] Next run time computation（下次运行时间计算）

### 3.3 Web UI（Web 界面）✅
- [x] React + Vite setup with dark theme（React + Vite 项目搭建 + 深色主题设计系统）
- [x] Chat interface with WebSocket streaming, tool call display, session management（聊天界面：WebSocket 流式传输、工具调用卡片、会话管理、自动滚动）
- [x] Plan visualization with step timeline and dependency display（计划可视化：步骤时间线、依赖关系展示、自动刷新）
- [x] Memory browser with search, filter, sort, delete（记忆浏览器：搜索、类型筛选、排序切换、删除确认）
- [x] Settings panel with provider config, usage stats, tools/skills list, scheduled tasks（设置面板：提供商配置、使用统计、工具/技能列表、定时任务管理）

---

## Phase 4: Everywhere — "到处在" (Be Everywhere)（第四阶段：无处不在——让它到处在）

**Goal**: Multi-platform bot integration（目标：多平台机器人集成）

### 4.1 Telegram Bot（Telegram 机器人）✅
- [x] Grammy framework integration（Grammy 框架集成：集成在 Gateway 中，`TELEGRAM_BOT_TOKEN` 控制启停）
- [x] Chat-to-session mapping（聊天→会话自动映射：每个 Telegram 对话自动创建 AgentClaw session）
- [x] Commands: /start, /new, /help（命令：/start 欢迎、/new 新会话、/help 帮助）
- [x] Message forwarding with typing indicator（消息转发 + 输入中指示器）
- [x] Long message splitting (4096-char Telegram limit)（长消息自动分段：适配 Telegram 4096 字符限制）
- [x] Error handling with session auto-recovery（错误处理 + 会话自动恢复）

### 4.X WhatsApp Bot（WhatsApp 机器人）✅
- [x] Baileys (WhatsApp Web 直连协议) 集成，QR 码扫码认证
- [x] 仅自聊模式（self-chat only），不干扰其他对话
- [x] 凭证持久化（data/whatsapp-auth/），重启免扫码
- [x] 命令：/new 新会话、/help 帮助
- [x] 文字/图片/文件/视频/音频 消息支持
- [x] 消息去重 + bot 发送消息追踪（避免自聊无限循环）
- [x] 断线自动重连
- [x] broadcast API 支持定时任务结果推送

### 4.2 Cross-Gateway Tool Context（跨网关工具上下文）✅
- [x] `ToolExecutionContext` 类型：贯穿 orchestrator → agentLoop → toolRegistry → tool 的可选上下文
- [x] `promptUser` 回调：`ask_user` 工具在 Telegram 下正常工作（不再阻塞在 stdin）
- [x] `notifyUser` 回调：支持异步通知（提醒等场景，tool 返回后仍可发消息给用户）
- [x] `saveMemory` 回调：由 orchestrator 自动注入，工具可直接写入长期记忆

### 4.3 New Built-in Tools（新内置工具）✅
- [x] `remember` 工具：即时将信息写入长期记忆（不依赖后台提取）
- [x] `set_reminder` 工具：设置一次性定时提醒，到时通过 `notifyUser` 发送通知

### 4.4 Memory System Fixes（记忆系统修复）✅
- [x] 移除 `search()` 的 SQL LIKE 预过滤（之前会杀死所有语义搜索结果）
- [x] 中文分词支持：CJK 字符逐字拆分，`SimpleBagOfWords` + token overlap 评分均支持中文
- [x] 提取频率优化：首轮即提取，之后每 3 轮提取（原为每 5 轮）
- [x] `bootstrap.ts` 中自动设置 LLM embed 函数（如 provider 支持）

### 4.5 Platform Fixes（平台修复）✅
- [x] Shell 工具改用 PowerShell（解决 cmd.exe 吞 `$` 变量 + 中文乱码问题，`[Console]::OutputEncoding = UTF8`）
- [x] Gateway 直接托管 Web UI 静态文件（`@fastify/static`，`pnpm start` 一键启动全部服务）
- [x] System prompt 注入运行环境信息（OS、Shell 类型、临时目录路径），LLM 不再盲猜平台
- [x] `sendFile` 智能发送：图片扩展名用 `sendPhoto`（内联预览），其他用 `sendDocument`

### 4.6 Other Platform Bots（其他平台机器人）
- [ ] Discord bot
- [ ] WeChat bot（微信机器人）

---

## Phase 5: Superpowers — "超能力" (Level Up)

**Goal**: 让 Agent 真正能看、能操作、能定期执行（目标：多模态输入 + 浏览器操控 + 文件交互 + 周期任务）

### 5.1 Image Understanding（看图理解）✅
- [x] Telegram 图片/截图接收：监听 `message:photo`，下载图片并转 base64
- [x] 多模态 LLM 调用：三大 provider（Claude / OpenAI / Gemini）均支持 `ImageContent` block
- [x] 图片 + 文字混合对话：用户可以发图并附带问题（无 caption 时默认"请描述这张图片"）
- [x] Agent Loop / Context Manager 全链路支持 `string | ContentBlock[]` 输入

### 5.2 File Transfer（文件收发）✅
- [x] Telegram 文件接收：监听 `message:document`，下载到 `data/uploads/` 目录
- [x] 文件发送工具 `send_file`：通过 `context.sendFile` 回调将文件发回 Telegram
- [x] 所有 Telegram handler（text / photo / document）均注入 `sendFile` 回调

### 5.3 Recurring Tasks（周期任务）✅
- [x] `schedule` 工具：让 LLM 创建 cron 定时任务（create / list / delete）
- [x] 任务触发时运行完整 orchestrator loop（而非仅发通知文本），结果广播到所有活跃网关（Telegram + WhatsApp）
- [x] TaskScheduler 统一在 bootstrap 创建，通过 `ToolExecutionContext.scheduler` 注入

### 5.4 Browser Automation（浏览器操控）✅
- [x] `browser` 工具：基于 puppeteer-core，使用系统已安装的 Chrome/Edge（自动检测路径）
- [x] 支持 6 种操作：open / screenshot / click / type / get_content / close
- [x] 模块级单例管理（Browser + Page），headless 模式运行
- [x] 截图保存到 `data/tmp/`，配合 `send_file` 发回 Telegram

### 5.5 HTTP Request Tool（HTTP 请求工具）✅
- [x] `http_request` 工具：支持 GET/POST/PUT/DELETE/PATCH，自定义 headers 和 body
- [x] 原生 fetch 实现，JSON 自动美化，响应超长自动截断
- [x] AbortController 超时控制，完善的错误处理

### 5.6 Python Code Executor（Python 代码执行器）✅
- [x] `python` 工具：直接接收 Python 代码执行，无需先写文件（`cwd` 自动设为 `data/tmp/`）
- [x] 输出捕获：stdout + stderr，脚本执行后自动清理临时 .py 文件
- [x] 超时控制：默认 60 秒，UTF-8 编码强制开启
- [x] System prompt 引导 LLM 优先用 python 处理复杂任务（截图、图片处理、数据分析等）
- [x] Style 规则：简洁回复，发送文件后不复述元信息

---

### 5.7 Usage Statistics Display（用量统计展示）✅
- [x] `LLMStreamChunk` 新增 `usage` + `model` 字段，done chunk 携带 token 用量（类型层）
- [x] `Message` / `ConversationTurn` 新增 `durationMs` + `toolCallCount` 字段（类型层）
- [x] 三大 Provider（OpenAI Compatible / Claude / Gemini）的 `stream()` 方法在 done chunk 中返回 usage
- [x] AgentLoop 跨多轮 LLM 调用累加 tokensIn/Out、toolCallCount、计时 durationMs，写入 Message 和 DB
- [x] WebSocket done 消息携带 model/tokensIn/tokensOut/durationMs/toolCallCount
- [x] REST API history 端点返回统计字段
- [x] Web UI assistant 消息底部灰色小字显示统计行（流式和历史消息均支持）
- ~~Telegram / WhatsApp 回复末尾追加统计行~~（usage stats 已从 Telegram 和 WhatsApp 消息中移除）

---

## Phase 6: Creative Tools — "搞创作" (Create)

**Goal**: 集成本地 AI 创作工具（目标：ComfyUI 图片生成/处理 + 更多创意工具）

### 6.1 ComfyUI Integration（ComfyUI 集成）✅
- [x] `comfyui` 工具：统一入口，三种 action（generate / remove_background / upscale）
- [x] 文生图（text-to-image）：基于 z-image-turbo 模型，支持 prompt / width / height / steps / seed 参数
- [x] 去除背景（remove background）：基于 RMBG-2.0 模型，上传图片 → 处理 → 自动发送结果
- [x] 4x 超分放大（upscale）：基于 RealESRGAN_x4plus 模型，上传图片 → 处理 → 自动发送结果
- [x] 完整工作流：submit prompt → poll history → download output → sendFile 自动发送给用户
- [x] Telegram 图片消息同时保存到本地磁盘（`data/uploads/`），供 ComfyUI 等工具读取

### 6.2 Skills System Activation（技能系统激活）✅
- [x] `ContextManager.buildContext()` 中调用 `SkillRegistry.match()` 匹配用户输入
- [x] 匹配 confidence > 0.3 时将 skill instructions 注入 system prompt
- [x] Orchestrator 将 skillRegistry 传递给 ContextManager
- [x] 三个内置 skill（coding/research/writing）生效：LLM 行为根据用户意图自适应

### 6.3 Planner Integration（规划器集成）✅
- [x] `plan_task` 内置工具：LLM 可主动调用规划器分解复杂多步任务
- [x] `ToolExecutionContext` 扩展 `planner` 字段，Orchestrator 自动注入
- [x] 完整流程：createPlan（LLM 分解目标为步骤）→ executeNext 循环执行 → 汇总结果返回
- [x] 每个步骤通过独立 AgentLoop 执行，拥有完整工具访问能力

### 6.4 Tool Retry Mechanism（工具重试机制）✅
- [x] AgentLoop 中网络类工具（comfyui/http_request/web_search/web_fetch）失败自动重试
- [x] 最多重试 2 次，指数退避（2s、4s）
- [x] 重试成功立即返回，无需 LLM 重新决策

### 6.5 Token Optimization（Token 优化）✅
- [x] 去掉 system prompt 中重复的工具描述（LLM 已通过 `tools` API 参数获取结构化定义）
- [x] 动态工具筛选：7 个核心工具始终发送，8 组专业工具按用户输入关键词触发，首轮筛选后续迭代全量
- [x] 每轮对话节省约 2000 tokens

### 6.6 Skills Hot-Reload（技能热加载）✅
- [x] `SkillRegistryImpl.watchDirectory()`：`fs.watch` 递归监听 skills 目录
- [x] 文件新增/修改/删除自动加载/移除，300ms 去抖动
- [x] `loadSkillFile()` 提取为独立方法，支持单文件重载
- [x] watcher.unref() 不阻止进程退出

### 6.7 Skill Self-Creation（技能自创建）✅
- [x] `create_skill` 内置工具：LLM 可创建新技能（name / description / triggers / instructions）
- [x] 自动生成 `skills/{name}/SKILL.md`，热加载立即生效
- [x] System prompt 引导：完成非平凡任务后询问用户"要保存为技能吗？"
- [x] 只保存提炼后的正确路径（不含失败尝试），写成可直接复用的配方
- [x] 已加入动态工具筛选的专业工具列表

### 6.8 Browser CDP（浏览器 CDP 模式）✅
- [x] 浏览器工具从 puppeteer.launch() 改为 CDP 连接用户真实 Chrome/Edge
- [x] 自动检测并连接 `127.0.0.1:9222`，连不上则自动启动 Chrome 带 `--remote-debugging-port`
- [x] 操作用户真实浏览器：密码、cookies、扩展、登录态全部保留
- [x] `close` 只关我们的标签页 + 断开 CDP，不关整个浏览器

---

## Phase 7: Integrations — "连万物" (Connect Everything)（第七阶段：集成——连接一切）✅ 已完成

**Goal**: 第三方服务深度集成 + 工具链和开发体验提升（目标：Google 服务集成 + CLI 增强 + 搜索重写 + System Prompt 增强）

### 7.1 Google Integration（Google 集成）✅
- [x] Google OAuth2 共享模块（google-auth.ts）：token 自动刷新，内存缓存
- [x] Google Calendar 工具（google-calendar.ts）：list / create / delete 事件，支持提醒设置（reminder_minutes）
- [x] Google Tasks 工具（google-tasks.ts）：list / create / complete / delete 任务
- [x] 环境变量驱动：有 `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REFRESH_TOKEN` 时自动注册
- [x] 授权脚本（scripts/google-auth.mjs）：一键获取 refresh_token

### 7.2 CLI Enhancements（CLI 增强）✅
- [x] 流式输出：`processInput` → `processInputStream`，逐字打印
- [x] dotenv 集成：自动加载 .env 文件
- [x] Provider 自动检测：与 gateway 一致的优先级（ANTHROPIC > OPENAI > GEMINI > Ollama）
- [x] `pnpm cli` 快捷命令

### 7.3 System Prompt Enhancements（System Prompt 增强）✅
- [x] 注入当前日期时间 + 时区（LLM 知道"今天"是哪天）
- [x] 注入 OS + Shell 信息 + 强调只用当前 OS 命令
- [x] Google Calendar / Tasks 使用规则（日程 / 提醒 / 闹钟直接用 google_calendar，不走 web_search）

### 7.4 Web Search Rewrite（Web Search 重写）✅
- [x] 从 Bing HTML 抓取（经常失败）换为 Serper API（Google 搜索结构化 JSON）
- [x] 支持 answerBox + knowledgeGraph + organic results
- [x] 极省 token：结构化 JSON vs 全页文本
- [x] SearXNG 自托管替代 Serper API（$2.50/1000次→$0），Serper 降级为 fallback
- [x] 仅保留 Yahoo + DuckDuckGo 引擎，`language=zh-CN` + `safe_search: 1`

---

## Phase 8: Developer Experience — "更好用" (Better DX)

**Goal**: 前端体验提升 + 外部 Agent 集成 + 网络稳定性（目标：Artifacts 预览 + Claude Code 集成 + 工具调用可视化 + 连接可靠性）

### 8.1 Artifacts Preview（Artifacts 预览）✅
- [x] CodeBlock 组件支持 HTML / SVG / Mermaid 代码块实时预览（Preview/Code 切换按钮）
- [x] HTML/SVG 用 iframe sandbox 渲染，Mermaid 通过动态 `import()` 按需加载（独立 chunk）
- [x] HTML 文件链接（`/files/*.html`）在聊天中显示为紧凑卡片，点击弹出全屏 overlay（createPortal）
- [x] Overlay 工具栏：← 返回图标 + 居中文件名 + ↗ 新标签页图标，ESC 关闭

### 8.2 Claude Code Integration（Claude Code CLI 集成）✅
- [x] `claude_code` 工具：委托编码任务给 Claude Code CLI（`claude -p --dangerously-skip-permissions --output-format stream-json --verbose`）
- [x] 流式输出：Claude Code 的文本通过 `streamText` 回调实时推送到用户聊天气泡
- [x] 精简摘要：工具完成后返回 compact summary + `autoComplete: true` 跳过外层 LLM 总结，大幅节省 token
- [x] 自动 sendFile：`data/tmp` 或 `data/temp` 下生成的文件自动发送给用户
- [x] System prompt 路由：编码任务路由到 `claude_code` 而非 `file_write`

### 8.3 Tool Call Visualization（工具调用可视化）✅
- [x] JSON INPUT/OUTPUT：`react-json-view-lite` 可折叠树形展示，自动适配亮/暗主题
- [x] Markdown OUTPUT：`claude_code` 等工具用 `ReactMarkdown` + `remark-gfm` 渲染表格/列表/代码
- [x] 行内代码保持 inline（`toolMdComponents`），不走 CodeBlock
- [x] INPUT/OUTPUT 标签右侧 hover 显示 Copy 按钮一键复制整段

### 8.4 Connection Reliability（连接可靠性）✅
- [x] Fastify `keepAliveTimeout` 从 5s 增至 120s（解决 Cloudflare Tunnel 503）
- [x] WS 服务端 ping/pong 每 30s（解决长推理断连）
- [x] WS 客户端断连 3s 自动重连
- [x] `/files/` 加 `Cache-Control: max-age=7d, immutable`（VPN/Tunnel 慢路径缓存）
- [x] `/files/` 静态路由同时服务 `data/tmp` 和 `data/temp`

### 8.5 Mobile UX（移动端体验）✅
- [x] 触控设备 Enter 键改为换行，通过发送按钮发送
- [x] 窄屏（≤768px）默认关闭侧边栏
- [x] 点击侧边栏导航项/会话后自动收起侧边栏
- [x] `PageHeader` 组件统一处理非 Chat 页面的侧边栏入口

---

## 竞品对比：AgentClaw vs LobsterAI（网易有道）

> LobsterAI：网易有道开源的全场景个人助理 Agent 桌面应用（Electron），MIT 协议。
> 对比时间：2026-02

| 能力 | LobsterAI | AgentClaw | 评价 |
|---|---|---|---|
| **沙箱隔离执行** | Alpine Linux VM (QCOW2)，进程级隔离 | **命令黑名单防护**（拦截 rm -rf /、格式化、关机等） | LobsterAI 胜（进程级隔离 vs 命令黑名单） |
| **Office 文档生成** | DOCX / XLSX / PPTX / PDF 全套内置 | **DOCX / XLSX / PPTX / PDF 全套 Skill**（python-docx/openpyxl/python-pptx/PyMuPDF） | **持平** |
| **视频生成** | Remotion 程序化生成视频 | 无 | LobsterAI 完胜 |
| **IM 远程操控** | 钉钉 + 飞书 + Telegram + Discord (4个) | Telegram + WhatsApp (2个) | LobsterAI 覆盖广（尤其国内 IM） |
| **技能自扩展** | skill-creator 让 AI 自己创建新技能并热加载 | **create_skill 工具 + 热加载 + 用户确认 + 提炼正确路径** | **持平**（我们多了用户确认和智能提炼） |
| **记忆系统** | 5 种记忆类型 + 置信度排序 + 可调严格度 + LLM 判断过滤 | MemoryExtractor + 向量搜索 | LobsterAI 分类更精细；AgentClaw 有向量搜索 |
| **权限门控** | 敏感操作弹窗确认 | 无 | LobsterAI 更安全 |
| **Artifacts 预览** | HTML / SVG / Mermaid / React 组件实时渲染 | **HTML / SVG / Mermaid 代码块预览 + HTML 文件全屏 overlay 渲染** | **持平**（LobsterAI 多 React 组件） |
| **LLM 提供商数量** | 11 个（含 DeepSeek/Kimi/智谱/通义等国产） | 4 个（Claude/OpenAI/Gemini/Ollama） | LobsterAI 数量多 |
| **AI 引擎灵活度** | 绑定 Claude Agent SDK（agent 循环依赖 Anthropic） | **自研 AgentLoop，任意 Provider 跑完整 agent 循环** | **AgentClaw 胜** |
| **图片生成/处理** | 无 | **ComfyUI 文生图 + 去背景 + 4x 放大** | **AgentClaw 胜** |
| **浏览器控制** | Playwright 自动化（独立实例） | **CDP 连接用户真实 Chrome（带登录态）** | **AgentClaw 胜** |
| **部署形态** | Electron 桌面应用（必须本地装） | **Web + Gateway 服务（远程部署，多端访问）** | **AgentClaw 更灵活** |
| **工具重试** | 未提及 | **指数退避重试** | **AgentClaw 胜** |
| **定时任务** | Cron 调度 | TaskScheduler + set_reminder + **orchestrator 自动执行 + 多网关广播** | **AgentClaw 胜**（任务触发后自动执行完整 agent 循环） |
| **网页搜索** | Playwright 驱动 Chrome 搜索 | **SearXNG 自托管**（免费）+ Serper API fallback | **AgentClaw 胜**（零成本 + 结构化 JSON + fallback 兜底） |
| **Planner** | create-plan 技能 | plan_task 工具 + SimplePlanner | 持平 |
| **数据隐私** | 全本地 SQLite | 全本地 SQLite | 持平 |

### 最值得借鉴的方向（优先级排序）

1. **沙箱执行** — 当前仅命令黑名单防护，需真正的容器隔离（Docker/VM）
2. ~~**Office 文档生成**~~ ✅ 已实现（DOCX/XLSX/PPTX 三个 Skill + PDF Skill）
3. ~~**技能自创建**~~ ✅ 已实现（create_skill + 热加载 + 用户确认）
4. **更多 IM 网关** — 钉钉、飞书对国内用户至关重要
5. **权限门控** — 敏感操作需用户确认，提升安全性
6. ~~**Artifacts 渲染**~~ ✅ 已实现（HTML/SVG/Mermaid 代码块预览 + HTML 文件全屏 overlay）

---

## Phase 9: Agent Intelligence — "更像人" (Act Like Human)

**Goal**: 借鉴 Manus 的 Agent 设计理念，提升任务执行透明度和自主性

### 9.1 Todo.md 实时进度追踪 ✅
- [x] Agent 执行复杂任务时自动创建 `todo.md`，每步完成后打勾更新
- [x] 前端实时展示任务进度清单（WebSocket 推送 `todo_update` 事件）
- [x] 双重作用：用户看进度 + Agent 不迷失（将目标持续写入上下文末尾）

### 9.2 KV-Cache 上下文优化 ✅
- [x] System prompt 固定不变，动态内容（记忆 + skill catalog + 激活技能指令）拆到 messages 前缀
- [x] Agent loop 多轮迭代复用首次上下文（`reuseContext`），避免重复搜索记忆
- [x] Claude provider 使用 `cache_control: { type: "ephemeral" }` 显式标记缓存点
- [x] 预估 input token 成本降低 50-60%

### 9.3 SearXNG 自托管搜索 ✅
- [x] SearXNG 替代 Serper API，搜索成本从 $2.50/1000次降至 $0
- [x] 仅保留 Yahoo + DuckDuckGo，`language=zh-CN` + `safe_search: 1`
- [x] Serper 自动降级为 fallback

---

## Current Focus（当前重点）

**Phase 8 已完成：Artifacts 预览 + Claude Code 集成 + 工具调用可视化 + 移动端优化。**

Phase 9 进行中：借鉴 Manus，提升 Agent 智能和透明度。

**Phase 9 已完成：Todo 进度追踪 + KV-Cache 优化 + SearXNG 自托管搜索。**

下一阶段待规划。
