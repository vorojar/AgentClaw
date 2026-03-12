# AgentClaw

> 你的 24/7 AI 指挥官——理解意图、规划任务、调度工具、记住一切的智能调度中心。

AgentClaw 是一个指挥官级别的个人 AI 助理。它自己不写代码（调用编程技能），自己不搜索（调用搜索技能），但它理解你的意图、规划复杂任务、调度合适的工具和技能，并通过 Web UI / Telegram / WhatsApp / 钉钉 / 飞书 / QQ 全天候待命。内置 TaskManager 任务管理引擎，自动捕获、分诊、执行任务，需要你决策时推送提醒，每日定时发送简报。

## 架构

```
你（老板）
  │
  ▼
AgentClaw（指挥官）
  ├── LLM 提供商 (Claude, OpenAI, Gemini, DeepSeek, Kimi, Qwen...)
  ├── 智能路由 (自动故障切换, Fast Provider 路由)
  ├── 核心工具 (shell, file_read, file_write, file_edit, glob, grep, ask_user, web_fetch, web_search)
  ├── 条件工具 (send_file, schedule, remember, use_skill, sandbox, subagent, browser_cdp...)
  ├── 记忆 (对话历史 + 长期记忆 + 自动压缩)
  ├── 规划器 (任务分解 → 步骤依赖 → 执行监控)
  ├── 任务管理 (捕获→分诊→执行→决策→每日简报)
  ├── 技能 x16 (browser, gws-calendar/gmail/drive/sheets/tasks, pdf, docx, xlsx, pptx...)
  ├── 多 Agent (AgentClaw/Coder/Writer/Analyst/Researcher)
  ├── 子代理 (并行任务派发与汇总)
  ├── 确定性工作流 (Sequential/Parallel 编排，零 LLM 消耗)
  ├── Trajectory 评估 (黄金测试集，7 维度自动评估)
  ├── 工具钩子 (before/after 拦截 + allow/deny 策略)
  └── MCP 集成 (外部工具服务器)
```

## 技术栈

- **语言**: TypeScript monorepo (pnpm + Turborepo)
- **LLM**: Claude + OpenAI 兼容 (DeepSeek/Kimi/Qwen/Doubao) + Gemini
- **存储**: SQLite (better-sqlite3)
- **网关**: Fastify HTTP + WebSocket + Telegram Bot + WhatsApp Bot + 钉钉 + 飞书 + QQ Bot
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
│   ├── core/        — Agent Loop + Orchestrator + Planner + ContextManager + SkillRegistry + WorkflowRunner + Eval
│   ├── gateway/     — Fastify HTTP/WS + Telegram/WhatsApp/DingTalk/Feishu/QQ Bot + 定时调度 + TaskManager
│   ├── cli/         — 终端交互式对话
│   └── web/         — React 19 + Vite 前端
├── skills/          — 16 个技能定义 (SKILL.md)
├── docs/            — 架构文档 + 路线图
└── data/            — 运行时数据 (部分 gitignored)
    └── agents/      — Agent 人格配置 (config.json + SOUL.md，纳入 git)
```

## 快速开始

### Docker 部署（推荐）

```bash
git clone https://github.com/vorojar/AgentClaw.git
cd AgentClaw
cp .env.example .env
# 编辑 .env，至少填入一个 LLM API key

docker compose up -d
```

打开 http://localhost:3100 即可使用。

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

### 多通道接入
- **Web UI** — 现代化聊天界面，Light/Dark 主题，文件上传/拖拽，视频/音频播放器嵌入，多模态图片理解
- **Telegram Bot** — 支持文字/图片/文档/语音/视频消息
- **WhatsApp Bot** — 自聊模式，QR 扫码认证
- **QQ Bot** — QQ 开放平台官方 API v2，WebSocket 模式
- **钉钉** — Stream 模式，无需公网 IP
- **飞书** — WebSocket 模式，无需公网 IP
- **企业微信** — WebSocket 模式，@wecom/aibot-node-sdk
- **REST API** — 会话、消息、Traces、Token 日志、配置、记忆

### 模型 Failover
配置多个 LLM API Key 时自动按优先级尝试，主 provider 失败后无缝切换备用 provider，失败 provider 进入 60 秒冷却期。

### 安全执行
- **Shell 沙箱**：拦截不可逆破坏性命令（`rm -rf /`、`shutdown`、`format`、fork bomb 等），`SHELL_SANDBOX=false` 可禁用
- **Docker 沙箱**：`sandbox` 工具在 Docker 容器内执行命令，资源限制（512MB/1CPU），超时控制，自动清理
- **Memory 内容审查**：remember 工具写入前扫描 prompt injection、隐形 unicode 和凭证窃取 payload，拦截恶意记忆注入

### 多 Agent 人格
支持创建多个 Agent，每个 Agent 拥有独立的 Soul（人格/行为指令）、可选的 Model、Temperature、Max Iterations、Tools 过滤。5 个预设 Agent：AgentClaw（默认通用助理）、Coder（编程专家）、Writer（写作助手）、Analyst（数据分析师）、Researcher（研究员）。配置存储在 `data/agents/<id>/`，创建会话时可指定 Agent。

### 子代理编排
`subagent` 工具可派生独立子 agent 并行执行任务，拥有独立 agent-loop 和会话上下文。支持 spawn/spawn_and_wait/result/kill/list 操作，`mode: "explore"` 只读模式仅加载搜索/阅读工具子集。安全机制：工具黑名单（6 个危险工具始终禁止）、IterationBudget 父子共享迭代预算池防止无限消耗。

### 任务管理（TaskManager）
完整的任务生命周期管理引擎：
- **捕获** — 自然语言创建任务，LLM 自动解析标题、优先级、执行者
- **分诊** — 自动判断 agent/human 执行者，按优先级排队
- **执行** — 队列调度，自动执行 agent 任务，记录 trace
- **决策** — 需要用户拍板时推送决策卡片，heartbeat 定期提醒（不消耗 LLM token）
- **每日简报** — 定时推送（默认 09:00，可在页面配置），汇总待办/进行中/等决策任务
- **Web UI** — Today/All Tasks/Decisions/Automations 四个标签页

### 确定性工作流编排
WorkflowRunner 引擎支持将固定流程硬编码为 WorkflowDefinition，**零 LLM 调用、零 token 消耗**执行：
- **Sequential** — 步骤串行执行，前一步结果通过 `{{stepId.content}}` 模板传给下一步
- **Parallel** — 子步骤并行执行（Promise.all），结果合并后继续
- 支持条件执行、错误处理策略（stop/continue）、AbortSignal 中断

### Trajectory 自动评估
基于 Google AgentOps 三层评估框架，验证 agent 的推理路径是否正确：
- 定义"黄金测试集"（JSON 格式，prompt + 期望工具调用序列 + 约束条件）
- 7 个评估维度：工具选择、参数正确性、错误状态、禁用工具、响应内容匹配、模型、耗时
- `evaluateBatch()` 批量评估 + `formatEvalReport()` 生成可读报告

### Traces 工具调用统计
Traces 页面顶部可展开的统计面板：
- 总调用数、成功率、错误数、工具种类数
- 按工具名分组的详细表格（调用次数、成功率、平均耗时）
- 同一会话的多轮 trace 自动分组，显示总 token/耗时/轮次

### 对话压缩
超过 20 轮对话后自动调用 LLM 生成摘要，减少 token 消耗。压缩时自动保护 tool_call/tool_result 配对完整性，防止 API 报错。

### Frozen Snapshot
Session 内冻结系统提示词中的动态上下文（记忆 + 技能目录），memory 写入持久化但不改变当前 session 的系统提示词，提高 Anthropic prompt cache 命中率。

### 渠道格式提示
不同消息渠道自动注入格式指导到系统提示词（如 Telegram 不用 Markdown、钉钉/飞书支持 Markdown 等），LLM 输出自动适配各渠道格式限制。

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
| 核心 | `file_edit` | 精确字符串替换编辑文件 |
| 核心 | `glob` | 按文件名模式搜索文件 |
| 核心 | `grep` | 按正则搜索文件内容 |
| 核心 | `ask_user` | 向用户提问 |
| 核心 | `web_fetch` | 抓取网页内容（Readability 正文提取 + SPA 自动降级 Playwright） |
| 核心 | `web_search` | 搜索互联网（SearXNG + Serper fallback） |
| 条件 | `send_file` | 发送文件给用户 |
| 条件 | `schedule` | 创建定时任务 |
| 条件 | `update_todo` | 实时进度追踪 |
| 条件 | `remember` | 保存长期记忆 |
| 条件 | `use_skill` | 调用技能 |
| 条件 | `sandbox` | Docker 容器内安全执行命令 |
| 条件 | `subagent` | 子代理编排（spawn/result/kill/list） |
| 条件 | `browser_cdp` | 浏览器 CDP 自动化（Playwright） |
| 条件 | `social_post` | 一键发帖到 X/小红书/即刻 |
| 条件 | `claude_code` | 委托 Claude Code CLI 执行编码任务 |

## 技能系统

LLM 自主判断是否需要技能，通过 `use_skill` 工具调用。支持在 Web UI 中启用/禁用单个技能，以及从 GitHub 或 zip 导入社区技能。16 个内置技能：

| 技能 | 说明 |
|------|------|
| `bilingual-subtitle` | 视频字幕提取、翻译、双语合并、烧录 |
| `browser` | 浏览器自动化（点击、输入、截图），需登录态时使用 |
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
| `web-fetch` | 抓取网页内容 |
| `web-search` | 搜索互联网信息（备用） |
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
| `EMAIL_IMAP_HOST` / `EMAIL_SMTP_HOST` | 否 | 邮件服务器 (启用 email 技能) |
| `EMAIL_USER` / `EMAIL_PASSWORD` | 否 | 邮箱账号和应用专用密码 |
| `DINGTALK_APP_KEY` / `DINGTALK_APP_SECRET` | 否 | 启用钉钉 Bot |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 否 | 启用飞书 Bot |
| `QQ_BOT_APP_ID` / `QQ_BOT_APP_SECRET` | 否 | 启用 QQ Bot |
| `WECOM_BOT_ID` / `WECOM_BOT_SECRET` | 否 | 启用企业微信 Bot |

## Web UI

现代化 Web 界面，支持 Light/Dark 主题切换：

- **聊天** — WebSocket 流式输出、工具调用卡片（SubAgent 以 Mem 风格单卡片展示）、文件上传/拖拽、视频/音频播放器、多模态图片、消息重新生成、对话导出、Agent 选择
- **任务** — Today/All Tasks/Decisions/Automations 四标签页，快速添加、决策卡片、每日简报时间配置、Task Runner 统计
- **设置** — 二级菜单结构，整合：常规（用量统计 + 外观/主题/语言）、渠道、Agents、子代理、记忆、工具、技能、Traces、API 参考

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [路线图](docs/ROADMAP.md)
- [更新日志](CHANGELOG.md)

## License

MIT
