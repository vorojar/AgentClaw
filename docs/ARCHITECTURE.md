# AgentClaw Architecture（架构）

## Overview（概览）

AgentClaw is a commander-level AI dispatch center — a 24/7 personal assistant that understands intent, plans tasks, dispatches tools, and remembers everything.（AgentClaw 是一个指挥官级别的 AI 调度中心——一个 24/7 全天候个人助理，能理解意图、规划任务、调度工具，并记住一切。）It doesn't write code itself (it calls Claude Code/Codex), doesn't search itself (it calls search tools), but it orchestrates everything.（它自己不写代码（调用 Claude Code/Codex），自己不搜索（调用搜索工具），但它负责协调一切。）

## System Architecture（系统架构）

```
┌─────────────────────────────────────────────────────┐
│                     User Interfaces                  │
│                     （用户界面）                       │
│  ┌─────────┐  ┌──────────┐  ┌─────────────────────┐│
│  │   CLI   │  │  Web UI  │  │  Bots (TG/Discord)  ││
│  └────┬────┘  └────┬─────┘  └──────────┬──────────┘│
│       └─────────────┼──────────────────┘            │
│                     ▼                                │
│  ┌──────────────────────────────────────────────┐   │
│  │              Gateway (Fastify)                │   │
│  │         HTTP API + WebSocket                  │   │
│  └─────────────────┬────────────────────────────┘   │
│                     ▼                                │
│  ┌──────────────────────────────────────────────┐   │
│  │                  Core（核心）                  │   │
│  │  ┌────────────┐  ┌──────────────────────┐    │   │
│  │  │ Agent Loop │  │    Orchestrator      │    │   │
│  │  │（智能循环） │  │   （编排器）          │    │   │
│  │  └─────┬──────┘  └──────────┬───────────┘    │   │
│  │        │                     │                │   │
│  │  ┌─────▼──────┐  ┌──────────▼───────────┐    │   │
│  │  │  Planner   │  │  Context Manager     │    │   │
│  │  │ （规划器）  │  │  （上下文管理器）     │    │   │
│  │  └────────────┘  └──────────────────────┘    │   │
│  └─────────────────┬────────────────────────────┘   │
│                     │                                │
│       ┌─────────────┼─────────────┐                 │
│       ▼             ▼             ▼                  │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐           │
│  │Providers│  │  Tools   │  │ Memory   │           │
│  │（模型层）│  │ （工具） │  │ （记忆） │           │
│  └─────────┘  └──────────┘  └──────────┘           │
└─────────────────────────────────────────────────────┘
```

## Data Flow（数据流）

### Streaming Data Flow with Usage Statistics（流式数据流与用量统计）

```
Provider.stream()  →  AgentLoop.runStream()  →  Orchestrator  →  Gateway(WS/TG)  →  前端
  done chunk 携带         累加 tokensIn/Out       透传 Message      WS done 携带       渲染灰色
  usage + model          计时 durationMs         含统计字段        统计字段/TG 追加行   统计行
```

三个 Provider 在流式 done chunk 中返回 `{ usage: { tokensIn, tokensOut }, model }`：
- **OpenAI Compatible**: `stream_options: { include_usage: true }`，从最后一个 chunk 的 `chunk.usage` 提取
- **Claude**: 从 `message_start`（input_tokens）和 `message_delta`（output_tokens）事件中提取
- **Gemini**: 从每个 `chunk.usageMetadata` 持续更新

AgentLoop 跨多轮 LLM 调用累加 token、工具次数、计时，最终写入 Message 和 ConversationTurn。

### Agent Loop (Core Cycle)（智能循环，核心周期）

```
User Input（用户输入）
    │
    ▼
┌─────────────────┐
│ Understand Intent│ ← Memory (past context, preferences)
│ （理解意图）      │ ←（记忆：历史上下文、偏好）
└────────┬────────┘
         ▼
┌─────────────────┐
│ Build Context   │ ← Memory retrieval (semantic + recency + importance)
│ （构建上下文）   │ ←（记忆检索：语义 + 时效 + 重要性）
└────────┬────────┘
         ▼
┌─────────────────┐
│ LLM Thinking    │ ← Provider Router selects model
│ （LLM 思考）     │ ←（路由器选择模型）
└────────┬────────┘  done chunk → 累加 tokensIn/Out, 记录 model
         │
    ┌────┴────┐
    │Tool Call?│
    │（调工具？）│
    └────┬────┘
    Yes  │  No
    ▼    │   ▼
┌───────┐│ ┌──────────┐
│Execute││ │Output    │ → Message 携带 model/tokensIn/tokensOut/
│Tool   ││ │Response  │   durationMs/toolCallCount
│（执行）││ │（输出）   │
└───┬───┘│ └────┬─────┘
    │    │      │
    ▼    │      ▼
┌───────┐│ ┌──────────┐
│Observe││ │Store     │
│Result ││ │Memory    │
│（观察）││ │（存储记忆）│
└───┬───┘│ └──────────┘
    │    │
    └──→ Loop back to LLM Thinking（循环回到 LLM 思考）
         totalToolCalls += toolCalls.length
```

### Planner Flow（规划器流程）

For complex tasks, the Planner decomposes them:（对于复杂任务，规划器会将其分解：）

```
Complex Task（复杂任务）
    │
    ▼
┌────────────────┐
│  Decompose     │ → Plan { steps[], dependencies }
│  （分解）       │ →（计划：步骤列表、依赖关系）
└────────┬───────┘
         ▼
┌────────────────┐
│ Execute Steps  │ → Each step goes through Agent Loop
│ （执行步骤）    │ →（每个步骤经过智能循环）
└────────┬───────┘
         ▼
┌────────────────┐
│ Monitor & Adapt│ → Re-plan if needed
│ （监控与调整）  │ →（需要时重新规划）
└────────┬───────┘
         ▼
┌────────────────┐
│ Synthesize     │ → Combine results, report to user
│ （综合）        │ →（合并结果，向用户报告）
└────────────────┘
```

## Module Design（模块设计）

### packages/types（类型包）

Shared TypeScript interfaces.（共享的 TypeScript 接口定义。）Zero runtime dependencies.（零运行时依赖。）Every other package depends on this.（所有其他包都依赖于它。）

### packages/core（核心包）

The brain of the system:（系统的大脑：）

- **AgentLoop**: The think-act-observe cycle with automatic retry.（思考-行动-观察循环，带自动重试。）Receives user input, manages the conversation loop with the LLM, handles tool calls with exponential backoff retry for network tools (comfyui/http_request/web_search/web_fetch), and produces final responses.（接收用户输入，管理与 LLM 的对话循环，网络类工具失败自动重试（指数退避），生成最终回复。）
- **Planner** ✅: Decomposes complex tasks into executable plans with steps and dependencies via LLM.（通过 LLM 将复杂任务分解为带有步骤和依赖关系的可执行计划。）Exposed as built-in `plan_task` tool so the LLM can invoke it autonomously.（作为内置 `plan_task` 工具暴露，LLM 可自主调用。）Executes steps through AgentLoop, monitors progress, and re-plans on failure.（通过 AgentLoop 执行步骤，监控进度，失败时自动重规划。）
- **ContextManager**: Builds the optimal context window for each LLM call by combining system prompts, conversation history, memory retrieval results, and **matched skill instructions**.（通过组合系统提示、对话历史、记忆检索结果和**匹配的技能指令**，为每次 LLM 调用构建最优上下文窗口。）Skills are dynamically matched against user input and injected when confidence > 0.3.（技能根据用户输入动态匹配，confidence > 0.3 时注入。）
- **Orchestrator**: Top-level coordinator.（顶层协调器。）Manages sessions, injects skill/planner/scheduler into tool execution context, handles lifecycle.（管理会话，将 skill/planner/scheduler 注入工具执行上下文，处理生命周期。）
- **SkillRegistry** ✅: Loads skills from SKILL.md files (YAML frontmatter + natural language instructions).（从 SKILL.md 文件加载技能：YAML 元数据 + 自然语言指令。）Matches user input via keyword/intent triggers and injects instructions into system prompt.（通过关键词/意图触发器匹配用户输入，并将指令注入系统提示词。）
- **MemoryExtractor** ✅: Uses LLM to extract long-term memories (facts, preferences, entities, episodic) from conversations.（使用 LLM 从对话中提取长期记忆：事实、偏好、实体、情景。）Runs periodically every 5 turns.（每 5 轮对话自动运行。）

### packages/providers（模型提供商包）

LLM abstraction layer with 3 adapters covering 8+ providers:（LLM 抽象层，3 个适配器覆盖 8+ 提供商：）

- **BaseLLMProvider**: Abstract base class with shared logic.（抽象基类，包含通用逻辑。）
- **ClaudeProvider**: Anthropic Claude API adapter (@anthropic-ai/sdk).（Anthropic Claude API 适配器。）
- **OpenAICompatibleProvider**: One adapter for all OpenAI-compatible APIs — OpenAI, DeepSeek, Kimi, MiniMax, Qwen, Ollama, etc.（一个适配器通吃所有 OpenAI 兼容 API——OpenAI、DeepSeek、Kimi、MiniMax、通义千问、Ollama 等。）Just configure baseUrl + apiKey.（只需配置 baseUrl + apiKey。）
- **GeminiProvider**: Google Gemini API adapter (@google/genai).（Google Gemini API 适配器。）
- **SmartRouter** ✅: Intelligent model selection based on task type with cost tracking, auto-fallback on failure, and tier-based routing (planning→flagship, coding→standard, chat→fast).（基于任务类型的智能模型选择，含成本追踪、故障自动切换、tier 路由。）

### packages/tools（工具包）

Tool system with three tiers:（三层工具系统：）

- **Built-in** ✅: shell, file-read, file-write, web-search, web-fetch, ask-user, remember, set-reminder, schedule, send-file, python, http-request, browser, comfyui, plan-task（内置工具：命令行、文件读写、网页搜索、网页抓取、询问用户、记忆、提醒、定时任务、发送文件、Python 执行、HTTP 请求、浏览器、ComfyUI 图片处理、任务规划）
- **External**: claude-code, codex — future（外部工具：Claude Code、Codex——未来计划）
- **MCP** ✅: MCPClient (stdio + HTTP transport) + MCPManager for multi-server connections.（MCP 协议：MCPClient 支持 stdio + HTTP 传输 + MCPManager 管理多服务器连接。）Auto-discovers tools from MCP servers and adapts them to AgentClaw Tool interface.（自动从 MCP 服务器发现工具并适配为 AgentClaw Tool 接口。）

Each tool implements a standard interface: `{ name, description, parameters, execute() }`.（每个工具实现标准接口：`{ name, description, parameters, execute() }`。）

### packages/memory（记忆包）

Persistent memory backed by SQLite:（基于 SQLite 的持久化记忆：）

- **Short-term** ✅: Conversation history (turns table)（短期记忆：对话历史，turns 表）
- **Long-term** ✅: Extracted facts, preferences, entities via LLM MemoryExtractor, with vector embeddings (pure JS cosine similarity + bag-of-words fallback, LLM embed when available).（长期记忆：通过 LLM MemoryExtractor 提取的事实、偏好、实体，带向量嵌入——纯 JS 余弦相似度 + 词袋模型兜底，LLM embed 可用时自动使用。）
- **Episodic** ✅: Task records, lessons learned (completed plans and results)（情景记忆：任务记录、经验教训，已完成的计划和结果）
- **Hybrid retrieval** ✅: `semantic_similarity × 0.5 + recency × 0.2 + importance × 0.3` with exponential decay (half-life = 7 days) for recency scoring.（混合检索：语义相似度 × 0.5 + 时效性 × 0.2 + 重要性 × 0.3，时效性使用指数衰减，半衰期 7 天。）

### packages/cli（命令行包）

CLI interface using Node.js readline:（使用 Node.js readline 的命令行界面：）

- `agentclaw` / `ac` commands（`agentclaw` / `ac` 命令）
- Interactive chat mode with skill matching display（交互式对话模式，显示匹配的技能）
- Auto-loads skills from `skills/` directory on startup（启动时自动从 `skills/` 目录加载技能）
- Periodic memory extraction every 5 turns（每 5 轮对话自动提取长期记忆）
- Supports `--provider` flag for 8+ LLM providers（支持 `--provider` 参数切换 8+ 个 LLM 提供商）

### packages/gateway（网关包）✅

Background daemon powered by Fastify:（基于 Fastify 的后台守护进程：）

- **Server** ✅: Fastify HTTP server with CORS + WebSocket plugin.（Fastify HTTP 服务器 + CORS + WebSocket 插件。）`bootstrap.ts` initializes all core components (provider, tools, memory, orchestrator, planner, skills).（`bootstrap.ts` 初始化所有核心组件。）
- **REST API** ✅: 18 endpoints covering sessions (CRUD + chat + history), plans (list + detail), memories (search + delete), tools & skills (list), stats & config (get/update), scheduled tasks (CRUD).（18 个端点覆盖会话、计划、记忆、工具技能、统计配置、定时任务。）
- **WebSocket** ✅: Real-time streaming at `/ws?sessionId=xxx`.（`/ws?sessionId=xxx` 实时流式传输。）Maps AgentEvent types to client WSMessage format (text/tool_call/tool_result/done/error).（将 AgentEvent 类型映射为客户端 WSMessage 格式。）Done message carries usage stats (model/tokensIn/tokensOut/durationMs/toolCallCount).（done 消息携带用量统计。）
- **Scheduler** ✅: Cron-based task scheduling using `croner` library with CRUD API.（基于 croner 库的 Cron 任务调度 + CRUD API。）
- **Graceful shutdown**: Handles SIGINT/SIGTERM, stops scheduler and closes Fastify.（处理 SIGINT/SIGTERM，停止调度器并关闭 Fastify。）

### packages/web（Web UI 包）✅

React + Vite dark-themed Web UI:（基于 React + Vite 的深色主题 Web 界面：）

- **ChatPage** ✅: Real-time chat with WebSocket streaming, tool call cards (collapsible), session sidebar (collapsible), auto-scroll, empty state, reconnection banner, usage stats display on assistant messages (model/tokens/duration/tool count).（实时聊天：WebSocket 流式传输、可折叠工具调用卡片、可折叠会话侧栏、自动滚动、空状态、断连重连、assistant 消息底部显示用量统计。）
- **PlansPage** ✅: Plan list with status badges, expandable step timeline, dependency visualization, auto-refresh every 10s.（计划列表：状态徽章、可展开的步骤时间线、依赖可视化、每 10 秒自动刷新。）
- **MemoryPage** ✅: Memory browser with search (debounced 300ms), type filter, sort toggle (importance/time), importance stars, delete with confirmation.（记忆浏览器：搜索防抖 300ms、类型筛选、排序切换、重要度星级、删除确认。）
- **SettingsPage** ✅: Provider config (editable), usage statistics (4 cards + model breakdown table), tools list, skills list with toggle, scheduled tasks CRUD, system info.（设置面板：可编辑的提供商配置、使用统计、工具列表、技能开关、定时任务管理、系统信息。）
- **Design system**: CSS custom properties based dark theme, sidebar navigation with active state, responsive (768px breakpoint).（设计系统：基于 CSS 变量的深色主题、侧栏导航、响应式。）

## TypeScript Interfaces (Key Types)（TypeScript 接口，核心类型）

See `packages/types/src/` for complete definitions.（完整定义见 `packages/types/src/`。）Key interfaces:（核心接口：）

- `Message` — Chat message with role, content, tool calls, usage stats (model/tokensIn/tokensOut/durationMs/toolCallCount)（聊天消息，包含角色、内容、工具调用、用量统计）
- `LLMStreamChunk` — Streaming chunk; done chunk carries `usage` and `model`（流式片段；done chunk 携带 usage 和 model）
- `LLMProvider` — Unified LLM provider interface（统一的 LLM 提供商接口）
- `LLMRouter` — Model selection based on task type（基于任务类型的模型选择）
- `Tool` / `ToolRegistry` — Tool definition and registry（工具定义和注册表）
- `MemoryStore` / `MemoryEntry` — Memory storage and retrieval（记忆存储和检索）
- `AgentLoop` — Core agent cycle（核心智能循环）
- `Plan` / `PlanStep` — Task decomposition（任务分解）
- `Skill` — Skill definition and matching（技能定义和匹配）
- `Session` — Conversation session management（对话会话管理）

## SQLite Schema（SQLite 数据库结构）

### conversations（对话表）

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT -- JSON
);
```

### turns（对话轮次表）

```sql
CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  tool_calls TEXT, -- JSON array of tool calls（工具调用的 JSON 数组）
  tool_results TEXT, -- JSON array of tool results（工具结果的 JSON 数组）
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  duration_ms INTEGER, -- Response duration in milliseconds（响应耗时，毫秒）
  tool_call_count INTEGER, -- Number of tool calls executed（工具调用次数）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_turns_conversation ON turns(conversation_id, created_at);
```

### memories（记忆表）

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('fact', 'preference', 'entity', 'episodic')),
  content TEXT NOT NULL,
  source_turn_id TEXT REFERENCES turns(id),
  importance REAL NOT NULL DEFAULT 0.5,
  embedding BLOB, -- vector embedding for semantic search（用于语义搜索的向量嵌入）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT -- JSON
);
CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_importance ON memories(importance DESC);
```

### plans（计划表）

```sql
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  goal TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'completed', 'failed', 'cancelled')),
  steps TEXT NOT NULL, -- JSON array of PlanStep（计划步骤的 JSON 数组）
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
```

### skills（技能表）

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  triggers TEXT NOT NULL, -- JSON array of trigger patterns（触发模式的 JSON 数组）
  enabled INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0
);
```

## Design Principles（设计原则）

1. **Modularity**: Each package has a clear responsibility and can be developed/tested independently.（模块化：每个包有明确职责，可以独立开发和测试。）
2. **Provider Agnostic**: LLM provider can be swapped without changing core logic.（模型无关性：可以切换 LLM 提供商而不改变核心逻辑。）
3. **Memory-First**: Every interaction contributes to long-term memory, making the agent smarter over time.（记忆优先：每次交互都贡献长期记忆，让智能体随时间变得更聪明。）
4. **Tool Extensibility**: New tools can be added by implementing the Tool interface or connecting MCP servers.（工具可扩展：通过实现 Tool 接口或连接 MCP 服务器即可添加新工具。）
5. **Graceful Degradation**: If a provider or tool fails, the system falls back to alternatives.（优雅降级：当提供商或工具失败时，系统回退到备选方案。）
