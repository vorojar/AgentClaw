# AgentClaw Claude 启动器

本仓库的工程纪律事实源为：

`C:\Users\voroj\.agent-flow\policy.md`

开始工程任务时先读取该文件。需要项目上下文、验证、交付、重启或能力层 trace 时，优先使用：

```powershell
C:\Users\voroj\.agent-flow\commands\agent-flow.ps1 context
C:\Users\voroj\.agent-flow\commands\agent-flow.ps1 verify
C:\Users\voroj\.agent-flow\commands\agent-flow.ps1 deliver
C:\Users\voroj\.agent-flow\commands\agent-flow.ps1 restart
C:\Users\voroj\.agent-flow\commands\agent-flow.ps1 trace
```

本文件只负责 Claude Code 启动，不承载工程纪律。工程纪律不得复制到这里；如需修改规则，只改 `policy.md`。
