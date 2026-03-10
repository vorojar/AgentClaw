# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 语言要求

- **必须使用中文回答所有问题**，严格执行，无例外。
- **你写的代码，我会让Codex review**

## 标准工作流（每次任务必须完整执行，不可跳步）

1. **写代码** — 完成所有改动
2. **构建验证** — `npm run build` 确认编译通过
3. **提交推送** — `git commit` + `git push`，同步更新 CHANGELOG.md
4. **压缩不是借口** — 如果上下文被压缩，回来后先检查 `git status` 和 `git diff`，确认是否有未完成的步骤

## 开发纪律

- **改动前先 grep 现有模式** — 不要凭空写，找同类代码复制 pattern，保持一致性
- **明显的修复直接改** — bug 修复、import 调整、类型修复不需要和用户确认，直接动手
- **报错先看完整 stack trace 再动手** — 不要看到第一行就猜，看完再改，一次修对
- **重启 gateway 标准流程** — `powershell.exe -File restart.ps1`（自动停旧进程 → 构建 → 启动）；跳过构建用 `powershell.exe -File restart.ps1 -NoBuild`

## 构建与运行

```bash
npm run build          # turbo 全量构建（按依赖拓扑排序）
npm run start          # 启动 gateway 守护进程（需先 build）
npm run start:web      # 仅启动 Web UI 开发服务器
npm run typecheck      # 全包类型检查
npm run clean          # 清理所有 dist/
npm run test           # 全包测试（vitest）
```

单包操作：
```bash
pnpm --filter @agentclaw/gateway build
pnpm --filter @agentclaw/web dev
pnpm --filter @agentclaw/memory test
npx vitest run packages/memory/src/__tests__/store.test.ts   # 单文件测试
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
| `tools` | 工具注册表 + 内置工具（shell, file_read/write/edit, glob, grep, web_search, web_fetch, sandbox, subagent, browser_cdp 等）+ MCP 客户端 |
| `memory` | SQLite 持久化（better-sqlite3）：对话历史、长期记忆、向量嵌入、FTS5 全文索引 |
| `core` | SimpleAgentLoop（思考-行动-观察循环）、SimpleOrchestrator（会话管理）、SimplePlanner（任务分解）、ContextManager、MemoryExtractor、SkillRegistry、ToolHookManager（工具钩子）、SimpleSubAgentManager（子代理） |
| `gateway` | Fastify HTTP/WS 服务 + ChannelManager（统一渠道生命周期）+ REST API + 定时任务调度 |
| `cli` | 终端交互式对话 |
| `web` | React 19 + Vite 前端（ChatPage, TasksPage, AgentsPage, ProjectDetailPage, SettingsPage, SkillsPage, MemoryPage, TracesPage 等） |

### 核心数据流

```
Provider.stream() → LLMStreamChunk (text/tool_use_start/tool_use_delta/done)
    ↓
AgentLoop.runStream() → AgentEvent (thinking/response_chunk/tool_call/tool_result/response_complete)
    ↓
Orchestrator.processInputStream() → Gateway (WS JSON / Telegram / QQ / 钉钉 / 飞书 / 企业微信)
```

- AgentLoop 驱动"LLM 调用 → 工具执行 → 结果反馈"循环，最多 `maxIterations` 轮
- ToolExecutionContext 由 gateway 层提供回调（sendFile, promptUser, notifyUser），工具通过它与用户交互
- `sentFiles` 数组在 context 中跟踪已发送文件，agent-loop 在响应完成后将其持久化为 markdown 链接

### 渠道系统

`ChannelManager`（`packages/gateway/src/channel-manager.ts`）统一管理所有 bot 渠道的启停和广播。每个渠道是一个独立文件，返回 `{ stop, broadcast }` 接口：

| 渠道 | 文件 | 环境变量 |
|------|------|---------|
| Telegram | `telegram.ts` | `TELEGRAM_BOT_TOKEN` |
| WhatsApp | `whatsapp.ts` | `WHATSAPP_ENABLED=true` |
| QQ Bot | `qqbot.ts` | `QQ_BOT_APP_ID` + `QQ_BOT_APP_SECRET` |
| 钉钉 | `dingtalk.ts` | `DINGTALK_APP_KEY` + `DINGTALK_APP_SECRET` |
| 飞书 | `feishu.ts` | `FEISHU_APP_ID` + `FEISHU_APP_SECRET` |
| 企业微信 | `wecom.ts` | `WECOM_BOT_ID` + `WECOM_BOT_SECRET` |
| WebSocket | `ws.ts` | 始终启用 |

新增渠道：创建 `packages/gateway/src/<channel>.ts`，实现 `start<Channel>Bot()` 返回 `{ stop, broadcast }`，在 `channel-manager.ts` 中注册，在 `index.ts` 中 re-export。

### 关键入口

- **gateway 启动**：`packages/gateway/src/index.ts` → `bootstrap()` 初始化所有组件 → `createServer()` 启动 HTTP → `channelManager.startAll()` 启动所有渠道
- **系统提示词**：外置在 `system-prompt.md`，使用 `{{var}}` 模板变量（可通过 `SYSTEM_PROMPT` 环境变量覆盖）
- **工具注册**：`packages/tools/src/builtin/index.ts` → `createBuiltinTools()`
- **技能加载**：`skills/` 目录下的 `SKILL.md` 文件，LLM 通过 `use_skill` 工具按需加载

### 工具分层

- **核心工具（永远加载）**：shell, file_read, file_write, file_edit, glob, grep, ask_user, web_fetch, web_search
- **条件工具（按配置加载）**：send_file/schedule/update_todo (gateway), remember (memory), use_skill (skills), claude_code (claudeCode), sandbox, subagent, browser_cdp, social_post

### Skill 系统

系统提示词注入轻量技能目录（name + description），LLM 判断需要时调 `use_skill(name)` → 返回完整 SKILL.md 指令 → 下一轮执行。SKILL.md 只需 frontmatter `name` + `description`。

## 环境变量

至少需要一个 LLM API key：
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`
- `OPENAI_BASE_URL` — 用于 DeepSeek/Kimi/Qwen 等兼容 API
- `DEFAULT_MODEL` — 默认模型名
- `PORT` / `HOST` — gateway 监听地址（默认 3100 / 0.0.0.0）

## 开发约定

- 新增工具：在 `packages/tools/src/builtin/` 创建文件，实现 `Tool` 接口，在 `builtin/index.ts` 的 `createBuiltinTools()` 中注册，**同时在 `src/index.ts` 中 re-export**
- 新增 LLM provider：在 `packages/providers/src/` 实现 `LLMProvider` 接口
- 新增网关渠道：参照 `telegram.ts` / `qqbot.ts` 模式，在 `channel-manager.ts` 中注册
- 文件生成路径统一用 `data/tmp/`，通过 `/files/` 路由对外提供
- WhatsApp bot 仅响应自聊（self-chat），凭证持久化在 `data/whatsapp-auth/`
- 所有渠道的 `promptUser` 必须有 5 分钟超时保护，防止 Promise 永远挂起
- `tsup.config.ts` 的 `external` 列表：新增第三方依赖时检查是否需要加入（避免与本地同名文件冲突，如 `ws` 包 vs `ws.ts`）
- **git 提交时必须同步更新 CHANGELOG.md**
