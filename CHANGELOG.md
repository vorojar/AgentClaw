# 更新日志

## [0.3.0] - 2026-02-22

### 新功能
- **TTS 语音回复**：用户发语音时，AI 回复也以语音气泡发送（WhatsApp ptt / Telegram sendVoice）
  - 支持 edge-tts（默认）和 vibevoice 两种 TTS 引擎（`TTS_PROVIDER` / `TTS_VOICE` 环境变量）
  - 自动清理 markdown 格式（粗体、链接、代码块）以适配语音输出
  - 回复超过 500 字自动 fallback 到文字消息
  - TTS 失败时静默降级为文字回复

## [0.2.0] - 2026-02-22

### 新功能
- **对话历史压缩**：超过 20 轮后自动摘要旧对话，减少 token 消耗（`compressAfter` 可配置）
- **Fast Provider 路由**：简短聊天自动路由到轻量模型（`FAST_API_KEY` / `FAST_MODEL` 环境变量配置）
- **MCP 服务器加载**：通过 `data/mcp-servers.json` 配置外部 MCP 工具，支持 stdio 和 HTTP 传输
- **Session 持久化**：会话信息写入 SQLite，重启后可恢复；`MemoryStore` 接口新增 session CRUD 方法
- **SOUL.md 人格设定**：`data/SOUL.md` 定义 AI 名字、性格、称呼、语言和风格，注入 system prompt（`{{soul}}` 模板变量）

### 改进
- **use_skill 不消耗迭代预算**：skill 指令加载不计入 `maxIterations`，实际工作轮次不被挤占
- **maxIterations 提升至 10**：复杂任务（多 skill 组合）不再轻易触发 `max_iterations_reached`
- **工具名 shell → bash**：更准确反映实际使用的 shell 类型
- **工具状态展示优化**（Telegram/WhatsApp）：`use_skill` 静默不推送；bash 显示当前技能名（`⚙️ bash: comfyui`）；搜索显示查询词（`🔍 query...`）
- **对话压缩改用 LLM 真摘要**：调用 LLM 生成 3-5 条 bullet point 摘要（优先用 fastProvider），带缓存，失败回退截断
- **Model 运行时切换**：`PUT /api/config` 修改 model 即时生效，无需重启（provider 切换仍需重启）
- **流式推送重构**（Telegram/WhatsApp）：用事件循环内 buffer flush 替代 `setInterval` 轮询，消除竞态；双触发条件（`\n\n` 段落断点 + 3 秒超时）
- **Shell 输出截断**：双重截断（exec 层 20K + 返回层头尾各 3K），防止长输出撑爆上下文
- **Shell timeout 自动纠正**：检测到 `<1000` 的超时值自动乘以 1000（防止 LLM 传秒而非毫秒）

### 修复
- 修复 Session 删除不级联清理 turns/traces 表，导致数据残留
- 修复 `@types/ws` 缺失导致 gateway typecheck 失败
- 修复对话压缩阈值判断 `>` → `>=`，确保恰好达到阈值时触发压缩
- 修复 `handleDocumentMessage`（语音/文件）缺少 activeSkill 跟踪，导致 `use_skill` 状态泄露、bash 不显示技能名
- 修复 send_file 已发送的文件仍以 markdown 链接重复显示为文本消息（`stripFileMarkdown` 去重）
- 修复工具状态发送后 3 秒计时器未重置，导致首个响应 token 单字吐出

### 清理
- 删除 7 个遗留工具文件（web-search/http-request/python/comfyui/google-*），已被 Skill 系统替代
- 移除 Web UI 中永远为 0 的成本显示（Total Cost 卡片和表格列）

## [0.1.0] - 2026-02-22

首次发布。

### 核心
- Agent 循环（思考-行动-观察）支持流式 LLM 输出
- 多供应商适配：Claude、OpenAI 兼容（DeepSeek/Kimi/Qwen/Doubao）、Gemini
- 视觉模型自动路由（图片输入时切换 visionProvider）
- 上下文管理器：记忆注入 + 技能目录
- 记忆提取器：自动从对话中抽取事实
- 规划器：通过 plan_task 工具分解任务

### 工具
- 核心工具（4个）：shell, file_read, file_write, ask_user
- 条件工具（6个）：send_file, set_reminder, schedule, remember, plan_task, use_skill
- 分层加载：Gateway 加载全部工具，CLI 仅加载核心工具

### 技能
- 13 个技能：browser, coding, comfyui, create-skill, google-calendar, google-tasks, http-request, python-exec, research, weather, web-fetch, web-search, writing
- LLM 自主判断是否需要技能，通过 use_skill 工具 + 系统提示词目录驱动

### 网关
- Fastify HTTP/WS 服务，API Key 认证
- Telegram 机器人（图片/文档/视频/音频/语音）
- WhatsApp 机器人（仅自聊，QR 扫码认证，Baileys）
- 定时任务调度器（cron 提醒）
- REST API：会话、消息、Traces、Token 日志、配置、记忆

### Web 前端
- React 19 + Vite
- 聊天页（流式响应、文件展示）
- Traces 页（LLM/工具执行时间线）
- Token 日志、记忆、设置、API 页面

### 修复
- 修复 MIME 类型文件名泄露 bug：`audio/ogg; codecs=opus` 的参数不再混入文件名
- 语音转文字改用 faster-whisper（`scripts/transcribe.py`），输出到 `data/tmp/`
