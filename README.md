# AgentClaw

> 你的 24/7 AI 指挥官——理解意图、规划任务、调度工具、记住一切的智能调度中心。

AgentClaw 是一个指挥官级别的个人 AI 助理。它自己不写代码（调用编程技能），自己不搜索（调用搜索技能），但它理解你的意图、规划复杂任务、调度合适的工具和技能，并通过 Web UI / Telegram / WhatsApp 全天候待命。

## 架构

```
你（老板）
  │
  ▼
AgentClaw（指挥官）
  ├── LLM 提供商 (Claude, OpenAI, Gemini, DeepSeek, Kimi, Qwen...)
  ├── 智能路由 (自动故障切换, Fast Provider 路由)
  ├── 核心工具 (shell, file_read, file_write, ask_user)
  ├── 条件工具 (send_file, set_reminder, schedule, remember, plan_task, use_skill)
  ├── 记忆 (对话历史 + 长期记忆 + 自动压缩)
  ├── 规划器 (任务分解 → 步骤依赖 → 执行监控)
  └── 技能 x19 (coding, research, browser, pdf, email, yt-dlp...)
```

## 技术栈

- **语言**: TypeScript monorepo (pnpm + Turborepo)
- **LLM**: Claude + OpenAI 兼容 (DeepSeek/Kimi/Qwen/Doubao) + Gemini
- **存储**: SQLite (better-sqlite3)
- **网关**: Fastify HTTP + WebSocket + Telegram Bot + WhatsApp Bot
- **前端**: React 19 + Vite (Light/Dark 主题)
- **调度**: Cron 定时任务 + 心跳检查
- **构建**: tsup (ESM) + Turborepo

## 项目结构

```
agentclaw/
├── packages/
│   ├── types/       — 共享类型定义
│   ├── providers/   — LLM 适配器 (Claude, OpenAI兼容, Gemini) + FailoverProvider
│   ├── tools/       — 工具注册表 + 分层内置工具 + MCP 客户端
│   ├── memory/      — SQLite 持久化 (会话/消息/记忆/Traces/Token日志)
│   ├── core/        — Agent Loop + Orchestrator + Planner + ContextManager + SkillRegistry
│   ├── gateway/     — Fastify HTTP/WS + Telegram/WhatsApp Bot + 定时调度
│   ├── cli/         — 终端交互式对话
│   └── web/         — React 19 + Vite 前端
├── skills/          — 19 个技能定义 (SKILL.md)
├── docs/            — 架构文档 + 路线图
└── data/            — 运行时数据 (gitignored)
```

## 快速开始

### 前置要求

- Node.js >= 20
- pnpm >= 9

### 安装

```bash
git clone https://github.com/vorojar/AgentClaw.git
cd AgentClaw
pnpm install
npm run build
```

### 配置

创建 `.env` 文件，至少填入一个 LLM API key：

```env
# LLM (至少配一个)
ANTHROPIC_API_KEY=sk-...
# 或 OpenAI 兼容 (DeepSeek/Kimi/Qwen 等)
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.deepseek.com/v1
DEFAULT_MODEL=deepseek-chat

# 网关
PORT=3100
API_KEY=your-secret-key

# 可选：Telegram Bot
TELEGRAM_BOT_TOKEN=123456:ABC...

# 可选：WhatsApp Bot (QR 扫码认证)
WHATSAPP_ENABLED=true
```

### 运行

```bash
# 启动 Gateway (HTTP/WS + Telegram + WhatsApp)
npm run start

# 启动 Web UI 开发服务器
npm run start:web

# 或使用 CLI 模式
npm run cli
```

## 核心功能

### 多通道接入
- **Web UI** — 现代化聊天界面，Light/Dark 主题，文件上传/拖拽，视频/音频播放器嵌入，多模态图片理解
- **Telegram Bot** — 支持文字/图片/文档/语音/视频消息
- **WhatsApp Bot** — 自聊模式，QR 扫码认证
- **REST API** — 会话、消息、Traces、Token 日志、配置、记忆

### 模型 Failover
配置多个 LLM API Key 时自动按优先级尝试，主 provider 失败后无缝切换备用 provider，失败 provider 进入 60 秒冷却期。

### Shell 沙箱
拦截不可逆破坏性命令（`rm -rf /`、`shutdown`、`format`、fork bomb 等），不拦截日常开发命令。`SHELL_SANDBOX=false` 可禁用。

### 子 Agent 委派
`delegate_task` 工具可 spawn 独立子 agent 执行子任务，拥有独立上下文，适用于并行调研、独立计算等可隔离任务。

### 对话压缩
超过 20 轮对话后自动调用 LLM 生成摘要，减少 token 消耗。

### TTS 语音回复
用户发语音时 AI 以语音回复，支持 edge-tts 和 vibevoice 引擎。

### 长期记忆
自动从对话中提取事实、偏好、实体、经验，去重存储，上下文中自动注入相关记忆。

## 工具系统

分层加载架构——Gateway 加载全部工具，CLI 仅加载核心工具：

| 类型 | 工具 | 说明 |
|------|------|------|
| 核心 | `bash` | 执行 shell 命令（沙箱保护） |
| 核心 | `file_read` | 读取文件内容 |
| 核心 | `file_write` | 写入文件（自动创建目录） |
| 核心 | `ask_user` | 向用户提问 |
| 条件 | `send_file` | 发送文件给用户 |
| 条件 | `set_reminder` | 设置提醒 |
| 条件 | `schedule` | 创建定时任务 |
| 条件 | `remember` | 保存长期记忆 |
| 条件 | `plan_task` | 任务规划和分解 |
| 条件 | `use_skill` | 调用技能 |

## 技能系统

LLM 自主判断是否需要技能，通过 `use_skill` 工具调用。支持在 Web UI 中启用/禁用单个技能，以及从 GitHub 或 zip 导入社区技能。19 个内置技能：

| 技能 | 说明 |
|------|------|
| `browser` | 控制浏览器，打开网页、点击、截图 |
| `coding` | 软件开发、代码审查、调试 |
| `comfyui` | AI 图片生成（文生图、去背景、放大） |
| `create-skill` | 创建自定义技能 |
| `docx` | 创建/编辑/分析 Word 文档 |
| `google-calendar` | 管理 Google 日历 |
| `google-tasks` | 管理 Google Tasks 待办 |
| `http-request` | 发送 HTTP 请求、调用 API |
| `imap-smtp-email` | 收发邮件、搜索邮件、附件 |
| `pdf` | PDF 提取文字/表格、合并拆分、创建 |
| `pptx` | 创建/编辑 PowerPoint 演示文稿 |
| `python-exec` | 执行 Python 代码、数据处理、图表 |
| `research` | 网络调研、多源信息分析 |
| `weather` | 查询天气预报 |
| `web-fetch` | 抓取网页内容 |
| `web-search` | 搜索互联网信息 |
| `writing` | 写作、翻译、校对、总结 |
| `xlsx` | 创建/编辑/分析 Excel 表格 |
| `yt-dlp` | 下载视频/音频 (YouTube/Bilibili/Twitter) |

## MCP 集成

支持通过 `data/mcp-servers.json` 配置外部 MCP (Model Context Protocol) 工具服务器，支持 stdio 和 HTTP 传输。

## 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | 三选一 | Claude API Key |
| `OPENAI_API_KEY` | 三选一 | OpenAI 兼容 API Key |
| `GEMINI_API_KEY` | 三选一 | Gemini API Key |
| `OPENAI_BASE_URL` | 否 | OpenAI 兼容 API 地址 |
| `DEFAULT_MODEL` | 否 | 默认模型名 |
| `FAST_API_KEY` / `FAST_MODEL` | 否 | 轻量模型路由 |
| `PORT` / `HOST` | 否 | 监听地址 (默认 3100 / 0.0.0.0) |
| `API_KEY` | 否 | Gateway API 认证密钥 |
| `TELEGRAM_BOT_TOKEN` | 否 | 启用 Telegram Bot |
| `WHATSAPP_ENABLED` | 否 | 启用 WhatsApp Bot |
| `TTS_PROVIDER` / `TTS_VOICE` | 否 | TTS 引擎配置 |
| `SHELL_SANDBOX` | 否 | 设为 false 禁用 Shell 沙箱 |
| `PUBLIC_URL` | 否 | 大文件下载链接的外部地址 |
| `EMAIL_IMAP_HOST` / `EMAIL_SMTP_HOST` | 否 | 邮件服务器 (启用 email 技能) |
| `EMAIL_USER` / `EMAIL_PASSWORD` | 否 | 邮箱账号和应用专用密码 |

## Web UI

现代化 Web 界面，支持 Light/Dark 主题切换：

- **聊天** — WebSocket 流式输出、工具调用卡片、文件上传/拖拽、视频/音频播放器、多模态图片、消息重新生成、对话导出
- **Traces** — LLM/工具执行时间线
- **Token 日志** — 用量统计
- **记忆** — 浏览/搜索/管理长期记忆
- **设置** — 提供商配置、工具/技能列表、技能开关、技能导入 (GitHub/zip)

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [路线图](docs/ROADMAP.md)
- [更新日志](CHANGELOG.md)

## License

MIT
