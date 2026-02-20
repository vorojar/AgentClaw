# AgentClaw Architecture

## Overview

AgentClaw is a commander-level AI dispatch center — a 24/7 personal assistant that understands intent, plans tasks, dispatches tools, and remembers everything. It doesn't write code itself (it calls Claude Code/Codex), doesn't search itself (it calls search tools), but it orchestrates everything.

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                     User Interfaces                  │
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
│  │                  Core                         │   │
│  │  ┌────────────┐  ┌──────────────────────┐    │   │
│  │  │ Agent Loop │  │    Orchestrator      │    │   │
│  │  └─────┬──────┘  └──────────┬───────────┘    │   │
│  │        │                     │                │   │
│  │  ┌─────▼──────┐  ┌──────────▼───────────┐    │   │
│  │  │  Planner   │  │  Context Manager     │    │   │
│  │  └────────────┘  └──────────────────────┘    │   │
│  └─────────────────┬────────────────────────────┘   │
│                     │                                │
│       ┌─────────────┼─────────────┐                 │
│       ▼             ▼             ▼                  │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐           │
│  │Providers│  │  Tools   │  │ Memory   │           │
│  │(LLM)   │  │          │  │          │           │
│  └─────────┘  └──────────┘  └──────────┘           │
└─────────────────────────────────────────────────────┘
```

## Data Flow

### Agent Loop (Core Cycle)

```
User Input
    │
    ▼
┌─────────────────┐
│ Understand Intent│ ← Memory (past context, preferences)
└────────┬────────┘
         ▼
┌─────────────────┐
│ Build Context   │ ← Memory retrieval (semantic + recency + importance)
└────────┬────────┘
         ▼
┌─────────────────┐
│ LLM Thinking    │ ← Provider Router selects model
└────────┬────────┘
         │
    ┌────┴────┐
    │Tool Call?│
    └────┬────┘
    Yes  │  No
    ▼    │   ▼
┌───────┐│ ┌──────────┐
│Execute││ │Output    │
│Tool   ││ │Response  │
└───┬───┘│ └────┬─────┘
    │    │      │
    ▼    │      ▼
┌───────┐│ ┌──────────┐
│Observe││ │Store     │
│Result ││ │Memory    │
└───┬───┘│ └──────────┘
    │    │
    └──→ Loop back to LLM Thinking
```

### Planner Flow

For complex tasks, the Planner decomposes them:

```
Complex Task
    │
    ▼
┌────────────────┐
│  Decompose     │ → Plan { steps[], dependencies }
└────────┬───────┘
         ▼
┌────────────────┐
│ Execute Steps  │ → Each step goes through Agent Loop
└────────┬───────┘
         ▼
┌────────────────┐
│ Monitor & Adapt│ → Re-plan if needed
└────────┬───────┘
         ▼
┌────────────────┐
│ Synthesize     │ → Combine results, report to user
└────────────────┘
```

## Module Design

### packages/types

Shared TypeScript interfaces. Zero runtime dependencies. Every other package depends on this.

### packages/core

The brain of the system:

- **AgentLoop**: The think-act-observe cycle. Receives user input, manages the conversation loop with the LLM, handles tool calls, and produces final responses.
- **Planner**: Decomposes complex tasks into executable plans with steps and dependencies. Monitors execution and adapts.
- **ContextManager**: Builds the optimal context window for each LLM call by combining system prompts, conversation history, memory retrieval results, and active skill instructions.
- **Orchestrator**: Top-level coordinator. Manages sessions, routes between simple chat and complex planning, handles lifecycle.

### packages/providers

LLM abstraction layer:

- **Provider interface**: Unified API for all LLM providers (chat, stream, embed).
- **ClaudeProvider**: Anthropic Claude API adapter.
- **OpenAIProvider**: OpenAI API adapter.
- **OllamaProvider**: Local Ollama adapter.
- **Router**: Intelligent model selection based on task type (planning → Opus, coding → Sonnet, chat → Haiku, classification → local).

### packages/tools

Tool system with three tiers:

- **Built-in**: shell, file-read, file-write, web-search, web-fetch, ask-user
- **External**: claude-code, codex, browser (Playwright)
- **MCP**: Connect to any MCP Server, auto-discover and adapt tools

Each tool implements a standard interface: `{ name, description, parameters, execute() }`.

### packages/memory

Persistent memory backed by SQLite:

- **Short-term**: Conversation history (turns table)
- **Long-term**: Extracted facts, preferences, entities (with vector embeddings)
- **Episodic**: Task records, lessons learned (completed plans and results)
- **Hybrid retrieval**: `semantic_similarity × 0.5 + recency × 0.2 + importance × 0.3`

### packages/cli

CLI interface using Commander.js + Ink:

- `agentclaw` / `ac` commands
- Interactive chat mode
- Task management commands
- Configuration management

### packages/gateway

Background daemon:

- Fastify HTTP server + WebSocket
- RESTful API for all operations
- WebSocket for real-time streaming
- Scheduled task execution

## TypeScript Interfaces (Key Types)

See `packages/types/src/` for complete definitions. Key interfaces:

- `Message` — Chat message with role, content, tool calls
- `LLMProvider` — Unified LLM provider interface
- `LLMRouter` — Model selection based on task type
- `Tool` / `ToolRegistry` — Tool definition and registry
- `MemoryStore` / `MemoryEntry` — Memory storage and retrieval
- `AgentLoop` — Core agent cycle
- `Plan` / `PlanStep` — Task decomposition
- `Skill` — Skill definition and matching
- `Session` — Conversation session management

## SQLite Schema

### conversations

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT -- JSON
);
```

### turns

```sql
CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  tool_calls TEXT, -- JSON array of tool calls
  tool_results TEXT, -- JSON array of tool results
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_turns_conversation ON turns(conversation_id, created_at);
```

### memories

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('fact', 'preference', 'entity', 'episodic')),
  content TEXT NOT NULL,
  source_turn_id TEXT REFERENCES turns(id),
  importance REAL NOT NULL DEFAULT 0.5,
  embedding BLOB, -- vector embedding for semantic search
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT -- JSON
);
CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_importance ON memories(importance DESC);
```

### plans

```sql
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  goal TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'completed', 'failed', 'cancelled')),
  steps TEXT NOT NULL, -- JSON array of PlanStep
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
```

### skills

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  triggers TEXT NOT NULL, -- JSON array of trigger patterns
  enabled INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0
);
```

## Design Principles

1. **Modularity**: Each package has a clear responsibility and can be developed/tested independently.
2. **Provider Agnostic**: LLM provider can be swapped without changing core logic.
3. **Memory-First**: Every interaction contributes to long-term memory, making the agent smarter over time.
4. **Tool Extensibility**: New tools can be added by implementing the Tool interface or connecting MCP servers.
5. **Graceful Degradation**: If a provider or tool fails, the system falls back to alternatives.
