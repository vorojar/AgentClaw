# AgentClaw

> 你的 24/7 AI 指挥官——一个理解意图、规划任务、调度工具、记住一切的智能调度中心。

AgentClaw 是一个指挥官级别的个人 AI 助理。它自己不写代码（调用 Claude Code/Codex），自己不搜索（调用搜索工具），但它理解你的意图、规划复杂任务、调度合适的工具，并一直在后台运行。

## 架构

```
你（老板）
  │
  ▼
AgentClaw（指挥官）
  ├── LLM 提供商 (Claude, OpenAI, Gemini, DeepSeek, Kimi, MiniMax, Qwen, Ollama)
  ├── 工具 (shell, 文件读写, ask-user, 未来: web-search, claude-code, MCP...)
  ├── 记忆 (对话历史, 未来: 事实/偏好/实体/经验)
  └── 技能 (未来: 编码, 研究, 写作, 自定义...)
```

## 技术栈

- **语言**: TypeScript monorepo (pnpm + Turborepo)
- **LLM**: Claude（主力）+ OpenAI + Gemini + DeepSeek + Kimi + MiniMax + Qwen + Ollama
- **存储**: SQLite (better-sqlite3)，未来加 sqlite-vec 向量搜索
- **CLI**: Node.js readline 交互式对话
- **Web UI**: React + Vite（Phase 3）
- **守护进程**: Fastify HTTP + WebSocket（Phase 3）
- **构建**: tsup + Turborepo

## 项目结构

```
agentclaw/
├── packages/
│   ├── types/       — 共享类型定义（所有接口）
│   ├── core/        — Agent Loop, Context Manager, Orchestrator
│   ├── providers/   — LLM 适配器 (Claude, OpenAI兼容, Gemini) + Router
│   ├── tools/       — 工具系统 (shell, file-read/write, ask-user)
│   ├── memory/      — 记忆系统 (SQLite 对话历史)
│   ├── cli/         — CLI 入口 (agentclaw / ac)
│   ├── gateway/     — 守护进程 + HTTP API（Phase 3）
│   └── web/         — Web UI（Phase 3）
├── skills/          — 技能定义（Phase 2）
├── docs/            — 项目文档
└── data/            — 运行时数据 (gitignored)
```

## 快速开始

### 前置要求

- Node.js >= 20
- pnpm >= 9

### 安装

```bash
git clone <repo-url> agentclaw
cd agentclaw
pnpm install
pnpm build
```

### 配置

```bash
cp .env.example .env
# 编辑 .env，填入你的 API key
```

### 运行

```bash
# 使用 Claude（默认）
ANTHROPIC_API_KEY=你的key node packages/cli/dist/index.js

# 使用 OpenAI
OPENAI_API_KEY=你的key node packages/cli/dist/index.js --provider openai

# 使用 DeepSeek
DEEPSEEK_API_KEY=你的key node packages/cli/dist/index.js --provider deepseek

# 使用 Ollama（本地，无需 API key）
node packages/cli/dist/index.js --provider ollama

# 查看帮助
node packages/cli/dist/index.js --help
```

## 支持的 LLM 提供商

| 提供商 | 环境变量 | --provider 参数 |
|--------|----------|----------------|
| Claude (Anthropic) | `ANTHROPIC_API_KEY` | `claude` |
| OpenAI | `OPENAI_API_KEY` | `openai` |
| Gemini (Google) | `GEMINI_API_KEY` | `gemini` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek` |
| Kimi (月之暗面) | `MOONSHOT_API_KEY` | `kimi` |
| MiniMax | `MINIMAX_API_KEY` | `minimax` |
| Qwen (通义千问) | `DASHSCOPE_API_KEY` | `qwen` |
| Ollama (本地) | `OLLAMA_BASE_URL` | `ollama` |

## 内置工具

| 工具 | 名称 | 说明 |
|------|------|------|
| Shell | `shell` | 执行命令行命令 |
| 文件读取 | `file_read` | 读取文件内容 |
| 文件写入 | `file_write` | 写入文件（自动创建目录） |
| 询问用户 | `ask_user` | 在终端向用户提问 |

## 文档

- [架构设计](docs/ARCHITECTURE.md) — 系统设计、数据流、数据库结构
- [路线图](docs/ROADMAP.md) — 开发阶段和任务清单

## License

MIT
