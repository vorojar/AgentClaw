# AgentClaw Roadmap

## Phase 1: Foundation — "能跑起来" (Make it Run)

**Goal**: CLI + Claude + basic tools + conversation memory

### 1.1 Project Setup
- [x] Monorepo structure (pnpm + Turborepo)
- [x] TypeScript configuration
- [x] Shared types package
- [x] Build pipeline (tsup)

### 1.2 Core Agent Loop
- [ ] Basic AgentLoop implementation (think-act-observe cycle)
- [ ] ContextManager (system prompt + history)
- [ ] Simple Orchestrator (single session)

### 1.3 LLM Provider — Claude
- [ ] Claude provider (Anthropic SDK)
- [ ] Streaming support
- [ ] Tool call handling
- [ ] Basic error handling + retry

### 1.4 Built-in Tools
- [ ] Shell execution tool
- [ ] File read/write tools
- [ ] Ask-user tool (CLI prompt)

### 1.5 Memory — Basic
- [ ] SQLite database setup
- [ ] Conversation storage (conversations + turns)
- [ ] History retrieval for context

### 1.6 CLI
- [ ] Commander.js setup (`agentclaw` / `ac`)
- [ ] Interactive chat mode (Ink)
- [ ] Basic configuration (API keys)
- [ ] Chat history display

### 1.7 Integration
- [ ] End-to-end flow: user → CLI → agent → Claude → tool → response
- [ ] Basic error handling
- [ ] Graceful shutdown

---

## Phase 2: Intelligence — "变聪明" (Get Smart)

**Goal**: Multi-model routing + Planner + external tool integration + Skills

### 2.1 Multi-Model Support
- [ ] OpenAI provider
- [ ] Ollama provider (local models)
- [ ] LLM Router (task type → model selection)
- [ ] Cost tracking

### 2.2 Planner
- [ ] Task decomposition
- [ ] Step dependency management
- [ ] Execution monitoring
- [ ] Re-planning on failure

### 2.3 External Tools
- [ ] Claude Code integration
- [ ] Codex integration
- [ ] Web search tool
- [ ] Web fetch tool

### 2.4 MCP Protocol
- [ ] MCP client implementation
- [ ] Auto-discovery of tools from MCP servers
- [ ] Tool adapter layer

### 2.5 Memory — Advanced
- [ ] Vector embeddings (sqlite-vec)
- [ ] Long-term memory extraction (facts, preferences, entities)
- [ ] Hybrid retrieval (semantic + recency + importance)
- [ ] Memory consolidation

### 2.6 Skill System
- [ ] SKILL.md parser (YAML frontmatter + instructions)
- [ ] Trigger matching (keywords + intent)
- [ ] Skill injection into context
- [ ] Built-in skills (coding, research, writing)

---

## Phase 3: Always On — "一直在" (Always There)

**Goal**: Background daemon + scheduled tasks + Web UI

### 3.1 Gateway Daemon
- [ ] Fastify HTTP server
- [ ] WebSocket support
- [ ] Session management API
- [ ] Background task queue

### 3.2 Scheduled Tasks
- [ ] Cron-based task scheduling
- [ ] Recurring check-ins
- [ ] Proactive notifications

### 3.3 Web UI
- [ ] React + Vite setup
- [ ] Chat interface
- [ ] Task/Plan visualization
- [ ] Memory browser
- [ ] Settings panel

---

## Phase 4: Everywhere — "到处在" (Be Everywhere)

**Goal**: Multi-platform bot integration

### 4.1 Telegram Bot
- [ ] Telegram Bot API integration
- [ ] Message handling
- [ ] Rich message formatting

### 4.2 Discord Bot
- [ ] Discord.js integration
- [ ] Slash commands
- [ ] Thread support

### 4.3 WeChat Integration
- [ ] WeChat API adapter
- [ ] Message sync

---

## Current Focus

**Phase 1.1** — Project foundation is set up. Next: implement Phase 1.2 (Core Agent Loop).
