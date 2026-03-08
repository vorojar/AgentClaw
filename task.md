# AgentClaw 功能实施计划

## Feature 1: 渠道管理面板 (P0)

### 需求
- 新建 `/channels` 页面，展示所有渠道（Telegram / WhatsApp / DingTalk / Feishu / WebSocket）的连接状态
- 每个渠道显示：名称、类型、连接状态（connected/disconnected/error）、启动时间、bot 标识（如 @bot_username）
- 支持运行时启停：toggle 按钮控制 start/stop，无需重启 gateway
- 渠道状态变更时前端实时更新（通过 WS 推送或轮询）

### 后端数据模型

```typescript
// packages/types/src/channel.ts（新文件）
interface ChannelInfo {
  id: string;               // "telegram" | "whatsapp" | "dingtalk" | "feishu" | "websocket"
  name: string;             // 显示名
  type: string;             // 同 id
  status: "connected" | "disconnected" | "error" | "not_configured";
  statusMessage?: string;   // 错误信息或描述
  connectedAt?: string;     // ISO 时间
  botIdentity?: string;     // bot 用户名/ID
  config: {                 // 脱敏后的配置摘要
    [key: string]: string;  // 如 { token: "sk-***abc" }
  };
}

interface ChannelManager {
  list(): ChannelInfo[];
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
}
```

### 后端 API

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/api/channels` | 列出所有渠道及状态 |
| POST | `/api/channels/:id/start` | 启动指定渠道 |
| POST | `/api/channels/:id/stop` | 停止指定渠道 |

### 后端实现要点

1. **新建 `packages/gateway/src/channel-manager.ts`**：
   - 统一管理所有渠道的生命周期
   - 每个渠道适配器需暴露 `start()` / `stop()` / `getStatus()` 方法
   - 现有 bot（telegram.ts / whatsapp.ts 等）需重构：抽取 start/stop 逻辑，不在 index.ts 直接初始化

2. **修改 `packages/gateway/src/index.ts`**：
   - 用 ChannelManager 替代直接的 bot 初始化
   - ChannelManager 挂到 AppContext 上

3. **新建 `packages/gateway/src/routes/channels.ts`**：
   - 注册 3 个 API 端点
   - start/stop 调用 ChannelManager 方法

### 前端

- **新建 `packages/web/src/pages/ChannelsPage.tsx`**
- **新建 `packages/web/src/pages/ChannelsPage.css`**
- **App.tsx** 添加 `/channels` 路由
- **Layout 导航** 添加 Channels 入口

### 前端 UI 规范

- 每个渠道一张卡片，横向 2 列布局（响应式，窄屏 1 列）
- 卡片内容：
  - 左侧：渠道图标（SVG）+ 名称
  - 中间：状态徽章（绿/灰/红）+ bot 标识 + 连接时间
  - 右侧：toggle 开关（已连接 = on，未连接 = off）
  - `not_configured` 状态的渠道灰显，toggle 禁用，提示"未配置环境变量"
- 页面顶部：PageHeader "Channels"
- 自动轮询（5s 间隔）刷新状态

### 验收标准

- [ ] GET /api/channels 返回所有 5 种渠道的状态
- [ ] 未配置环境变量的渠道状态为 not_configured
- [ ] 已配置但未启动的渠道可通过 POST start 启动
- [ ] 已启动的渠道可通过 POST stop 停止
- [ ] 前端页面正确渲染所有渠道卡片
- [ ] toggle 操作后状态实时更新
- [ ] 不配置任何 bot 环境变量时，所有渠道显示 not_configured + 禁用 toggle
- [ ] 页面样式与现有页面（Traces/Settings）风格一致
- [ ] 构建无报错（`npm run build` 全通过）

---

## Feature 2: 任务管理系统 (P1)

### 需求

人与 bot 共享的统一任务管理系统，包含三类实体：
1. **任务（Task）**：工作项，支持 Kanban 视图（Todo / In Progress / Done）
2. **定时任务（Schedule）**：Cron 触发的自动任务，已有 scheduler.ts 实现
3. **日历事件**：有具体日期的任务和定时任务在日历上展示

### 后端数据模型

```sql
-- 新表：tasks（在 packages/memory/src/database.ts 中添加）
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_date TEXT,                    -- ISO 日期（可选）
  assignee TEXT DEFAULT 'human',    -- 'human' | 'bot' | session_id
  created_by TEXT DEFAULT 'human',  -- 'human' | 'bot:<session_id>'
  session_id TEXT,                  -- 关联的会话 ID（bot 创建时）
  trace_id TEXT,                    -- 关联的 trace ID
  tags TEXT DEFAULT '[]',           -- JSON 数组
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due ON tasks(due_date);
```

### 后端 API

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/api/todos` | 列出任务（支持 `?status=&priority=&limit=&offset=`） |
| POST | `/api/todos` | 创建任务 |
| PATCH | `/api/todos/:id` | 更新任务（status/title/description/priority/dueDate/assignee/tags） |
| DELETE | `/api/todos/:id` | 删除任务 |
| GET | `/api/calendar` | 日历数据（合并 tasks 的 due_date + scheduled_tasks 的 nextRunAt） |

> 注：用 `/api/todos` 而非 `/api/tasks`，避免与已有的 `/api/tasks`（定时任务）冲突。

### 后端实现要点

1. **`packages/memory/src/database.ts`**：添加 `tasks` 表的 DDL
2. **`packages/memory/src/store.ts`**：添加 tasks 的 CRUD 方法
3. **`packages/gateway/src/routes/todos.ts`**（新文件）：5 个 API 端点
4. **`packages/gateway/src/routes/calendar.ts`**（新文件）：日历聚合端点

### 前端

- **新建 `packages/web/src/pages/TasksPage.tsx`**
- **新建 `packages/web/src/pages/TasksPage.css`**
- **App.tsx** 添加 `/tasks` 路由
- **Layout 导航** 添加 Tasks 入口

### 前端 UI 规范

#### Kanban 视图（默认）
- 三列布局：Todo | In Progress | Done
- 每列顶部：列标题 + 任务计数 badge
- 任务卡片：
  - 标题（粗体）
  - 描述（截断 2 行，灰色小字）
  - 底部行：优先级 chip（低=灰/中=蓝/高=红）+ 截止日期（如有）+ 创建者标识（人/bot 图标）
  - 卡片可点击展开编辑
- 列底部：「+ 添加任务」按钮
- 页面右上角：视图切换（Kanban / Calendar）

#### Calendar 视图
- 月历网格（标准 7 列布局）
- 日期格子里显示该日的任务标题（截断）和定时任务的 nextRunAt
- 任务用蓝色圆点标识，定时任务用绿色圆点标识
- 点击日期弹出该日任务列表
- 顶部：月份导航（上一月/下一月）+ 当前月份标题

#### 添加/编辑任务
- 内联表单（不用弹窗）：标题输入框 + 描述 textarea + 优先级 select + 截止日期 date picker + 保存/取消按钮
- 状态通过拖拽列或点击菜单切换

### 验收标准

> 注：实现中 API 路径从 `/api/todos` 改为 `/api/tasks`（统一命名），UI 从 Kanban 改为标签页视图（更适合任务生命周期管理），新增了 TaskManager 引擎、Decisions、Automations、Daily Brief 等超出原 spec 的功能。

- [x] GET /api/tasks 返回任务列表，支持 status/priority/executor 筛选
- [x] POST /api/tasks 创建任务（支持自然语言 + 结构化两种方式）
- [x] PATCH /api/tasks/:id 更新任务状态/字段
- [x] DELETE /api/tasks/:id 删除任务
- [x] GET /api/calendar 返回合并后的日历数据（tasks + scheduled tasks）
- [x] GET /api/tasks/scheduled + POST + DELETE — Automations CRUD
- [x] GET /api/tasks/stats — 任务统计
- [x] GET /api/tasks/brief — 每日简报
- [x] POST /api/tasks/:id/execute — 手动触发执行
- [x] POST /api/tasks/:id/decide — 提交决策
- [x] 前端 5 标签页：Today / All Tasks / Calendar / Decisions / Automations
- [x] QuickAdd 快速添加任务
- [x] Task Runner Stats 卡片（Runs / LLM Calls / Tokens / Duration）
- [x] Calendar 视图正确渲染月历 + 任务 + 定时任务
- [x] Decision Queue 展示待决策任务 + 提交决策
- [x] Automations 展示定时任务 + 添加/删除
- [x] 页面样式与现有页面风格一致（Serene Sage 主题）
- [x] 构建无报错
- [x] TaskManager 引擎：捕获 → 分诊 → 队列 → 执行 → 决策 → 简报
- [x] 60s 扫描器自动处理 queued 任务
- [x] SQLite 任务表迁移（CHECK 约束重建 + 索引 + metadata 列 + settings 表）
- [x] 每日简报定时推送（Cron job，默认 09:00，页面可配置，有任务才发）
- [x] 决策提醒机制（heartbeat tick 检查 waiting_decision 任务，直接广播，不消耗 LLM token）
- [x] Daily Brief 发送时间可在 Tasks 页面设置（GET/PUT /api/config + 前端 time picker）

---

## Feature 3: 子代理可视化 (P1)

### 需求

- 展示子代理的执行状态（实时 + 历史）
- 持久化到 SQLite（当前仅在内存中）
- 团队面板风格：每个 agent 显示角色、目标、状态、Token 消耗
- 支持从 Traces 页关联跳转

### 后端数据模型

```sql
-- 新表：subagents（在 packages/memory/src/database.ts 中添加）
CREATE TABLE IF NOT EXISTS subagents (
  id TEXT PRIMARY KEY,
  session_id TEXT,              -- 父会话 ID
  goal TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'killed')),
  result TEXT,
  error TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  tools_used TEXT DEFAULT '[]', -- JSON 数组：使用的工具名列表
  iterations INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_subagents_session ON subagents(session_id);
CREATE INDEX idx_subagents_created ON subagents(created_at DESC);
```

### 后端 API

| 方法 | 路径 | 描述 |
|-----|------|------|
| GET | `/api/subagents` | 列出子代理（支持 `?session_id=&status=&limit=&offset=`） |
| GET | `/api/subagents/:id` | 获取单个子代理详情 |

### 后端实现要点

1. **`packages/memory/src/database.ts`**：添加 `subagents` 表 DDL
2. **`packages/memory/src/store.ts`**：添加 subagents 的持久化方法（create/update/list/get）
3. **`packages/core/src/subagent-manager.ts`**：
   - 接受 `MemoryStore` 注入
   - spawn 时写入 DB
   - 完成/失败时更新 DB（status, result, error, tokens, completedAt）
4. **`packages/gateway/src/routes/subagents.ts`**（新文件）：2 个 API 端点

### 前端

- **新建 `packages/web/src/pages/SubagentsPage.tsx`**
- **新建 `packages/web/src/pages/SubagentsPage.css`**
- **App.tsx** 添加 `/subagents` 路由
- **Layout 导航** 添加 Subagents 入口

### 前端 UI 规范

- 页面标题：PageHeader "Subagents"
- 顶部筛选栏：状态筛选 chip 组（All / Running / Completed / Failed）
- 子代理卡片列表（纵向排列）：
  - 卡片头部：状态图标（运行中=旋转动画/完成=绿勾/失败=红叉/终止=灰色） + 目标文本
  - 卡片元数据行：模型名 badge + Token 消耗（in↑ out↓） + 迭代次数 + 耗时
  - 展开后显示：
    - Result/Error 文本（pre 格式）
    - 使用的工具列表（chip 样式）
  - 卡片设计与 TracesPage 的 TraceCard 保持一致风格
- Running 状态的卡片有脉冲边框动画
- 分页控件（复用 Traces 页的分页样式）
- 空状态提示："No subagents yet"

### 验收标准

- [ ] subagents 表正确创建
- [ ] SubAgentManager.spawn() 时记录写入 DB
- [ ] SubAgent 完成/失败时 DB 记录更新
- [ ] GET /api/subagents 返回列表，支持筛选
- [ ] GET /api/subagents/:id 返回详情
- [ ] 前端页面正确渲染子代理列表
- [ ] 状态筛选功能正常
- [ ] 卡片展开/折叠正常
- [ ] Running 状态有视觉区分（动画）
- [ ] 页面样式与 TracesPage 风格一致
- [ ] 构建无报错

---

## Feature 4: Settings 页 UX 升级 (P2)

### 需求

- 从 Settings 页移除 Scheduled Tasks 部分（已移到 Tasks 页的 Calendar 视图中展示）
- 优化模型配置的展示方式（当前只是文字，改为 chip 选择器）
- 视觉整体升级：统一卡片风格、合理分组

### 前端改动

**修改 `packages/web/src/pages/SettingsPage.tsx`**：

1. **移除 Scheduled Tasks 区域**（已迁移到 Tasks 页）
2. **Usage Statistics 区域**：保持不变
3. **Model Configuration 区域**（新增）：
   - 当前模型显示为高亮 chip
   - 若后端支持模型切换，可点击切换（调用 PUT /api/config）
4. **System Info 区域**：保持不变
5. **Tools 区域**：保持不变

### 验收标准

- [ ] Settings 页不再显示 Scheduled Tasks
- [ ] Model 配置以 chip 形式展示
- [ ] 页面布局合理，无冗余空间
- [ ] 构建无报错

---

## 导航栏更新

### 当前导航项
Chat | Memory | Skills | Traces | Token Logs | Settings | API

### 新增后导航项
Chat | Tasks | Channels | Subagents | Memory | Skills | Traces | Token Logs | Settings | API

### 实现
- 修改 `packages/web/src/components/Layout.tsx`（或类似文件），添加 Tasks / Channels / Subagents 导航项
- 导航图标保持一致风格

---

## 实施顺序

1. **Phase 1**（并行）：
   - Feature 1: 渠道管理面板
   - Feature 3: 子代理可视化
   - Feature 4: Settings UX 升级

2. **Phase 2**：
   - Feature 2: 任务管理系统（依赖 Phase 1 完成 Settings 页 Scheduled Tasks 移除）

3. **Phase 3**：
   - 导航栏统一更新
   - 全局样式审查
   - 集成测试

---

## Feature 2 完成报告（2026-03-08）

### 实现范围

Feature 2 在原 spec 基础上大幅扩展，从简单的 Todo CRUD 演进为完整的 AI 任务管理引擎。

### 架构概览

```
用户（Web/Telegram/WS）
    ↓ 自然语言 / 结构化
TaskManager.captureTask() → LLM 解析 → 自动分诊（agent/human）
    ↓ agent 任务
  入队（queued）→ 60s 扫描器 → executeTask() → LLM 执行 → done/failed
    ↓ 需要决策
  waiting_decision → heartbeat 提醒 → 用户提交决策 → 重新入队或完成
    ↓ 每日简报
  Cron job（可配置时间）→ 有任务才广播
```

### 改动文件清单

| 文件 | 改动 |
|------|------|
| `packages/core/src/task-manager.ts` | **新建** — TaskManager 引擎（捕获/分诊/队列/执行/决策/简报/扫描器） |
| `packages/core/src/index.ts` | export TaskManager |
| `packages/memory/src/database.ts` | settings 表 DDL + tasks 表迁移（CHECK 重建 + 索引 + 扩展列） |
| `packages/memory/src/store.ts` | getSetting/setSetting + getTaskStats 扩展 + updateTask decisionOptions 修复 |
| `packages/gateway/src/index.ts` | TaskManager 初始化 + 每日简报 Cron job + restartDailyBrief |
| `packages/gateway/src/heartbeat.ts` | checkDecisions() — 待决策任务直接广播提醒 |
| `packages/gateway/src/server.ts` | 传 scheduler 给 registerTaskRoutes |
| `packages/gateway/src/routes/tasks.ts` | 完整 Tasks API + Automations（/api/tasks/scheduled） |
| `packages/gateway/src/routes/config.ts` | dailyBriefTime 读写 + 重启 Cron |
| `packages/web/src/api/client.ts` | updateConfig + TaskRunnerStats + ScheduledTaskInfo 接口 |
| `packages/web/src/pages/TasksPage.tsx` | 5 标签页 + TaskRunnerStatsCard + DailyBriefSettings |
| `packages/web/src/pages/TasksPage.css` | Tab/Runner/Brief/Automations 样式 |

### 关键设计决策

1. **不过 LLM 的决策提醒**：heartbeat 直接查 SQLite + 广播，零 token 消耗
2. **不过 LLM 的每日简报**：`generateDailyBrief()` 直接拼接格式化文本，无需 LLM 润色
3. **有任务才发简报**：`total_pending === 0` 时跳过，避免每日空消息骚扰
4. **简报时间可配置**：settings 表 KV 存储 + PUT /api/config 热更新 Cron job
5. **Tab 样式用 box-shadow**：避免浏览器 focus 圆角 bug
6. **Task Runner Stats 独立分区**：顶部分割线 + 间距，视觉层次清晰

### 测试验证

- [x] 全量构建通过（`npm run build`，8 packages，0 errors）
- [x] Playwright 页面快照验证：5 标签页 + Stats + Daily Brief 控件
- [x] Playwright 控制台零错误
- [x] API 测试：GET/PUT /api/config 返回 dailyBriefTime
- [x] API 测试：GET /api/tasks/scheduled 返回 200
- [x] Automations 标签页渲染正常

### 与原 spec 的差异

| 原 spec | 实际实现 | 原因 |
|---------|---------|------|
| `/api/todos` | `/api/tasks` | 统一命名，tasks 更通用 |
| Kanban 三列视图 | 5 标签页 | 任务状态从 3 种扩展到 10 种，Kanban 不适用 |
| 简单 CRUD | TaskManager 引擎 | 支持 AI 自动捕获、分诊、执行 |
| 无 | Decisions 标签页 | 支持 AI 请求人类决策 |
| 无 | Automations 标签页 | 原 Settings 页 Scheduled Tasks 迁移至此 |
| 无 | Task Runner Stats | 展示 AI 后台执行统计 |
| 无 | Daily Brief 定时推送 | 每日自动广播任务摘要 |
| 无 | 决策提醒机制 | heartbeat 检查 + 广播 |
