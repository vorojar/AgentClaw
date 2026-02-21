# AgentClaw 经验教训

构建 AI Agent 过程中踩过的坑和总结的原则。

## 架构原则

### 意图识别交给 LLM，代码只负责执行
关键词匹配、子串匹配、bigram token overlap… 每种规则匹配都是死胡同——修一个 case 破另一个。"画"匹不到 comfyui，"截屏"误触 browser，"放大这张图"中间隔了字就失效。

**正确做法**：系统提示词放一份轻量目录（name + description，~100 tok），LLM 自行判断是否需要、用哪个，通过 `use_skill(name)` 加载完整指令，下一轮按指令执行。代码零匹配逻辑，零误判。

> 凡是需要"理解用户意图"才能决策的地方，都应该交给 LLM。

### 按需加载优于始终注入
13 个 skill 的完整指令约 2600 tokens，每次对话都注入是浪费。use_skill 模式下只在需要时加载一个 skill 的指令（~200 tok），且同会话内复用不需重复加载。

### 工具分层：核心 + 条件 + 按需
- **核心工具**（4个，永远加载）：shell, file_read, file_write, ask_user
- **条件工具**（按部署模式加载）：send_file, remember, schedule 等
- **Skill 指令**（LLM 按需加载）：comfyui, browser, web-search 等

不要把所有能力都做成工具——工具定义本身消耗 token。

## 工程踩坑

### Windows 路径
所有传给 LLM 的路径必须用 `/`。bash 会把 `\` 当转义符吃掉，LLM 生成的命令里 `\` 也容易出错。在路径生成时统一 `.replace(/\\\\/g, "/")`。

### 弱模型适配
SKILL.md 指令写成可直接复制的 JSON 格式：
```json
{"command": "python scripts/xxx.py --arg value", "timeout": 120000}
```
不要指望弱模型"理解"指令后自己组装命令——它会编造参数名（如 `--input` 代替 `--image`）。

### Shell 超时
默认 30s 对图片生成、视频处理等长任务必炸。SKILL.md 里必须显式写 `"timeout": 120000`。

### 错误雪崩
Agent 第一次工具调用出错后，LLM 会自行补救，越补越乱（改参数、换命令、编造工具名）。要在第一层防住：明确的指令 + 重试机制 + 连续错误上限。

### send_file + LLM 文本双重图片
`send_file` 通过 WebSocket `file` 事件推送图片，LLM 回复文本中又包含 `![](url)` markdown。前端渲染两次 = 两张图。修复：在流式结束（`done`）时按 URL 去重。

### 认证粒度
`/files/` 静态资源不能和 `/api/` 用同一个认证中间件拦截——浏览器 `<img>` 标签不带 Authorization header。静态资源走单独的白名单。

### 第三方库日志
Baileys (WhatsApp) 默认 Pino logger 输出海量 info/warn 日志（pre-key sync、state patch 等）。用自定义 silent logger 只转发 error 级别。

## 设计决策记录

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| Skill 匹配方式 | 关键词 / token overlap / LLM 判断 | LLM 判断 (use_skill) | 规则匹配是死胡同，LLM 天然擅长意图识别 |
| Skill 指令注入 | 始终全量注入 / 按需加载 | 按需加载 | 省 ~2500 tok/次，代价仅多 1 轮迭代 |
| 工具发送给 LLM | 按关键词动态筛选 / 始终全量 | 始终全量 | 动态筛选逻辑复杂且易误判，全量更可靠 |
| 系统提示词位置 | 代码内硬编码 / 外置文件 | 外置 system-prompt.md | 便于调试和非开发者修改，支持模板变量 |
