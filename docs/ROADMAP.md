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

## Phase 2: Intelligence — "变聪明" (Get Smart)（第二阶段：智能——让它变聪明）

**Goal**: Planner + external tool integration + Skills（目标：规划器 + 外部工具集成 + 技能系统）

### 2.1 Advanced Routing（高级路由）
- [ ] Cost tracking per provider/model（每个提供商/模型的成本追踪）
- [ ] Automatic fallback on provider failure（提供商失败时自动切换）
- [ ] Task-type based routing rules（基于任务类型的路由规则）

### 2.2 Planner（规划器）
- [ ] Task decomposition（任务分解）
- [ ] Step dependency management（步骤依赖管理）
- [ ] Execution monitoring（执行监控）
- [ ] Re-planning on failure（失败时重新规划）

### 2.3 External Tools（外部工具）
- [ ] Claude Code integration（Claude Code 集成）
- [ ] Codex integration（Codex 集成）
- [ ] Web search tool（网页搜索工具）
- [ ] Web fetch tool（网页抓取工具）

### 2.4 MCP Protocol（MCP 协议）
- [ ] MCP client implementation（MCP 客户端实现）
- [ ] Auto-discovery of tools from MCP servers（从 MCP 服务器自动发现工具）
- [ ] Tool adapter layer（工具适配层）

### 2.5 Memory — Advanced（记忆——高级版）
- [ ] Vector embeddings (sqlite-vec)（向量嵌入，基于 sqlite-vec）
- [ ] Long-term memory extraction (facts, preferences, entities)（长期记忆提取：事实、偏好、实体）
- [ ] Hybrid retrieval (semantic + recency + importance)（混合检索：语义 + 时效 + 重要性）
- [ ] Memory consolidation（记忆整合）

### 2.6 Skill System（技能系统）
- [ ] SKILL.md parser (YAML frontmatter + instructions)（SKILL.md 解析器：YAML 元数据 + 指令）
- [ ] Trigger matching (keywords + intent)（触发匹配：关键词 + 意图）
- [ ] Skill injection into context（技能注入上下文）
- [ ] Built-in skills (coding, research, writing)（内置技能：编码、研究、写作）

---

## Phase 3: Always On — "一直在" (Always There)（第三阶段：常驻——让它一直在）

**Goal**: Background daemon + scheduled tasks + Web UI（目标：后台守护进程 + 定时任务 + Web 界面）

### 3.1 Gateway Daemon（网关守护进程）
- [ ] Fastify HTTP server（Fastify HTTP 服务器）
- [ ] WebSocket support（WebSocket 支持）
- [ ] Session management API（会话管理 API）
- [ ] Background task queue（后台任务队列）

### 3.2 Scheduled Tasks（定时任务）
- [ ] Cron-based task scheduling（基于 Cron 的任务调度）
- [ ] Recurring check-ins（定期检查）
- [ ] Proactive notifications（主动通知）

### 3.3 Web UI（Web 界面）
- [ ] React + Vite setup（React + Vite 项目搭建）
- [ ] Chat interface（对话界面）
- [ ] Task/Plan visualization（任务/计划可视化）
- [ ] Memory browser（记忆浏览器）
- [ ] Settings panel（设置面板）

---

## Phase 4: Everywhere — "到处在" (Be Everywhere)（第四阶段：无处不在——让它到处在）

**Goal**: Multi-platform bot integration（目标：多平台机器人集成）

### 4.1 Telegram Bot（Telegram 机器人）
- [ ] Telegram Bot API integration（Telegram Bot API 集成）
- [ ] Message handling（消息处理）
- [ ] Rich message formatting（富文本消息格式）

### 4.2 Discord Bot（Discord 机器人）
- [ ] Discord.js integration（Discord.js 集成）
- [ ] Slash commands（斜杠命令）
- [ ] Thread support（线程支持）

### 4.3 WeChat Integration（微信集成）
- [ ] WeChat API adapter（微信 API 适配器）
- [ ] Message sync（消息同步）

---

## Current Focus（当前重点）

**Phase 1** — Completed!（已完成！）Next: Phase 2 (Planner + Skills + External Tools).（下一步：第二阶段，规划器 + 技能系统 + 外部工具。）
