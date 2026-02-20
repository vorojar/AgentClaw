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
- [ ] WeChat bot

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
- [x] 任务触发时自动发消息给用户（`scheduler.setOnTaskFire` + Telegram 通知）
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
- [x] Telegram 回复末尾追加统计行：`— model · N tokens (in↑ out↓) · Xs · 🔧×N`
- [x] Web UI assistant 消息底部灰色小字显示统计行（流式和历史消息均支持）

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

---

## 竞品对比：AgentClaw vs LobsterAI（网易有道）

> LobsterAI：网易有道开源的全场景个人助理 Agent 桌面应用（Electron），MIT 协议。
> 对比时间：2026-02

| 能力 | LobsterAI | AgentClaw | 评价 |
|---|---|---|---|
| **沙箱隔离执行** | Alpine Linux VM (QCOW2)，进程级隔离 | 无 | LobsterAI 完胜 |
| **Office 文档生成** | DOCX / XLSX / PPTX / PDF 全套内置 | 无 | LobsterAI 完胜 |
| **视频生成** | Remotion 程序化生成视频 | 无 | LobsterAI 完胜 |
| **IM 远程操控** | 钉钉 + 飞书 + Telegram + Discord (4个) | Telegram (1个) | LobsterAI 覆盖广（尤其国内 IM） |
| **技能自扩展** | skill-creator 让 AI 自己创建新技能并热加载 | Skills 系统已接入但无自创建 | LobsterAI 更高级 |
| **记忆系统** | 5 种记忆类型 + 置信度排序 + 可调严格度 + LLM 判断过滤 | MemoryExtractor + 向量搜索 | LobsterAI 分类更精细；AgentClaw 有向量搜索 |
| **权限门控** | 敏感操作弹窗确认 | 无 | LobsterAI 更安全 |
| **Artifacts 预览** | HTML / SVG / Mermaid / React 组件实时渲染 | 无 | LobsterAI 前端体验好 |
| **LLM 提供商数量** | 11 个（含 DeepSeek/Kimi/智谱/通义等国产） | 4 个（Claude/OpenAI/Gemini/Ollama） | LobsterAI 数量多 |
| **AI 引擎灵活度** | 绑定 Claude Agent SDK（agent 循环依赖 Anthropic） | **自研 AgentLoop，任意 Provider 跑完整 agent 循环** | **AgentClaw 胜** |
| **图片生成/处理** | 无 | **ComfyUI 文生图 + 去背景 + 4x 放大** | **AgentClaw 胜** |
| **浏览器控制** | Playwright 自动化（独立实例） | **CDP 连接用户真实 Chrome（带登录态）** | **AgentClaw 胜** |
| **部署形态** | Electron 桌面应用（必须本地装） | **Web + Gateway 服务（远程部署，多端访问）** | **AgentClaw 更灵活** |
| **工具重试** | 未提及 | **指数退避重试** | **AgentClaw 胜** |
| **定时任务** | Cron 调度 | TaskScheduler + set_reminder | 持平 |
| **网页搜索** | Playwright 驱动 Chrome 搜索 | web_search 工具 | 持平 |
| **Planner** | create-plan 技能 | plan_task 工具 + SimplePlanner | 持平 |
| **数据隐私** | 全本地 SQLite | 全本地 SQLite | 持平 |

### 最值得借鉴的方向（优先级排序）

1. **沙箱执行** — 让 agent 安全执行任意代码，是能力天花板的关键
2. **Office 文档生成** — DOCX/XLSX/PPTX 高频刚需，加上就是巨大实用性提升
3. **技能自创建** — 让 AI 自己写新技能并热加载，指数级扩展能力
4. **更多 IM 网关** — 钉钉、飞书对国内用户至关重要
5. **权限门控** — 敏感操作需用户确认，提升安全性
6. **Artifacts 渲染** — 前端实时预览 HTML/SVG/Mermaid/React

---

## Current Focus（当前重点）

**Phase 6 完成！** ComfyUI 集成、Skills 激活、Planner 集成、工具重试均已实现。浏览器工具已升级为 CDP 模式（连接用户真实 Chrome）。

下一步优先方向（参考竞品对比）：
- 沙箱执行环境
- Office 文档生成工具（DOCX/XLSX/PPTX）
- 技能自创建（skill-creator）
- 更多 IM 网关（钉钉、飞书、Discord）
