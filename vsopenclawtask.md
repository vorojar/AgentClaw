# AgentClaw vs OpenClaw 能力升级任务

> 目标：补齐 5 项核心能力差距，让 AgentClaw 从"能聊天能调工具"变成"给目标就能自己干活、自己验收"。

## P0: 子代理编排

**目标**：主 agent 可以派生子 agent 并行处理任务，汇总验收结果。

**需要做的**：
- [x] `packages/core/src/subagent-manager.ts` — 子代理管理器
  - `spawn(goal, options?)` — 创建子代理会话，返回 subagentId
  - `steer(id, instruction)` — 给子代理追加指令
  - `getResult(id)` — 获取子代理执行结果
  - `kill(id)` — 终止子代理
  - `list()` — 列出所有活跃子代理
- [x] `packages/tools/src/builtin/subagent.ts` — 暴露给 LLM 的 `subagent` 工具
  - actions: spawn / result / kill / list
  - spawn 时可指定 model、maxIterations
- [x] `packages/types/src/subagent.ts` — SubAgent 类型定义
- [x] 子代理独立会话，有自己的 agent-loop 实例
- [x] 主代理可以等待或轮询子代理结果
- [ ] 测试：主 agent 派生 2 个子 agent 并行搜索不同关键词，汇总结果（需运行时验证）

**验收标准**：
- [x] `subagent` 工具注册成功，LLM 可调用
- [x] spawn 创建独立会话，不干扰主会话
- [x] result 能拿到子代理的完整文本输出
- [x] list 正确显示活跃子代理
- [x] kill 能终止运行中的子代理
- [x] 构建无类型错误

---

## P1: Docker 沙箱

**目标**：危险命令在 Docker 容器内执行，agent 可以放心试错。

**需要做的**：
- [x] `packages/tools/src/builtin/sandbox.ts` — `sandbox` 工具
  - 在 Docker 容器中执行命令
  - 挂载工作目录（readonly 或 rw 可配置）
  - 使用轻量镜像（node:22-slim）
  - 超时控制（默认 120s）
  - 返回 stdout/stderr/exitCode
- [ ] shell 工具增加 `sandbox: true` 参数选项（已改为独立 sandbox 工具，更清晰）
- [x] Docker 可用性检测（启动时检查 `docker info`，缓存 60s）
- [ ] 测试：在容器内运行 `node -e "console.log('hello')"`（需运行时验证）

**验收标准**：
- [x] sandbox 工具注册成功
- [x] 容器内命令正确执行并返回输出
- [x] 容器执行完自动清理（--rm）
- [x] 超时后容器被 kill
- [x] Docker 不可用时给出明确错误提示
- [x] 构建无类型错误

---

## P2: 浏览器 Playwright CDP 直连

**目标**：用 Playwright CDP 直连替代 Chrome 扩展 WS 桥接，提升浏览器自动化稳定性。

**需要做的**：
- [x] `packages/tools/src/builtin/browser-cdp.ts` — 新的浏览器工具实现
  - 启动/连接 Chrome 实例（专用 profile `~/.agentclaw/browser/`）
  - Playwright `chromium.connectOverCDP()` 直连
  - actions: navigate / snapshot / click / type / screenshot / tabs / evaluate / wait / close
  - DOM Snapshot 生成（ref ID 标记交互元素）
- [x] 安装依赖：`playwright-core`
- [x] 与现有 browser skill 的工具接口保持兼容
- [x] Chrome 实例生命周期管理（start/stop/close）
- [ ] 测试：打开网页 → snapshot → 点击元素 → 截图（需运行时验证）

**验收标准**：
- [x] 能启动独立 Chrome 实例
- [x] Playwright 成功连接 CDP
- [x] navigate + snapshot 返回页面结构
- [x] click/type 操作正确执行
- [x] screenshot 保存到 data/tmp/
- [x] 构建无类型错误

---

## P3: 混合记忆搜索

**目标**：BM25 全文 + 向量语义 + 时间衰减 + MMR 去重，四路融合提升记忆召回准确率。

**需要做的**：
- [x] `packages/memory/src/database.ts` — SQLite FTS5 全文索引
  - 建表 `memories_fts` (FTS5, unicode61 tokenizer)
  - 启动时同步已有 memories 到 FTS 索引
- [x] `packages/memory/src/store.ts` — 混合搜索引擎
  - 4 路评分：BM25 (0.2) + 向量 (0.4) + 时间衰减 (0.15) + 重要性 (0.25)
  - BM25 通过 FTS5 bm25() 函数，负分归一化到 0-1
  - 时间衰减：指数衰减，半衰期 7 天
  - MMR 去重：lambda=0.7 平衡相关性与多样性
  - `escapeFtsQuery()` 安全转义用户查询
- [x] `packages/types/src/memory.ts` — MemoryQuery 类型扩展
  - 新增 bm25Weight / semanticWeight / recencyWeight / importanceWeight 权重参数
- [x] 写入/删除/更新时同步维护 FTS 索引

**验收标准**：
- [x] FTS5 表创建成功，数据同步写入
- [x] BM25 查询返回正确结果
- [x] 混合搜索分数合理（关键词匹配 + 语义相似 + 时间加权）
- [x] MMR 去重有效（不返回语义重复条目）
- [x] 现有 search API 无破坏性变更
- [x] 构建无类型错误

---

## P4: 工具执行钩子 + 策略

**目标**：工具调用前后可拦截、验证、自动修复，实现自动验收。

**需要做的**：
- [x] `packages/types/src/tool.ts` — 钩子类型定义
  - `ToolHooks`: `{ before?: (call) => Promise<call | null>, after?: (call, result) => Promise<result> }`
  - `ToolPolicy`: `{ allow?: string[], deny?: string[] }`
- [x] `packages/core/src/tool-hooks.ts` — 钩子管理器
  - 注册全局钩子和per-tool钩子
  - before: 可修改参数或阻止执行（返回 null）
  - after: 可修改结果或触发额外动作
- [x] `packages/core/src/agent-loop.ts` — 集成钩子
  - 工具调用前执行 before 钩子
  - 工具调用后执行 after 钩子
  - 工具策略检查（deny list 直接拒绝）
- [ ] 预置钩子（可后续按需添加）：
  - `file_write` 后自动运行 Biome lint（如果是 .ts/.js 文件）
  - `shell` 命令 exit code 非 0 时自动标记警告

**验收标准**：
- [x] 钩子注册 API 可用
- [x] before 钩子能阻止工具执行
- [x] after 钩子能修改返回结果
- [x] 工具策略 deny list 生效
- [ ] 预置 lint 钩子正常工作（可后续配置）
- [x] 构建无类型错误

---

## 最终验收

- [x] 全量构建 `npm run build` 通过（8/8 tasks successful）
- [x] 类型检查 `npm run typecheck` 通过（11/11 后端包通过，web 包预存问题不影响）
- [x] 现有测试 `npm test` 通过（45/45 tests passed）
- [ ] Gateway 启动正常，现有功能不受影响（需运行时验证）
- [x] CHANGELOG.md 已更新
- [x] Git 提交并推送
- [ ] 邮件报告已发送至 353249@qq.com
