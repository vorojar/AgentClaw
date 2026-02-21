# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 语言要求

- **必须使用中文回答所有问题**，严格执行，无例外。

## 构建与运行

```bash
npm run build          # turbo 全量构建（按依赖拓扑排序）
npm run start          # 启动 gateway 守护进程（需先 build）
npm run start:web      # 仅启动 Web UI 开发服务器
npm run typecheck      # 全包类型检查
npm run clean          # 清理所有 dist/
```

单包构建/开发：
```bash
pnpm --filter @agentclaw/gateway build
pnpm --filter @agentclaw/web dev
```

## 架构

Monorepo（pnpm workspaces + Turborepo），所有包用 tsup 构建为 ESM。

### 包依赖顺序

```
types → providers/tools/memory → core → gateway/cli
                                        web（独立，Vite）
```

### 各包职责

| 包 | 职责 |
|---|---|
| `types` | 所有共享接口：LLMProvider, Message, ContentBlock, AgentEvent, Tool, ToolExecutionContext, MemoryStore, Skill, Planner |
| `providers` | LLM 适配器：ClaudeProvider, OpenAICompatibleProvider, GeminiProvider, SmartRouter |
| `tools` | 工具注册表 + 内置工具（shell, file_read/write, web_search, web_fetch, comfyui, browser 等）+ MCP 客户端 |
| `memory` | SQLite 持久化（better-sqlite3）：对话历史、长期记忆、向量嵌入 |
| `core` | SimpleAgentLoop（思考-行动-观察循环）、SimpleOrchestrator（会话管理）、SimplePlanner（任务分解）、ContextManager、MemoryExtractor、SkillRegistry |
| `gateway` | Fastify HTTP/WS 服务 + Telegram/WhatsApp bot + REST API + 定时任务调度 |
| `cli` | 终端交互式对话 |
| `web` | React 19 + Vite 前端（ChatPage, PlansPage, MemoryPage, SettingsPage） |

### 核心数据流

```
Provider.stream() → LLMStreamChunk (text/tool_use_start/tool_use_delta/done)
    ↓
AgentLoop.runStream() → AgentEvent (thinking/response_chunk/tool_call/tool_result/response_complete)
    ↓
Orchestrator.processInputStream() → Gateway (WS JSON / Telegram / WhatsApp)
```

- AgentLoop 驱动"LLM 调用 → 工具执行 → 结果反馈"循环，最多 `maxIterations` 轮
- ToolExecutionContext 由 gateway 层提供回调（sendFile, promptUser, notifyUser），工具通过它与用户交互
- `sentFiles` 数组在 context 中跟踪已发送文件，agent-loop 在响应完成后将其持久化为 markdown 链接

### 关键入口

- **gateway 启动**：`packages/gateway/src/index.ts` → `bootstrap()` 初始化所有组件 → `createServer()` 启动 HTTP
- **系统提示词**：`packages/gateway/src/bootstrap.ts` 中的 `defaultSystemPrompt`（可通过 `SYSTEM_PROMPT` 环境变量覆盖）
- **工具注册**：`packages/tools/src/builtin/index.ts` → `createBuiltinTools()`
- **技能加载**：`skills/` 目录下的 `SKILL.md` 文件，通过触发器关键词动态匹配注入

## 环境变量

至少需要一个 LLM API key：
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`
- `OPENAI_BASE_URL` — 用于 DeepSeek/Kimi/Qwen 等兼容 API
- `DEFAULT_MODEL` — 默认模型名
- `TELEGRAM_BOT_TOKEN` — 启用 Telegram bot
- `WHATSAPP_ENABLED=true` — 启用 WhatsApp bot（QR 码扫码认证）
- `PORT` / `HOST` — gateway 监听地址（默认 3100 / 0.0.0.0）

## 开发约定

- 新增工具：在 `packages/tools/src/builtin/` 创建文件，实现 `Tool` 接口，在 `index.ts` 的 `createBuiltinTools()` 中注册
- 新增 LLM provider：在 `packages/providers/src/` 实现 `LLMProvider` 接口
- 新增网关：参照 `telegram.ts` / `whatsapp.ts` 模式，在 `packages/gateway/src/index.ts` 中集成
- 文件生成路径统一用 `data/tmp/`，通过 `/files/` 路由对外提供
- WhatsApp bot 仅响应自聊（self-chat），凭证持久化在 `data/whatsapp-auth/`
