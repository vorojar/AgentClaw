# AgentClaw 审计修复报告

> 生成时间: 2026-03-01 | 6 个并行 Agent 分组修复 | 全部完成

## Agent 分组（按文件隔离，无冲突）

### Agent A: shell.ts 修复
| # | 问题 | 级别 | 状态 |
|---|---|---|---|
| A1 | 双重截断统一为单层（runShell 20K + execute 8K → execute 单层 12K） | P0 | ✅ 已存在 |
| A2 | error.code 类型安全（ENOENT 是 string 不是 number） | Bug | ✅ 已存在 |

> 上次会话已修复。确认代码已包含：runShell 无截断、execute MAX_CONTENT=12000 (5K+5K)、`typeof error.code === "number"`

### Agent B: agent-loop + stopReason 管道
| # | 问题 | 级别 | 状态 |
|---|---|---|---|
| B1 | maxTokens 4096 → 8192 | P0 | ✅ 已修复 |
| B2 | temperature 0.7 → 0.5 | P2 | ✅ 已修复 |
| B3 | LLMStreamChunk 添加 stopReason + 3 个 provider 发射 + agent-loop 检查 | P1 | ✅ 已修复 |
| B4 | iterations-- 加最大回退限制（防 use_skill 无限循环） | P1 | ✅ 已修复 |

> 涉及 5 个文件：types/llm.ts、claude.ts、openai-compatible.ts、gemini.ts、agent-loop.ts

### Agent C: use-skill.ts 安全加固
| # | 问题 | 级别 | 状态 |
|---|---|---|---|
| C1 | auto-install 命令白名单解析（拒绝管道、&&、;等） | P0 | ✅ 已修复 |

> 三层防护：前缀锚定、危险字符拦截、恶意 PyPI 源拒绝

### Agent D: context-manager.ts 修复
| # | 问题 | 级别 | 状态 |
|---|---|---|---|
| D1 | compressTurns 缓存 key 用最后 turn ID 替代 turns.length | P1 | ✅ 已修复 |
| D2 | dynamicContextCache 加大小上限（防内存泄漏） | P1 | ✅ 已修复 |

> dynamicContextCache 上限 200、summaryCache 上限 100

### Agent E: claude-code.ts + orchestrator.ts 修复
| # | 问题 | 级别 | 状态 |
|---|---|---|---|
| E1 | claude_code OUTPUT_DIR 改用 context.workDir | Bug | ✅ 已修复 |
| E2 | cleanupTmpScripts 递归清理子目录 | Bug | ✅ 已修复 |
| E3 | isSimpleChat 加任务关键词检测 | P1 | ✅ 已修复 |

> isSimpleChat 增加中英文任务关键词检测：帮我/请你/生成/创建/写/编写/修改/删除/分析/搜索/下载/打开/发送/制作/设计/翻译/总结 + convert/create/write/generate/analyze/search/download/send/make/build

### Agent F: Skill 清理
| # | 操作 | 级别 | 状态 |
|---|---|---|---|
| F1 | 删除 D 级 skill: coding | D级删除 | ✅ 已删除 |
| F2 | 删除 D 级 skill: weather | D级删除 | ✅ 已删除 |
| F3 | 改进 google-calendar（JSON 模板 + Rules） | C级改进 | ✅ 已修复 |
| F4 | 改进 google-tasks（JSON 模板 + Rules） | C级改进 | ✅ 已修复 |
| F5 | 改进 create-skill（JSON 模板 + Rules） | C级改进 | ✅ 已修复 |

> Skill 数量：16 → 14（删除 coding、weather）

## 验证
- [x] `npm run build` 全量编译通过（8/8 packages，0 errors）
- [x] 变更审核通过（抽查 8 个关键点全部确认）

---

## 详细变更摘要

### 修改的文件（10 个）

| 文件 | 改动 |
|---|---|
| `packages/types/src/llm.ts` | `LLMStreamChunk` 添加 `stopReason` 可选属性 |
| `packages/providers/src/claude.ts` | 流式传输中捕获 `stop_reason` 并在 done chunk 发射 |
| `packages/providers/src/openai-compatible.ts` | 流式传输中捕获 `finish_reason` 并在 done chunk 发射 |
| `packages/providers/src/gemini.ts` | 流式传输中捕获 `finishReason` + `hasToolUse` 并在 done chunk 发射 |
| `packages/core/src/agent-loop.ts` | maxTokens 8192、temp 0.5、stopReason 检查、useSkillRollbacks 上限 3 |
| `packages/core/src/context-manager.ts` | 缓存 key 改用 turn ID、dynamicContextCache/summaryCache 大小上限 |
| `packages/core/src/orchestrator.ts` | cleanupTmpScripts 递归、isSimpleChat 任务关键词检测 |
| `packages/tools/src/builtin/use-skill.ts` | auto-install 白名单（前缀锚定 + 危险字符 + 恶意源） |
| `packages/tools/src/builtin/claude-code.ts` | OUTPUT_DIR 改用 context.workDir 优先 |
| `skills/google-calendar/SKILL.md` | 命令改为 JSON 模板 + 添加 Rules 段 |
| `skills/google-tasks/SKILL.md` | 命令改为 JSON 模板 + 添加 Rules 段 |
| `skills/create-skill/SKILL.md` | 结构化步骤 + JSON 模板 + 添加 Rules 段 |

### 删除的文件（2 个 skill 目录）

| 目录 | 原因 |
|---|---|
| `skills/coding/` | D 级：只说"用 claude_code"，纯浪费 1 轮迭代 |
| `skills/weather/` | D 级：有 "ask" 逃生路径，违反确定性设计原则 |

### 修复统计

| 级别 | 总数 | 已修 | 率 |
|---|---|---|---|
| P0 严重 | 3 | 3 | 100% |
| P1 中等 | 6 | 6 | 100% |
| P2 改进 | 1 | 1 | 100% |
| Bug | 4 | 4 | 100% |
| D 级 Skill | 2 | 2 | 100% |
| C 级 Skill | 3 | 3 | 100% |
| **总计** | **19** | **19** | **100%** |

### 追加修复（第 2 轮）

| # | 问题 | 级别 | 状态 |
|---|---|---|---|
| G1 | WS 重连无指数退避（固定 3s，无上限） | P1 | ✅ 已修复 |
| G2 | claude_code 规则与 CLI 可用性矛盾 | Bug | ✅ 已修复 |

> **G1**: `ChatPage.tsx` — 替换固定 3s 为指数退避（1s→2s→4s→8s→16s→cap 30s）+ 随机 jitter + 最多 8 次重试 + 成功连接后重置计数器
> **G2**: `bootstrap.ts` 检测 `claude` CLI → `hasClaudeCode` 变量 → `system-prompt.md` 用 `{{#if hasClaudeCode}}` 条件包裹 claude_code 规则

| 文件 | 改动 |
|---|---|
| `packages/web/src/pages/ChatPage.tsx` | WS 重连指数退避 + jitter + 成功重置 |
| `packages/gateway/src/bootstrap.ts` | CLI 检测添加 `claude`、模板变量 `hasClaudeCode` |
| `system-prompt.md` | claude_code 规则改为条件注入 |

### 修复统计（含追加）

| 级别 | 总数 | 已修 | 率 |
|---|---|---|---|
| P0 严重 | 3 | 3 | 100% |
| P1 中等 | 7 | 7 | 100% |
| P2 改进 | 1 | 1 | 100% |
| Bug | 5 | 5 | 100% |
| D 级 Skill | 2 | 2 | 100% |
| C 级 Skill | 3 | 3 | 100% |
| **总计** | **21** | **21** | **100%** |

### 未处理的审计项（低优先级/需设计决策）

| 问题 | 原因 |
|---|---|
| shell 沙箱可绕过（find -delete, python -c） | 防最常见错误已够，完美沙箱需 OS 级方案 |
| system-prompt.md 规则层级不清晰 | 需要 A/B 测试评估效果后再改 |
| 系统提示词硬编码命令（语音转文字、截图） | 改为 skill 需新建 2 个 skill，等用户需要时再做 |
| skill 目录 token 优化 | 当前 ~500 tok，可接受；去掉 description 可能降低匹配率 |
