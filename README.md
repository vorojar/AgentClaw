# AgentClaw

> Your 24/7 AI Commander — an intelligent dispatch center that understands intent, plans tasks, orchestrates tools, and remembers everything.

AgentClaw is a personal AI assistant that acts as a commander-level orchestrator. It doesn't write code itself (it calls Claude Code/Codex), doesn't search itself (it calls search tools), but it understands your intent, plans complex tasks, dispatches the right tools, and keeps running in the background.

## Architecture

```
You (the boss)
  │
  ▼
AgentClaw (commander)
  ├── LLM Providers (Claude, OpenAI, Ollama)
  ├── Tools (shell, files, web, claude-code, codex, MCP...)
  ├── Memory (conversations, facts, preferences, experiences)
  └── Skills (coding, research, writing, custom...)
```

## Tech Stack

- **Language**: TypeScript monorepo (pnpm + Turborepo)
- **LLM**: Claude (primary) + OpenAI + Ollama with intelligent routing
- **Storage**: SQLite + sqlite-vec for vector search
- **CLI**: Commander.js + Ink
- **Web UI**: React + Vite (Phase 3)
- **Daemon**: Fastify HTTP + WebSocket
- **Build**: tsup + Turborepo

## Project Structure

```
agentclaw/
├── packages/
│   ├── types/       — Shared type definitions
│   ├── core/        — Agent Loop, Planner, Context Manager, Orchestrator
│   ├── providers/   — LLM adapters (Claude, OpenAI, Ollama) + Router
│   ├── tools/       — Tool system (built-in + external + MCP)
│   ├── memory/      — Memory system (SQLite + vector search)
│   ├── cli/         — CLI entry point (agentclaw / ac)
│   ├── gateway/     — Daemon + HTTP API
│   └── web/         — Web UI (Phase 3)
├── skills/          — Skill definitions (SKILL.md)
├── docs/            — Documentation
└── data/            — Runtime data (gitignored)
```

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 9

### Setup

```bash
# Clone and install
git clone <repo-url> agentclaw
cd agentclaw
pnpm install

# Configure
cp .env.example .env
# Edit .env with your API keys

# Build
pnpm build

# Run
pnpm dev
```

### CLI Usage

```bash
# Interactive chat
agentclaw chat

# Or use the short alias
ac chat

# One-shot command
ac "help me refactor the auth module"
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — System design, data flow, schemas
- [Roadmap](docs/ROADMAP.md) — Development phases and task list

## License

MIT
