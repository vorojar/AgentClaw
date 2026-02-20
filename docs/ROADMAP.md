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
---

## Current Focus（当前重点）

**Phase 3** — Completed!（已完成！）Next: Phase 4 (Telegram + Discord + WeChat bot integrations).（下一步：第四阶段，Telegram + Discord + 微信机器人集成。）
