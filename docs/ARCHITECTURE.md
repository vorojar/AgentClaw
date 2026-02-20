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
└────────┬────────┘
         │
    ┌────┴────┐
    │Tool Call?│
    │（调工具？）│
    └────┬────┘
    Yes  │  No
    ▼    │   ▼
┌───────┐│ ┌──────────┐
│Execute││ │Output    │
│Tool   ││ │Response  │
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

- **AgentLoop**: The think-act-observe cycle.（思考-行动-观察循环。）Receives user input, manages the conversation loop with the LLM, handles tool calls, and produces final responses.（接收用户输入，管理与 LLM 的对话循环，处理工具调用，生成最终回复。）
- **Planner**: Decomposes complex tasks into executable plans with steps and dependencies.（将复杂任务分解为带有步骤和依赖关系的可执行计划。）Monitors execution and adapts.（监控执行并自适应调整。）
- **ContextManager**: Builds the optimal context window for each LLM call by combining system prompts, conversation history, memory retrieval results, and active skill instructions.（通过组合系统提示、对话历史、记忆检索结果和活跃技能指令，为每次 LLM 调用构建最优上下文窗口。）
- **Orchestrator**: Top-level coordinator.（顶层协调器。）Manages sessions, routes between simple chat and complex planning, handles lifecycle.（管理会话，在简单对话和复杂规划之间路由，处理生命周期。）

### packages/providers（模型提供商包）

LLM abstraction layer:（LLM 抽象层：）

- **Provider interface**: Unified API for all LLM providers (chat, stream, embed).（统一的 LLM 提供商 API，支持对话、流式输出、嵌入。）
- **ClaudeProvider**: Anthropic Claude API adapter.（Anthropic Claude API 适配器。）
- **OpenAIProvider**: OpenAI API adapter.（OpenAI API 适配器。）
- **OllamaProvider**: Local Ollama adapter.（本地 Ollama 适配器。）
- **Router**: Intelligent model selection based on task type (planning → Opus, coding → Sonnet, chat → Haiku, classification → local).（基于任务类型的智能模型选择：规划 → Opus，编码 → Sonnet，对话 → Haiku，分类 → 本地模型。）

### packages/tools（工具包）

Tool system with three tiers:（三层工具系统：）

- **Built-in**: shell, file-read, file-write, web-search, web-fetch, ask-user（内置工具：命令行、文件读写、网页搜索、网页抓取、询问用户）
- **External**: claude-code, codex, browser (Playwright)（外部工具：Claude Code、Codex、浏览器 Playwright）
- **MCP**: Connect to any MCP Server, auto-discover and adapt tools（MCP 协议：连接任意 MCP 服务器，自动发现和适配工具）

Each tool implements a standard interface: `{ name, description, parameters, execute() }`.（每个工具实现标准接口：`{ name, description, parameters, execute() }`。）

### packages/memory（记忆包）

Persistent memory backed by SQLite:（基于 SQLite 的持久化记忆：）

- **Short-term**: Conversation history (turns table)（短期记忆：对话历史，turns 表）
- **Long-term**: Extracted facts, preferences, entities (with vector embeddings)（长期记忆：提取的事实、偏好、实体，带向量嵌入）
- **Episodic**: Task records, lessons learned (completed plans and results)（情景记忆：任务记录、经验教训，已完成的计划和结果）
- **Hybrid retrieval**: `semantic_similarity × 0.5 + recency × 0.2 + importance × 0.3`（混合检索：语义相似度 × 0.5 + 时效性 × 0.2 + 重要性 × 0.3）

### packages/cli（命令行包）

CLI interface using Commander.js + Ink:（使用 Commander.js + Ink 的命令行界面：）

- `agentclaw` / `ac` commands（`agentclaw` / `ac` 命令）
- Interactive chat mode（交互式对话模式）
- Task management commands（任务管理命令）
- Configuration management（配置管理）

### packages/gateway（网关包）

Background daemon:（后台守护进程：）

- Fastify HTTP server + WebSocket（Fastify HTTP 服务器 + WebSocket）
- RESTful API for all operations（所有操作的 RESTful API）
- WebSocket for real-time streaming（WebSocket 实时流式传输）
- Scheduled task execution（定时任务执行）

## TypeScript Interfaces (Key Types)（TypeScript 接口，核心类型）

See `packages/types/src/` for complete definitions.（完整定义见 `packages/types/src/`。）Key interfaces:（核心接口：）

- `Message` — Chat message with role, content, tool calls（聊天消息，包含角色、内容、工具调用）
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
