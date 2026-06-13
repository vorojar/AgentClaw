# AgentClaw

<p align="center">
  <a href="https://github.com/vorojar/AgentClaw/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
  </a>
  <a href="https://github.com/vorojar/AgentClaw">
    <img src="https://img.shields.io/github/stars/vorojar/AgentClaw?style=social" alt="GitHub Stars" />
  </a>
</p>

> 你的 24/7 AI 指挥官——理解意图、规划任务、调度工具、记住一切的智能调度中心。

AgentClaw 是一个指挥官级别的个人 AI 助理，同时也是一个 **Agent 托管平台（Hive）**。它自己不写代码（调用编程技能），自己不搜索（调用搜索技能），但它理解你的意图、规划复杂任务、调度合适的工具和技能，并通过 Web UI / Telegram / WhatsApp / 钉钉 / 飞书 / QQ 全天候待命。

**Hive 模式**下，任何人都可以创建、配置、发布独立 Agent，获得即用的 API 端点——定义 Soul，选择 Tools，导入知识，拿到 Key，上线。每个 Agent 拥有独立的记忆空间、工具白名单、技能黑名单、知识库和 API Key。

## 架构

```
你（老板）/ 外部系统（API 调用）
  │
  ▼
AgentClaw Hive（Agent 托管平台）
  │
  ├── Agent 1 (Soul + Tools + Skills + Memory + Knowledge + API Key)
  ├── Agent 2 ...
  ├── Agent N ...  ← 完全隔离，独立认证
  │
  ├── LLM 提供商 (Claude, OpenAI, Gemini, DeepSeek, Kimi, Qwen, Doubao...)
  ├── 智能路由 (自动故障切换, Fast Provider 路由)
  ├── 核心工具 (bun, bash, file_read/write/edit, glob, grep, ask_user, web_fetch, web_search)
  ├── 条件/专用工具 (send_file, schedule, remember/recall, use_skill, rss_top, sandbox, subagent...)
  ├── 记忆 (对话历史 + 长期记忆 + 自动压缩 + namespace 隔离)
  ├── 技能 x14 (gws-calendar/gmail/drive/sheets/tasks, pdf, docx, xlsx, pptx, wechat-publish...)
  ├── 子代理 (并行任务派发与汇总)
  ├── 工具钩子 (before/after 拦截 + allow/deny 策略)
  └── MCP 集成 (外部工具服务器)
```

## 技术栈

- **语言**: TypeScript monorepo (pnpm + Turborepo)
- **LLM**: Claude + OpenAI 兼容 (DeepSeek/Kimi/Qwen/Doubao) + Gemini
- **存储**: SQLite (better-sqlite3)
- **网关**: Fastify HTTP + WebSocket + Telegram Bot + WhatsApp Bot + 钉钉 + 飞书 + QQ Bot + 企业微信
- **前端**: React 19 + Vite (Light/Dark 主题)
- **桌面**: Tauri v2 (Rust) + Bun sidecar，三平台安装包
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
│   ├── core/        — Agent Loop + Orchestrator + ContextManager + SkillRegistry
│   ├── gateway/     — Fastify HTTP/WS + 多渠道 Bot + 定时调度 + TaskManager
│   ├── cli/         — 终端交互式对话
│   ├── web/         — React 19 + Vite 前端
│   └── desktop/     — Tauri v2 桌面客户端 (Windows/macOS/Linux)
├── skills/          — 14 个技能定义 (SKILL.md)
├── docs/            — 架构文档 + 路线图 + 技术文章系列
└── data/            — 运行时数据 (部分 gitignored)
    └── agents/      — Agent 人格配置 (config.json + SOUL.md)
```

## 快速开始

### 桌面安装

从 [Releases](https://github.com/vorojar/AgentClaw/releases) 下载对应平台安装包：

- **Windows**: `.exe` (NSIS 安装包，内嵌 WebView2)
- **macOS**: `.dmg`
- **Linux**: `.deb`

启动后通过 Setup Wizard 配置 LLM Provider 即可使用。

### 一键安装（推荐）

Linux、macOS 和 Termux 可用一条命令完成安装、模型配置、构建和启动：

```bash
curl -fsSL https://raw.githubusercontent.com/vorojar/AgentClaw/master/scripts/install.sh | bash
```

安装器会自动检查并安装基础依赖（`git`、`curl`、Node.js、pnpm、`ffmpeg`、Python/构建工具），随后引导选择模型提供商并填写 API Key。完成后打开 http://127.0.0.1:3100 即可开始对话。

默认安装只启用核心对话能力，避免首次安装拉取 Chromium、SearXNG、Redis 等重依赖。搜索引擎、消息渠道、浏览器自动化等高级能力可在安装后按需配置。

### Docker 部署

```bash
git clone https://github.com/vorojar/AgentClaw.git
cd AgentClaw
cp .env.example .env
# 编辑 .env，至少填入一个 LLM API key

docker compose up -d
```

打开 http://localhost:3100 即可使用。

Docker 默认只启动 AgentClaw 核心服务，不再自动启动本地搜索。需要本地 SearXNG 时：

```bash
docker compose --profile search up -d
```

随后在 Settings > Search 配置 `http://searxng:8080`，或使用 Serper / Querit / Custom 搜索 API。

浏览器自动化默认关闭。需要 `browser_cdp` 时请自行安装 Chrome/Chromium，或用 `--build-arg INSTALL_BROWSER=true` 构建 Docker 镜像，并设置：

```env
AGENTCLAW_ENABLE_BROWSER_CDP=true
```

### 手动部署

**前置要求：** Node.js >= 20, pnpm >= 9

```bash
git clone https://github.com/vorojar/AgentClaw.git
cd AgentClaw
pnpm install
npm run build
cp .env.example .env
# 编辑 .env，至少填入一个 LLM API key

npm run start
```

打开 http://localhost:3100

### 配置

所有配置通过环境变量，参见 [`.env.example`](.env.example) 获取完整列表。

**最低要求：** 一个 LLM API key（`ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 或 `GEMINI_API_KEY`）。

### 其他启动方式

```bash
npm run start:web    # Web UI 开发服务器（热更新）
npm run cli          # 终端交互模式
```

## 核心功能

### Hive — Agent-as-a-Service

创建独立 Agent，每个 Agent 拥有完全隔离的配置和运行环境：

| 能力 | 说明 |
|------|------|
| **Soul** | 独立人格定义、行为准则、知识边界 |
| **Tools 白名单** | 从全局工具池中选取可用工具，系统提示词自动裁剪不可用工具的规则 |
| **Skills 黑名单** | 禁用特定技能，catalog 过滤 + 执行时拦截双重保护 |
| **Memory 隔离** | 按 agentId 自动隔离记忆命名空间，agent 间记忆完全不可见 |
| **知识库（RAG）** | 上传文档自动切片 → embedding → 向量索引，LLM 按语义检索 |
| **HTTP API 知识源** | UI 表单配置外部 API，自动生成 Tool 注册给 agent，零代码 |
| **Per-Agent API** | 独立 API Key + 端点，Stateless / Session / SSE 三种模式 |
| **Per-Agent 模型** | 可覆盖全局模型，按 agent 选择性价比最优模型 |
| **用量统计** | 按 agent 统计调用次数、token 消耗、平均延迟 |
| **Rate Limiting** | per-agent 速率限制（每分钟 + 每天），超限 429 |

**Agent API 端点**：
```
POST /api/v1/agents/:id/chat              # 无状态对话
POST /api/v1/agents/:id/chat/stream       # SSE 流式
POST /api/v1/agents/:id/sessions          # 创建会话
POST /api/v1/agents/:id/sessions/:sid/chat # 会话内对话
```

### 多通道接入
- **Web UI** — 现代化聊天界面，Light/Dark 主题，文件上传/拖拽，视频/音频播放器嵌入，多模态图片理解
- **Telegram Bot** — 支持文字/图片/文档/语音/视频消息
- **WhatsApp Bot** — 自聊模式，QR 扫码认证
- **QQ Bot** — QQ 开放平台官方 API v2，WebSocket 模式
- **钉钉** — Stream 模式，无需公网 IP
- **飞书** — WebSocket 模式，无需公网 IP
- **企业微信** — WebSocket 模式，@wecom/aibot-node-sdk
- **REST API** — 会话、消息、Traces、Token 日志、配置、记忆

### 模型 Failover + 错误分类
配置多个 LLM API Key 时自动按优先级尝试。7 类错误自动分类（auth/quota/rate_limit/overloaded/server_error/config/network），按类型决定冷却时间（429→60s, 503→15s），冷却中的模型降优先级而非移除。三振升级机制检测模型卡住（连续 3 次相似输出），自动注入策略变更提示。

### 安全纵深防御
- **Shell 沙箱**：拦截不可逆破坏性命令 + printenv/env + 元数据服务地址
- **SSRF 防护**：web_fetch 拦截内网地址（127/10/172.16/192.168/169.254）
- **路径遍历防护**：file_read 正则黑名单拦截 .env.*/SSH 密钥/proc/sys 系统路径
- **Trace 混淆**：工具结果写入 trace 前通过 env-obfuscator 替换敏感环境变量值
- **Subagent 封堵**：工具黑名单 + sendFile/saveMemory 回调不透传子代理
- **MCP 消毒**：外部 MCP server 返回内容检测 prompt injection 并标记
- **Memory 审查**：remember 写入前扫描 prompt injection（含中文）、隐形 unicode、凭证窃取
- **Docker 沙箱**：sandbox 工具在容器内执行，资源限制（512MB/1CPU），超时控制
- **系统提示词裁剪**：agent 有工具白名单时，自动移除引用不可用工具的规则

### Agent Handoff（代理交接）
对话中 Agent 可通过 `handoff` 工具将对话交给更合适的专家 Agent 继续处理。交接后保留完整对话历史，目标 Agent 使用自己的人格、模型和工具集继续响应。最多 3 次连续交接防止循环。

### 子代理编排
`subagent` 工具可派生独立子 agent 并行执行任务，拥有独立 agent-loop 和会话上下文。支持 spawn/spawn_and_wait/result/kill/list 操作，`mode: "explore"` 只读模式仅加载搜索/阅读工具子集。安全机制：工具黑名单（6 个危险工具始终禁止）、IterationBudget 父子共享迭代预算池防止无限消耗。

### 任务管理（TaskManager）
完整的任务生命周期管理引擎：
- **捕获** — 自然语言创建任务，LLM 自动解析标题、优先级、执行者
- **分诊** — 自动判断 agent/human 执行者，按优先级排队
- **执行** — 队列调度，自动执行 agent 任务，记录 trace
- **决策** — 需要用户拍板时推送决策卡片，heartbeat 定期提醒（不消耗 LLM token）
- **每日简报** — 定时推送，汇总待办/进行中/等决策任务

### 长期记忆
自动从对话中提取事实、偏好、实体、经验，去重存储，上下文中自动注入相关记忆。按 agent 命名空间隔离，Web UI 支持按 agent 筛选管理。

### 上下文压缩（多层流水线）
- **L6 观察压缩**：旧 tool_result 智能提取错误行/状态/JSON 关键字段（80-95% token 节省）
- **L2+L5 基础压缩**：空白规范化 + JSON minify，所有 tool_result 自动应用
- **三层摘要瀑布**：LLM 正常 → LLM 低温 → 确定性截断（永远成功）
- **Tool pair 保护**：压缩后自动修复孤立的 tool_call/tool_result（block 级清理）
- **Frozen Snapshot**：动态上下文每 session 只构建一次，最大化 prompt cache 命中率

### TTS 语音回复
用户发语音时 AI 以语音回复，支持 edge-tts 和 vibevoice 引擎。

## 工具系统

分层加载架构——Gateway 加载全部工具，CLI 仅加载核心工具：

| 类型 | 工具 | 说明 |
|------|------|------|
| 核心 | `bun` | 执行有边界的 JavaScript/TypeScript 片段 |
| 核心 | `bash` | 执行命令（沙箱保护） |
| 核心 | `file_read` | 读取文件内容 |
| 核心 | `file_write` | 写入文件（自动创建目录） |
| 核心 | `file_edit` | 精确字符串替换编辑文件 |
| 核心 | `glob` | 按文件名模式搜索文件 |
| 核心 | `grep` | 按正则搜索文件内容 |
| 核心 | `ask_user` | 向用户提问 |
| 核心 | `web_fetch` | 抓取网页内容（Readability 正文提取 + SPA 自动降级 Playwright） |
| 核心 | `web_search` | 搜索互联网（在 Settings 中配置 Serper / Querit / Custom / SearXNG） |
| 专用 | `rss_top` | Reddit/RSS 日报工作流的多源 TopN 提取（gateway 显式启用） |
| 条件 | `send_file` | 发送文件给用户 |
| 条件 | `schedule` | 创建定时任务 |
| 条件 | `update_todo` | 实时进度追踪 |
| 条件 | `remember` | 保存长期记忆 |
| 条件 | `recall` | 搜索长期记忆 |
| 条件 | `use_skill` | 调用技能 |
| 条件 | `sandbox` | Docker 容器内安全执行命令 |
| 条件 | `subagent` | 子代理编排（spawn/result/kill/list） |
| 条件 | `browser_cdp` | 浏览器 CDP 自动化（默认关闭，需安装 Chrome/Chromium 并设置 `AGENTCLAW_ENABLE_BROWSER_CDP=true`） |
| 条件 | `handoff` | 将对话交接给更合适的专家 Agent |
| 条件 | `claude_code` | 委托 Claude Code CLI 执行编码任务 |

## 技能系统

LLM 自主判断是否需要技能，通过 `use_skill` 工具调用。支持在 Web UI 中启用/禁用单个技能，以及从 GitHub 或 zip 导入社区技能。14 个内置技能：

| 技能 | 说明 |
|------|------|
| `bilingual-subtitle` | 视频字幕提取（Whisper 自动语言检测）、翻译、双语合并、烧录 |
| `comfyui` | AI 图片生成（文生图、去背景、放大），需本地 ComfyUI |
| `create-skill` | 创建自定义技能 |
| `docx` | 创建/编辑/分析 Word 文档 |
| `gws-calendar` | Google 日历管理（通过 gws CLI） |
| `gws-drive` | Google Drive 文件管理（通过 gws CLI） |
| `gws-gmail` | Gmail 邮件管理（通过 gws CLI） |
| `gws-sheets` | Google Sheets 读写（通过 gws CLI） |
| `gws-tasks` | Google Tasks 待办管理（通过 gws CLI） |
| `pdf` | PDF 提取文字/表格、合并拆分、创建 |
| `pptx` | 创建/编辑 PowerPoint 演示文稿 |
| `wechat-publish` | 生成并发布微信公众号草稿 |
| `xlsx` | 创建/编辑/分析 Excel 表格 |
| `yt-dlp` | 下载视频/音频 (YouTube/Bilibili/Twitter) |

## Artifacts 实时预览

代码块支持实时预览，点击 **Preview** 按钮即可在聊天中直接渲染：

| 语言 | 渲染方式 |
|------|---------|
| `html` | iframe sandbox |
| `svg` | iframe（自动包装为 HTML document） |
| `mermaid` | 动态加载 mermaid.js 渲染为 SVG |
| `jsx` / `tsx` | @babel/standalone 编译 + React 19 CDN iframe |

生成的 HTML 文件（`/files/*.html`）显示为可点击的预览卡片，全屏覆盖层浏览。

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
| `DINGTALK_APP_KEY` / `DINGTALK_APP_SECRET` | 否 | 启用钉钉 Bot |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 否 | 启用飞书 Bot |
| `QQ_BOT_APP_ID` / `QQ_BOT_APP_SECRET` | 否 | 启用 QQ Bot |
| `WECOM_BOT_ID` / `WECOM_BOT_SECRET` | 否 | 启用企业微信 Bot |

## 常见问题

<details>
<summary><b>Q: 启动后提示 "No valid API key found"？</b></summary>

确保 `.env` 中至少配置了一个有效的 API key（三选一）：

```bash
ANTHROPIC_API_KEY=sk-ant-xxx    # Claude 系列
OPENAI_API_KEY=sk-xxx           # GPT 系列 / OpenAI 兼容
GEMINI_API_KEY=AIzaSy-xxx       # Gemini 系列
```

检查：key 前后无多余空格/引号，key 未过期，Docker 部署时 `.env` 在 `docker-compose.yml` 同级目录。

</details>

<details>
<summary><b>Q: Docker 部署后 Web UI 打不开？</b></summary>

```bash
# 确认容器正在运行
docker compose ps

# 检查日志
docker compose logs gateway

# 确认端口映射（默认 3100）
# 云服务器需放行防火墙
sudo ufw allow 3100
```

</details>

<details>
<summary><b>Q: 应该选哪个模型？</b></summary>

| 场景 | 推荐 | 原因 |
|------|------|------|
| 日常对话 + 工具调用 | Claude Sonnet 4 | 性价比最优 |
| 复杂推理 / 代码生成 | Claude Opus 4 | 最强推理 |
| 预算有限 | GPT-4o-mini / DeepSeek | 便宜够用 |
| 本地离线 | Ollama + Qwen3 | 零成本，需 GPU |

</details>

<details>
<summary><b>Q: 工具被禁用后 agent 一直重试？</b></summary>

已修复（v1.5.17+）。如果仍遇到，检查 `data/config.json` 中 `toolPermissions` 是否有 `deny` 规则。被禁用的工具会返回明确的 "Do NOT retry" 提示，agent 应自动切换替代方案。

</details>

<details>
<summary><b>Q: 长对话后响应变慢？</b></summary>

这是上下文压缩触发的正常行为。系统会在 token 超限时自动压缩旧消息；Web UI 里也可以手动触发压缩。压缩后 tool_result 保留关键信息（错误行/状态/JSON 字段），80-95% token 节省。

</details>

## Web UI

现代化 Web 界面，支持 Light/Dark 主题切换：

- **聊天** — WebSocket 流式输出、工具调用卡片、文件上传/拖拽、视频/音频播放器、Agent 选择器、Agent 指示条
- **任务** — Today/All Tasks/Decisions/Automations 四标签页
- **代理** — Agent 详情页：Profile / Tools & Skills / Knowledge / API 四个 Tab，测试按钮跳转 ChatPage
- **记忆** — 按 Agent 命名空间筛选、按类型和重要性排序
- **设置** — LLM Provider 配置、用量统计、外观/主题/语言、渠道、Traces

## 文档

- [Building AI Agent Frameworks](docs/building-ai-agents/) — 10 篇技术系列文章（By Rosibo & Claude）
- [Hive 设计文档](docs/HIVE.md) — Agent-as-a-Service 平台架构与路线图
- [架构设计](docs/ARCHITECTURE.md)
- [路线图](docs/ROADMAP.md)
- [更新日志](CHANGELOG.md)

## License

MIT
