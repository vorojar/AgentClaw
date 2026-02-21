# AgentClaw

> 你的 24/7 AI 指挥官——一个理解意图、规划任务、调度工具、记住一切的智能调度中心。

AgentClaw 是一个指挥官级别的个人 AI 助理。它自己不写代码（调用 Claude Code/Codex），自己不搜索（调用搜索工具），但它理解你的意图、规划复杂任务、调度合适的工具，并一直在后台运行。

启动 pnpm start（web ui和gateway和telegram bot）
启动 pnpm cli
配置 .env 

## 架构

```
你（老板）
  │
  ▼
AgentClaw（指挥官）
  ├── LLM 提供商 (Claude, OpenAI, Gemini, DeepSeek, Kimi, MiniMax, Qwen, Ollama)
  ├── 智能路由 (成本追踪, 自动故障切换, 任务类型路由)
  ├── 工具 (shell, 文件读写, ask-user, web-search, web-fetch, MCP)
  ├── 记忆 (对话历史 + 长期记忆: 事实/偏好/实体/经验, 混合检索)
  ├── 规划器 (任务分解 → 步骤依赖 → 执行监控 → 失败重规划)
  └── 技能 (coding, research, writing, 自定义...)
```

## 技术栈

- **语言**: TypeScript monorepo (pnpm + Turborepo)
- **LLM**: Claude（主力）+ OpenAI + Gemini + DeepSeek + Kimi + MiniMax + Qwen + Ollama
- **存储**: SQLite (better-sqlite3) + 纯 JS 向量嵌入（余弦相似度 + 词袋模型）
- **CLI**: Node.js readline 交互式对话
- **MCP**: Model Context Protocol 客户端（stdio + HTTP 传输）
- **Web UI**: React + Vite（深色主题，4 页面：Chat/Plans/Memory/Settings）
- **守护进程**: Fastify HTTP + WebSocket + Cron 调度器
- **构建**: tsup + Turborepo

## 项目结构

```
agentclaw/
├── packages/
│   ├── types/       — 共享类型定义（所有接口）
│   ├── core/        — Agent Loop, Planner, Context Manager, Orchestrator, Skills, MemoryExtractor
│   ├── providers/   — LLM 适配器 (Claude, OpenAI兼容, Gemini) + SmartRouter (成本/故障/tier路由)
│   ├── tools/       — 工具系统 (shell, file-read/write, ask-user, web-search, web-fetch, MCP)
│   ├── memory/      — 记忆系统 (SQLite + 向量嵌入 + 混合检索)
│   ├── cli/         — CLI 入口 (agentclaw / ac)
│   ├── gateway/     — 守护进程 (Fastify HTTP + WebSocket + Cron)
│   └── web/         — Web UI (React + Vite 深色主题)
├── skills/          — 技能定义 (coding, research, writing)
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

# 指定 Ollama 模型
OLLAMA_MODEL=qwen3:4b node packages/cli/dist/index.js --provider ollama

# 查看帮助
node packages/cli/dist/index.js --help
```

### 启动 Gateway + Web UI

```bash
# 构建所有包
pnpm build

# 启动 Gateway 守护进程 (默认 localhost:3100)
ANTHROPIC_API_KEY=你的key node packages/gateway/dist/index.js

# 另一个终端启动 Web UI 开发服务器 (localhost:3200)
cd packages/web && pnpm dev
```

Gateway 提供 18 个 REST API 端点 + WebSocket 实时流式传输。Web UI 自动代理到 Gateway。

### 启动 Telegram Bot

```bash
# 在启动 Gateway 时加上 Telegram Bot Token，机器人自动启动
TELEGRAM_BOT_TOKEN=你的token OLLAMA_MODEL=qwen3:4b node packages/gateway/dist/index.js
```

然后在 Telegram 中搜索你的 Bot，发送 `/start` 开始对话。支持命令：`/new`（新会话）、`/help`（帮助）。

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
| 网页搜索 | `web_search` | DuckDuckGo 搜索（无需 API key） |
| 网页抓取 | `web_fetch` | 抓取网页内容（HTML 自动清洗） |

## 内置技能

| 技能 | 触发关键词 | 说明 |
|------|-----------|------|
| coding | write code, fix bug, refactor, 编写代码, 修复bug, 调试... | 软件开发、代码审查、调试 |
| research | search for, research, look up, 搜索, 研究, 查一下... | 网络研究、信息收集、分析 |
| writing | write, draft, edit, summarize, 写作, 编辑, 翻译... | 内容写作、编辑、翻译 |

## MCP 集成

AgentClaw 支持通过 MCP (Model Context Protocol) 连接外部工具服务器：

```typescript
import { MCPManager } from "@agentclaw/tools";

const mcpManager = new MCPManager();
// 连接 stdio 传输的 MCP Server
await mcpManager.addServer({
  name: "my-tools",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem"],
});
// 自动发现的工具会注册到 ToolRegistry
const tools = mcpManager.getAllTools();
```

## 核心能力

### 智能路由
- 按任务类型自动选择最佳模型（planning→flagship, coding→standard, chat→fast）
- 提供商故障自动切换（fallback chain）
- 成本追踪和使用统计

### 任务规划
- LLM 自动分解复杂任务为可执行步骤
- 步骤间依赖管理，按拓扑序执行
- 失败时自动重规划

### 长期记忆
- 混合检索：语义相似度 × 0.5 + 时效性 × 0.2 + 重要性 × 0.3
- 自动从对话中提取事实、偏好、实体、经验
- 每 5 轮对话自动提取，去重存储

## Web UI

深色主题的现代化 Web 界面，4 个核心页面：

| 页面 | 功能 |
|------|------|
| **Chat** | 聊天对话，WebSocket 实时流式输出，工具调用卡片，Session 管理 |
| **Plans** | 计划可视化，步骤时间线，依赖关系展示，状态追踪 |
| **Memory** | 记忆浏览器，搜索/类型筛选/排序，重要度星级，删除确认 |
| **Settings** | 提供商配置，使用统计表格，工具/技能列表，定时任务管理 |

## 文档

- [架构设计](docs/ARCHITECTURE.md) — 系统设计、数据流、数据库结构
- [路线图](docs/ROADMAP.md) — 开发阶段和任务清单

## License

MIT
