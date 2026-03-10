# 更新日志

## [1.3.8] - 2026-03-10

### 修复
- **sidebar spinner 切换会话闪烁**：解耦 streamingSessionId 和 isSending，spinner 只在收到 done 时清除，不再因切换会话而消失
- **切换会话时工具调用串台**：切换会话时重置 resumingRef，防止 loadHistory 的 resuming 分支把旧会话的 streaming 消息合并到新会话
- **WS 重连时工具调用重复显示**：loadHistory resuming 合并时去掉 history 末尾的 assistant 消息，避免与 buffer 回放重复

### 变更
- **移除 CLAUDE.md 前端 Playwright 验证规则**：删除标准工作流中的前端验证步骤和前端调试规则章节

## [1.3.7] - 2026-03-10

### 改进
- **侧边栏会话 streaming 指示器**：会话正在响应时，左侧会话列表对应项显示旋转加载动画

### 修复
- **切换会话时 spinner 和工具调用串台**：streaming 指示器锁定到发起请求的会话，切换会话时重置 isSending 状态

## [1.3.6] - 2026-03-10

### 新增
- **Agent Handoff（代理交接）**：多代理场景下，LLM 可通过 `handoff` 工具将对话交给更合适的专家代理继续处理，最多 3 次连续交接，前端显示交接通知气泡

## [1.3.5] - 2026-03-10

### 修复
- **WS 断连后流式输出丢失**：agent loop 与 socket 解耦，断连时 loop 继续运行并缓冲事件，重连后自动回放，无需刷新页面

## [1.3.4] - 2026-03-10

### 改进
- **预览面板化**：HTML 预览从全屏 overlay 改为右侧可拖拽宽度的 panel
- **预览面板拖拽宽度**：左边缘拖拽调整（20%-70%），移动端仍全屏

### 修复
- **Markdown 预览源码/复制显示渲染后 HTML**：改为获取原始 markdown 文本
- **二进制文件预览隐藏源码/复制按钮**：pptx/xlsx/pdf 等文件的源码无意义
- **Lone surrogate 导致 Claude API 400（彻底修复）**：在 provider 层统一清理所有发往 API 的文本

## [1.3.3] - 2026-03-10

### 新增
- **编辑消息支持历史截断**：编辑用户消息时后端截断该时间点之后的对话历史再重发
- **编辑首条消息自动更新会话标题**

## [1.3.2] - 2026-03-10

### 修复
- **file_write 容错非 string content**：弱模型传 Object/Array 时自动 JSON.stringify
- **工具重试限制器误杀**：failKey 改为包含参数签名，LLM 自我修正后不再被拦截
- **browser_cdp evaluate 输出截断**：限制 8000 字符，防止错误页面灌爆上下文

## [1.3.1] - 2026-03-10

### 修复
- **任务 QuickAdd 走 LLM 分流**：经 captureTask 自动判断 agent/human 执行者
- **captureTask 返回值序列化**：修复前端 NaN 时间和字段名不匹配
- **任务执行注入工作目录**：确保 LLM 生成的文件保存到 data/tmp
- **文件预览 IconDownload 未定义**：补充导入修复 md 预览崩溃

## [1.3.0] - 2026-03-09

### 新增
- **多语言支持（i18n）**：Web 前端完整国际化，英文/中文切换，覆盖 13 页面 + 7 组件约 200 个翻译键

## [1.2.1] - 2026-03-09

### 改进
- **schedule 工具参数描述完善**：message 字段明确标注"仅填写任务指令"
- **Scheduled Tasks 持久化**：定时任务存入 SQLite，重启后自动恢复

### 新增
- **Projects 项目管理系统**：类似 Claude.ai Projects，会话按项目分组，支持 CRUD、自定义颜色/指令
- **项目详情页**：ChatGPT 风格文件夹视图，内联聊天入口，会话预览
- **侧边栏项目区**：折叠式项目列表、新建项目弹窗、会话"移至项目"操作
- **工具调用折叠组**：≥3 个已完成工具调用自动折叠为摘要，点击展开详情

## [1.2.0] - 2026-03-08

### 新增
- **企业微信渠道**：`@wecom/aibot-node-sdk` WebSocket 长连接，支持文字/图片/语音/文件、流式回复、主动推送
- **social_post 工具**：一次调用发帖到 X/小红书/即刻，支持附加图片
- **浏览器 click 文本选择器**：`text=xxx` 按可见文本匹配点击
- **paste_image 三级 fallback 去重**
- **QQ Bot 富媒体消息**：语音/图片/视频/文件处理，语音自动转文字
- **QQ Bot `/new` 命令和语音回复**
- **Telegram 语音框架层转录**：省去 LLM 调 shell 转录的 ~50K tokens
- **MAX_ITERATIONS 环境变量**
- **浏览器登录态持久化**：Chrome 扩展导出 → Playwright storageState 复用
- **TaskManager 任务管理引擎**：自然语言捕获→分诊→队列调度→自动执行→决策请求→每日简报
- **Tasks 页面重构**：5 标签页 + Task Runner Stats + QuickAdd + Decision Queue

### 改进
- **输入框图片粘贴**：textarea 支持 Ctrl+V 粘贴图片
- **语音输入 MediaRecorder fallback**：不支持 Web Speech API 时使用 MediaRecorder
- **图片 vision 修复**：DB 改为存储 ContentBlock[] JSON，支持图片路径引用
- **每日简报定时推送**、决策提醒机制、Settings KV 存储

## [1.1.0] - 2026-03-08

### 新增
- **QQ 机器人渠道**：QQ 开放平台 Bot API v2，C2C 私聊和群聊，WebSocket 网关

## [1.0.3] - 2026-03-08

### 修复
- **API 请求头覆盖**：renameSession headers 覆盖 Authorization 头
- **promptUser 超时保护**：WS/钉钉/飞书 添加 5 分钟超时

## [1.0.2] - 2026-03-08

### 修复
- **WebSocket 自动重连增强**：无限重试 + visibilitychange/online 事件监听
- **LLM 流异常捕获**：网络断开时 token 统计和 trace 仍能保存
- **上下文截断污染修复**：截断前先浅拷贝，避免直接修改原始 Message
- **promptUser 超时保护**：Telegram/WhatsApp 5 分钟超时
- **eventStream/taskDecisions 资源泄漏修复**
- **FTS5 索引事务保护**、向量相似度维度修复、WebSocket error 处理

## [1.0.1] - 2026-03-07

### 新增
- **单元测试**：memory/tools/gateway 三个包共 152 个用例（会话 CRUD、沙箱规则、HTTP 认证等）

## [1.0.0] - 2026-03-06

### 新增
- **多 Agent 系统**：创建/编辑/删除自定义 Agent，独立 Soul/Model/Temperature/Tools 过滤
- **5 个预设 Agent**：AgentClaw、Coder、Writer、Analyst、Researcher
- **Agent 管理页面** + 会话级 Agent 选择

### 修复
- Agent soul 注入失败、gitignore 遗漏 SQLite 文件

## [0.9.9] - 2026-03-06

### 修复
- **WebUI 图片上传路径丢失**：统一存储到 data/uploads/
- **comfyui 图片路径兜底**：resolve_image_path 查找
- **后台任务会话污染侧边栏**

### 新增
- **Task Runner 统计卡片**

## [0.9.8] - 2026-03-06

### 改进
- **全栈代码重构**：44 文件净减 ~800 行，提取公共工具函数，消除跨包重复

## [0.9.7] - 2026-03-06

### 改进
- **Serene Sage 主题**：全站鼠尾草绿暖色调主题，Light/Dark 双套色板，语义化 CSS 变量

## [0.9.6] - 2026-03-06

### 新增
- **Google Tasks 统一看板**：Google Tasks 作为数据源，支持 CRUD 操作
- **Google Calendar 日程展示**：未来 14 天事件按日期分组
- **Task Runner 智能执行**：LLM 自动判断任务可执行性
- **Automations 面板**：定时任务管理从 Settings 迁至 Tasks 页

### 移除
- 旧版本地 SQLite 任务看板

## [0.9.5] - 2026-03-05

### 新增
- **Google Workspace CLI (gws) 集成**：5 个 Skill（calendar/tasks/gmail/drive/sheets），零 token 开销

## [0.9.4] - 2026-03-05

### 新增
- **Settings 定时任务管理**：查看、创建、删除定时任务

## [0.9.3] - 2026-03-05

### 新增
- **频道管理面板**：运行时控制五个频道启停，状态指示灯，5 秒自动刷新
- **任务看板**：Todo/In Progress/Done 三列，优先级标记，Human/Bot 指派
- **子代理可视化页面**：运行记录、状态筛选、token/工具/迭代详情
- **ChannelManager 统一管理**

### 改进
- 侧边栏导航分层（主导航 + More 折叠组）
- Task Runner 自动执行 bot 任务

## [0.9.2] - 2026-03-05

### 修复
- **工具停止机制**：用户点击停止后子进程无法终止，新增 AbortSignal 传导链

### 改进
- Traces 页 token 显示改为 tokensIn↑/tokensOut↓ 分开

## [0.9.1] - 2026-03-05

### 新增
- **file_edit 工具**：精确字符串替换，支持唯一匹配校验和 replace_all
- **glob 工具**：文件名模式搜索
- **grep 工具**：正则内容搜索
- **子代理 explore 只读模式**

## [0.9.0] - 2026-03-05

### 新增
- **子代理编排**：subagent 工具 + SimpleSubAgentManager，独立 agent-loop 并行执行
- **Docker 沙箱**：sandbox 工具，容器内安全执行，资源限制
- **浏览器 CDP 直连**：browser_cdp 工具，Playwright connectOverCDP，DOM 快照 ref ID
- **混合记忆搜索**：FTS5 + BM25 + 向量语义 + 时间衰减 + MMR 去重
- **工具执行钩子**：before/after + allow/deny 策略

## [0.8.30] - 2026-03-04

### 新增
- **钉钉机器人**：Stream 模式，无需公网 IP
- **飞书机器人**：WebSocket 模式，无需公网 IP

## [0.8.29] - 2026-03-04

### 新增
- **OpenAI Compatible Embedding**：embed() 方法支持 /v1/embeddings 端点

### 修复
- Volcano Embedding 响应解析修复

## [0.8.28] - 2026-03-04

### 新增
- **Vitest 测试框架**：core + providers 共 45 个测试
- **Sentry 错误监控**：gateway + web 端条件初始化
- **API 路由输入校验**：13 个端点 JSON Schema 校验
- **Gateway 优雅关停** + /health 健康检查

### 改进
- knip 死代码清理、Biome 格式化、GitHub Actions CI

## [0.8.27] - 2026-03-04

### 新增
- **Office 文件预览**：docx/pptx 转 PDF、xlsx/csv 转 HTML 表格，LibreOffice 并发控制

## [0.8.26] - 2026-03-02

### 改进
- **web_fetch SPA 自动降级增强**：已知 SPA 域名列表直接走 Playwright
- **send_file autoComplete**：成功后自动结束 agent-loop 省 token
- **上下文膨胀控制**：只保留最近 2 条 tool result 完整内容
- **Telegram 流式输出**：sendMessageDraft 实时更新消息

### 新增
- **Markdown 文件预览**：服务端 marked 渲染为 HTML
- **Claude Code 执行过程透明化**：实时推送每步操作到前端

### 修复
- file_write/send_file 相对路径修复、Windows 下子进程弹窗、Telegram 文件显示为 DAT

## [0.8.25] - 2026-03-02

### 新增
- **跨通道会话同步**：Telegram/WhatsApp 完成后广播 session_activity 到 Web UI

### 改进
- 健康检查静默恢复，仅新故障通知

## [0.8.24] - 2026-03-02

### 新增
- **Browser Accessibility Snapshot**：结构化无障碍快照，token 节省 70-80%
- **Ref ID 选择器**：click/type/wait_for 支持 ref ID

## [0.8.23] - 2026-03-02

### 新增
- **Health-check 框架**：5 项服务自动检测 + 定时复检 + 异常注入系统提示词
- **Browser scroll/reload**
- **Claude Code 开发 hooks**：auto-build、check-changelog、auto-restart-gateway

### 改进
- web_fetch 智能瀑布策略（SPA 自动回退 Playwright、登录墙检测）

## [0.8.22] - 2026-03-02

### 新增
- **web_search 内置工具**：SearXNG + Serper 直接作为核心工具

### 改进
- Skill description 精确化（browser/web-fetch/web-search 职责边界）

## [0.8.21] - 2026-03-02

### 新增
- **web_fetch 注册为核心工具**
- **Readability 正文提取**：@mozilla/readability 自动提取正文，token 节省 70-80%

### 改进
- HTML→Markdown 输出（turndown 替换正则）、浏览器 UA 伪装

## [0.8.20] - 2026-03-01

### 新增
- **web-fetch Playwright 替代**：无头 Chromium 支持 JS 渲染 + 自动滚动
- **LLM stopReason 管道**：检测 max_tokens 截断并 warn

### 修复
- maxTokens 4096→8192、temperature 0.7→0.5
- use_skill 无限循环防护、auto-install 命令注入白名单
- context-manager 缓存碰撞和内存泄漏
- WS 重连指数退避

## [0.8.19] - 2026-03-01

### 修复
- comfyui 图片生成路径改为会话目录（--output-dir 参数）

## [0.8.18] - 2026-03-01

### 修复
- **use_skill 框架层替换 {WORKDIR}**：LLM 拿到带绝对路径的命令，不再依赖 LLM 自己读取路径
- 移除与技能冲突的路由规则、强制 use_skill 优先

## [0.8.17] - 2026-03-01

### 修复
- **技能目录注入 description**：弱模型无法将意图关联到纯名称，改为 `name: 中文描述` 格式

## [0.8.16] - 2026-03-01

### 修复
- 上传文件重复消除、技能输出路径统一使用 {WORKDIR}

## [0.8.15] - 2026-03-01

### 修复
- 用户附件统一进 per-trace 工作目录、shell auto_send 不再误发 ls 列出的历史文件

## [0.8.14] - 2026-02-28

### 改进
- 运行时 hint 全部中文化，与系统提示词语言一致

## [0.8.13] - 2026-02-28

### 修复
- 图片路径 hint 改为每轮注入（DB 存干净内容）
- 输出文件按会话隔离、shell auto_send 正则支持子目录

## [0.8.12] - 2026-02-28

### 修复
- bash 失败计数按命令区分（不同命令不互相阻断）
- update_todo description 与系统提示词统一
- gcal.py token 刷新错误处理

## [0.8.11] - 2026-02-28

### 改进
- 工具执行耗时持久化到 trace、移除 todo auto-advance

### 修复
- file_read/file_write `/tmp` 路径映射（Windows Git Bash 兼容）

## [0.8.10] - 2026-02-28

### 改进
- 代码精简：bootstrap 消除重复变量、context-manager 记忆提示语中文化

## [0.8.9] - 2026-02-28

### 优化
- 系统提示词全中文化并精简 35%
- 记忆去重双层防线（LLM 侧 + 代码侧跨类型搜索）

## [0.8.8] - 2026-02-28

### 精简
- 删除 3 个冗余工具（set_reminder/plan_task/delegate_task）和 2 个冗余技能
- 每轮 LLM 调用减少 ~450 tokens

## [0.8.7] - 2026-02-28

### 改进
- 删除 skill auto-injection，统一走 use_skill 按需加载
- update_todo 自动推进（工具成功后自动标记下一项）
- 移动端文件选择修复

## [0.8.6] - 2026-02-27

### 修复
- 历史消息 /files/ URL 清理、附件 hint 自然语言化、send.py 路径自动搜索
- 带附件发邮件：92k → 6.7k tokens

## [0.8.5] - 2026-02-27

### 改进
- Per-trace 临时目录隔离、脚本文件不再自动发送、Todo 进度持久化
- 非图片附件对 LLM 可见（注入文件路径提示）

## [0.8.4] - 2026-02-27

### 修复
- 用户图片自动保存到文件（避免后续迭代重发 base64）
- 强制 use_skill 优先、PowerShell 自动路由
- Skill 自动注入（结构信号匹配）、连续错误阈值 2→3

## [0.8.3] - 2026-02-27

### 修复
- 记忆回归系统提示词（KV-Cache 优化误移到 user 消息导致被忽略）
- Email Skill 强制检查环境变量、Shell 超时 30s→120s
- Skill 依赖自动安装、Token 统计持久化完善
- maxIterations 10→15

## [0.8.2] - 2026-02-27

### 修复
- SearXNG 搜索质量（仅保留 yahoo + duckduckgo、恢复 language=zh-CN）
- 知识类问题不再触发搜索
- ToolRegistry skill 自动重定向（弱模型分不清 tool/skill）

## [0.8.1] - 2026-02-26

### 新功能
- **Todo 实时进度追踪**：update_todo 工具 + 前端进度条
- **SearXNG 搜索引擎集成**：自托管免费元搜索，docker-compose 包含

### 优化
- Agent loop 上下文缓存复用、Claude provider cache_control
- 代码块简化、单行代码块轻量渲染

## [0.8.0] - 2026-02-26

### 新功能
- **Docker 化部署**：多阶段 Dockerfile + docker-compose 一键启动
- **React 实时预览（Artifacts）**：JSX/TSX 代码块 Babel 编译 + React 19 CDN 渲染

### 修复
- sendFile 子目录路径、Vite 项目预览降级、HTML 预览安全

## [0.7.15] - 2026-02-26

### 修复
- Shell 工具文件自动发送正则修复（支持任意扩展名）
- 欢迎页附件按钮和 pending files 修复

## [0.7.14] - 2026-02-25

### 新功能
- **语义向量化**：火山引擎 doubao-embedding-vision 多模态 API

## [0.7.13] - 2026-02-25

### 新功能
- **欢迎页重设计**：居中输入框 + 技能快捷入口，对齐 Claude/Gemini 风格
- **输入框两行布局**、技能弹出菜单

## [0.7.12] - 2026-02-25

### 新功能
- **Skill 预选芯片**：输入框快捷按钮跳过 use_skill，每次节省 ~3000 token

## [0.7.11] - 2026-02-25

### 新功能
- **消息编辑重发**、**ask_user Web 端交互支持**

### 改进
- Skill 目录恢复短描述、消息 meta 精简

## [0.7.10] - 2026-02-25

### 新功能
- **Web 语音输入**：Web Speech API 实时语音转文字

## [0.7.9] - 2026-02-25

### 优化
- 系统提示词瘦身（-80 token）、长期记忆注入精简（10→5 条）
- Skill 目录压缩（~250→~30 tok）、工具失败自动熔断

## [0.7.8] - 2026-02-25

### 改进
- 移动端侧边栏加宽、左滑关闭

### 修复
- claude_code 嵌套会话报错、输出重复

## [0.7.7] - 2026-02-25

### 改进
- Header 操作菜单（Rename/Export/Delete）、移动端删除按钮精简

## [0.7.6] - 2026-02-25

### 安全修复
- **命令注入漏洞（RCE）**：execSync 拼接改为 execFileSync 参数数组

### 修复
- Gemini 工具调用 ID 修复、deleteSession 事务、Trace JSON 解析容错
- ensureConversation 竞态、Agent stop 后仍重试、WhatsApp LID undefined

## [0.7.5] - 2026-02-24

### 新功能
- **claude_code 工具**：集成 Claude Code CLI，流式输出实时推送

### 改进
- 手机端侧边栏手势、Artifacts 预览（HTML/SVG/Mermaid）、工具调用 JSON 树形展示

### 修复
- WS 断连崩溃（safeSend）、Cloudflare Tunnel 503、WS 长推理断连
- Stop 按钮无效、手机回车误发送、手机侧边栏自动弹出

## [0.7.4] - 2026-02-24

### 新功能
- **URL 路由驱动会话**：`/chat/{sessionId}` 支持前进/后退/刷新/分享

### 修复
- New Chat 415 错误、零请求优化、消息闪跳、Connection Lost

## [0.7.3] - 2026-02-23

### 改进
- yt-dlp --no-warnings、--write-auto-subs，bilingual-subtitle CC 快路径

## [0.7.2] - 2026-02-23

### 新功能
- **bilingual-subtitle skill**：字幕提取/翻译/烧录，GPU 加速 Whisper
- **会话重命名**（双击标题）、全局字号提升

### 改进
- Memory 语义去重（相似度阈值 0.75）、Browser batch 模式（多步操作压缩到 2 轮）

### 修复
- Telegram/WhatsApp 广播持久化、会话懒创建

### 移除
- Plans 页面（无实际用途）

## [0.7.1] - 2026-02-23

### 改进
- Settings 页精简、Skills 独立页面、临时文件自动清理

## [0.7.0] - 2026-02-23

### 新功能
- **5 个新技能**：docx、xlsx、pptx、pdf、imap-smtp-email
- **技能开关/导入/删除**

## [0.6.1] - 2026-02-23

### 新功能
- **视频/音频播放器嵌入**、**图片多模态支持**、**会话搜索**、**移动端侧边栏优化**

### 改进
- 工具调用卡片标题增强（显示命令/技能名/路径）

## [0.6.0] - 2026-02-22

### 重构
- **WebUI 单侧边栏布局**：合并双侧边栏为 Claude 风格统一侧边栏，所有 emoji 替换为 SVG 图标

## [0.5.0] - 2026-02-22

### 新功能
- **Light/Dark 主题**、代码高亮+复制、Stop 按钮、Session 标题
- 文件上传/拖拽、消息重新生成、浏览器通知、模型切换
- 会话删除、对话导出、消息搜索、工具执行状态

## [0.4.0] - 2026-02-22

### 新功能
- **模型 Failover 链**：多 provider 自动故障切换，60 秒冷却
- **Shell 沙箱**：拦截破坏性命令
- **子 Agent 委派**：delegate_task 工具

### 技能
- yt-dlp 技能（视频/音频下载）

## [0.3.0] - 2026-02-22

### 新功能
- **TTS 语音回复**：edge-tts / vibevoice，超 500 字降级文字

## [0.2.0] - 2026-02-22

### 新功能
- 对话历史压缩、Fast Provider 路由、MCP 服务器加载、Session 持久化、SOUL.md 人格设定

### 改进
- use_skill 不消耗迭代预算、流式推送重构、Shell 输出截断

## [0.1.0] - 2026-02-22

首次发布。

- Agent 循环（思考-行动-观察）+ 流式 LLM 输出
- 多供应商适配：Claude、OpenAI 兼容、Gemini
- 核心工具 4 个 + 条件工具 6 个 + 13 个技能
- Fastify HTTP/WS + Telegram Bot + WhatsApp Bot
- React 19 + Vite 前端
- SQLite 持久化 + 定时任务调度
