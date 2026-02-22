# AgentClaw Roadmap

## Q1 紧急 + 重要

- [ ] **Docker 部署** — Dockerfile + docker-compose，解锁云端一键部署
- [x] **模型 failover 链** — FailoverProvider 按优先级尝试多 provider，60s 冷却，stream 未输出时自动切换
- [x] **Shell 沙箱** — validateCommand 拦截破坏性操作（rm -rf /、shutdown、format、fork bomb 等），SHELL_SANDBOX=false 可禁用
- [ ] **Webhook 入口** — `POST /api/webhook` 触发 agent 执行，支持外部系统事件驱动

## Q2 重要 + 不紧急

- [ ] **Skill 安装机制** — 从 URL/Git 安装第三方 skill 到 `~/.agentclaw/skills/`，带版本管理
- [ ] **多 Agent 路由** — 按任务类型分发到不同 agent（编码/研究/创作），各自独立上下文和工具集
- [ ] **OAuth 认证** — 替代纯 API Key，支持 Google/GitHub OAuth 登录 Web UI
- [ ] **浏览器登录态** — 持久化 cookie/session，skill 复用已登录状态而非每次重新登录
