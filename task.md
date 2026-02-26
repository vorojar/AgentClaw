# AgentClaw Task

## Q1 紧急 + 重要

- [x] **Docker 部署** — Dockerfile + docker-compose，解锁云端一键部署
- [x] **模型 failover 链** — FailoverProvider 按优先级尝试多 provider，60s 冷却，stream 未输出时自动切换
- [x] **Shell 沙箱** — validateCommand 拦截破坏性操作（rm -rf /、shutdown、format、fork bomb 等），SHELL_SANDBOX=false 可禁用
- [ ] **Webhook 入口** — `POST /api/webhook` 触发 agent 执行，支持外部系统事件驱动

## Q2 重要 + 不紧急

- [ ] **Skill 安装机制** — 从 URL/Git 安装第三方 skill 到 `~/.agentclaw/skills/`，带版本管理
- [ ] **多 Agent 路由** — 按任务类型分发到不同 agent（编码/研究/创作），各自独立上下文和工具集
- [ ] **OAuth 认证** — 替代纯 API Key，支持 Google/GitHub OAuth 登录 Web UI
- [ ] **浏览器登录态** — 持久化 cookie/session，skill 复用已登录状态而非每次重新登录

## Phase 9: 借鉴 Manus — Agent 智能提升

> 参考 Manus AI（manus.im）的设计理念，重点提升任务执行透明度和 Agent 自主性

### 9.1 Todo.md 实时进度追踪 🔥 进行中
- [ ] Agent 执行复杂任务时自动创建 todo.md，每步完成后打勾
- [ ] 前端实时展示任务进度清单（WebSocket `todo_update` 事件）
- [ ] 双重作用：用户看进度 + Agent 上下文末尾持续写入目标（防 lost-in-the-middle）

### 9.2 步骤时间线可视化
- [ ] 工具调用事件 → 时间线视图（每步带摘要，可展开详情）
- [ ] 步骤状态标识：进行中（spinner）→ 成功（✓）→ 失败（✗）

### 9.3 会话回放
- [ ] 记录每步操作快照（工具调用 + 结果 + 时间戳）
- [ ] 前端回放界面：时间轴滑块，快进/后退
- [ ] 回放可分享（生成链接）

### 9.4 KV-Cache 上下文优化
- [ ] System prompt 前缀稳定，append-only 上下文
- [ ] 工具注册表固定不变，条件约束代替动态增删
- [ ] 目标：缓存命中率提升，token 成本降 10x

### 9.5 文件系统即上下文
- [ ] 长任务中间结果存文件而非聊天上下文
- [ ] Agent 自动管理工作目录，跨步骤共享文件
- [ ] 结合 todo.md 追踪文件产物
