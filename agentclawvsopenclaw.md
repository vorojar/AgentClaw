# AgentClaw vs OpenClaw 核心能力对比

> 对比时间：2026-03-05 | 核心评估维度：**"给目标就能自己干活、自己验收"**
>
> ⚠️ 本文基于 OpenClaw GitHub 仓库源码实际核查，非 README 级别对比

## 一、Agent 自主性（能不能自己干活）

| 能力 | OpenClaw | AgentClaw | 判定 |
|---|---|---|---|
| **任务规划/分解** | 无独立 Planner，依赖 LLM 自行规划 | SimplePlanner 自动分解 → 按依赖执行 → 失败重规划 | **AgentClaw 胜** |
| **子代理编排** | `sessions_spawn` 工具，完整生命周期（spawn/monitor/steer/kill/announce） | SubAgentManager spawn 独立子 agent，并行执行，汇总结果 | **持平** |
| **工具钩子** | `before_tool_call` / `after_tool_call` 钩子 + 循环检测 + 参数修改 | ToolHooks before/after + ToolPolicy allow/deny + 预置 Biome lint 钩子 | **持平** |
| **自动验收** | after 钩子可用于检查，但无预置验收逻辑 | 预置 after 钩子：Biome lint 自动格式化 + exit code 警告 | **AgentClaw 小胜** |
| **进度追踪** | 无独立进度追踪机制 | todo.md 实时追踪 + 前端 WebSocket 推送 | **AgentClaw 胜** |
| **技能自创建** | skill-creator 元技能（Python 脚本生成 skill） | create_skill 工具 + 热加载（fs.watch）+ 用户确认 | **持平** |
| **自动重试** | retry policy | 网络工具指数退避重试（2s/4s） | **持平** |
| **Thinking 级别** | off/minimal/low/medium/high/xhigh 六档精细控制 | 无分级，依赖模型本身能力 | **OpenClaw 胜** |

## 二、安全执行（能不能放心试错）

| 能力 | OpenClaw | AgentClaw | 判定 |
|---|---|---|---|
| **Docker 沙箱** | Dockerfile.sandbox，容器隔离 | sandbox 工具（512MB/1CPU/120s/自动清理） | **持平** |
| **Shell 防护** | elevated bash 开关（权限分级） | validateCommand 黑名单 + ToolPolicy deny list | **持平** |
| **权限门控** | pairing mode + per-session elevated | ToolPolicy allow/deny + before 钩子可拦截 | **持平** |

## 三、记忆与上下文（能不能记住、找得准）

| 能力 | OpenClaw | AgentClaw | 判定 |
|---|---|---|---|
| **长期记忆** | 成熟记忆系统：自动提取 + 6 种 embedding 后端（OpenAI/Voyage/Jina/Ollama/Gemini/本地） | MemoryExtractor 自动提取事实/偏好/实体/情景 | **OpenClaw 胜** |
| **记忆搜索** | 混合检索：BM25 FTS + 向量 + MMR + 时间衰减，可选 LanceDB | FTS5 BM25 + 向量 + 时间衰减 + MMR 四路融合 | **OpenClaw 小胜** |
| **上下文压缩** | `/compact` 命令 | 超 20 轮自动 LLM 摘要压缩 | **AgentClaw 小胜** |
| **KV-Cache 优化** | 未提及专门优化 | System prompt 固定前缀 + reuseContext + Claude cache_control | **AgentClaw 胜** |

## 四、平台覆盖（能不能到处用）

| 能力 | OpenClaw | AgentClaw | 判定 |
|---|---|---|---|
| **IM 网关数量** | **21 个**（WhatsApp/TG/Slack/Discord/Teams/Signal/iMessage/飞书/LINE…） | 4 个（Telegram/WhatsApp/钉钉/飞书） | **OpenClaw 完胜** |
| **设备集成** | macOS/iOS/Android 原生 App（摄像头/录屏/定位/短信/通讯录） | 无 | **OpenClaw 完胜** |
| **语音交互** | Voice Wake + push-to-talk + ElevenLabs TTS | edge-tts / vibevoice 语音回复 | **OpenClaw 胜** |
| **Canvas/UI 生成** | A2UI agent 驱动的可视化工作区 | Artifacts 预览（HTML/SVG/Mermaid/JSX） | **OpenClaw 胜** |

## 五、工具与创作（能不能做具体的活）

| 能力 | OpenClaw | AgentClaw | 判定 |
|---|---|---|---|
| **浏览器自动化** | CDP 直连 Chrome + profiles | CDP 直连 Chrome + 专用 profile + 登录态持久化 | **持平** |
| **图片生成** | OpenAI API Skill（DALL-E/GPT-Image，云端付费） | ComfyUI 本地文生图 + 去背景 + 4x 放大（自托管免费） | **各有优势** |
| **Office 文档** | 无 | DOCX/XLSX/PPTX/PDF 四个 Skill | **AgentClaw 胜** |
| **搜索引擎** | Brave/Perplexity/Grok/Gemini/Kimi（商业 API，需付费） | SearXNG 自托管（$0）+ Serper fallback | **AgentClaw 胜** |
| **邮件收发** | Gmail Pub/Sub | IMAP/SMTP 通用邮件 Skill | **持平** |
| **模型灵活度** | 多 provider + OAuth + failover | 自研 AgentLoop 任意 provider + failover | **持平** |
| **定时任务** | cron + webhooks + Gmail 触发 | cron + orchestrator 自动执行 + 多网关广播 | **持平** |

---

## 总结

| 维度 | AgentClaw 胜 | OpenClaw 胜 | 持平/各有优势 |
|---|---|---|---|
| Agent 自主性 | **3**（Planner/进度追踪/自动验收） | 1（Thinking） | 4 |
| 安全执行 | 0 | 0 | **3** |
| 记忆与上下文 | **2**（压缩/KV-Cache） | 2（记忆/检索） | 0 |
| 平台覆盖 | 0 | **4** | 0 |
| 工具与创作 | **2**（Office/搜索） | 0 | 5 |
| **合计** | **7** | **7** | **12** |

### 核心结论

两个项目**各有侧重，整体势均力敌**。

**AgentClaw 的真正优势**在于：
1. **独立的任务规划器**（SimplePlanner）——自动分解任务、按依赖执行、失败重规划，这是 OpenClaw 没有的
2. **可视化进度追踪**——todo.md 实时更新 + WebSocket 前端推送
3. **零成本搜索**——SearXNG 自托管，不依赖付费 API
4. **Office 文档生成**——DOCX/XLSX/PPTX/PDF 四格式
5. **本地图片生成**——ComfyUI 自托管，不依赖云端 API
6. **KV-Cache 优化**——System prompt 固定前缀设计，降低 token 成本

**OpenClaw 的真正优势**在于：
1. **平台覆盖碾压**——21 个 IM 网关 + 原生设备 App + 语音唤醒
2. **更成熟的记忆系统**——6 种 embedding 后端 + LanceDB 可选
3. **Thinking 精细控制**——六档思考级别
4. **A2UI 可视化工作区**——agent 驱动的 Canvas

### 差异化定位

| | AgentClaw | OpenClaw |
|---|---|---|
| **核心定位** | 自主完成复杂任务的 AI Agent | 全平台覆盖的 AI 助手 |
| **关键差异** | Planner + 进度追踪 + 自托管工具栈 | 21 IM + 原生 App + 成熟记忆 |
| **成本模型** | 搜索/图片自托管零成本 | 依赖商业 API（Brave/DALL-E） |
| **适合场景** | 需要 Agent 自主规划、执行、验收的复杂任务 | 需要在多平台多设备上随时可用 |

---

## 六、项目规模对比

| 指标 | AgentClaw | OpenClaw | 倍数 |
|---|---|---|---|
| **源代码总行数** | ~27,700 行 | ~1,068,700 行（估算） | **39x** |
| **业务代码（排除测试）** | ~26,000 行 | — | — |
| **源文件数** | 114 个 | 7,683 个 | **67x** |
| **主力语言** | TypeScript 100% | TypeScript 87% + Swift 9% + Kotlin 2% |  |
| **原生客户端** | 无 | iOS (Swift ~94K行) + Android (Kotlin ~22K行) |  |
| **GitHub Stars** | — | 263,507 |  |
| **总提交数** | ~50 | 16,917 | **338x** |
| **贡献者** | 1 人 | 多人团队（主力 11K+ 提交） |  |
| **项目启动** | 2025 年 | 2025-11-24 |  |

### AgentClaw 各包代码量

| 包 | .ts | .tsx | .css | 合计 |
|---|---:|---:|---:|---:|
| `packages/web` | 541 | 5,234 | 3,719 | **9,494** |
| `packages/gateway` | 5,692 | — | — | **5,692** |
| `packages/core` | 4,284 | — | — | **4,284** |
| `packages/tools` | 3,127 | — | — | **3,127** |
| `packages/providers` | 2,402 | — | — | **2,402** |
| `packages/memory` | 1,251 | — | — | **1,251** |
| `packages/types` | 936 | — | — | **936** |
| `packages/cli` | 515 | — | — | **515** |
| **合计** | **18,748** | **5,234** | **3,719** | **27,701** |

### 规模解读

AgentClaw 用 **不到 3 万行代码**实现了与百万行级项目**功能对等的核心 Agent 能力**（子代理、沙箱、记忆、钩子）。差距主要在：

1. **平台覆盖**：OpenClaw 的 21 个 IM 适配器 + iOS/Android 原生 App 贡献了大量代码
2. **生态成熟度**：OpenClaw 263K Stars、1.7 万次提交，社区驱动迭代远更密集
3. **代码密度**：AgentClaw 27K 行 = OpenClaw 1/39 的代码量，但在 Agent 自主性维度（Planner/进度追踪/自动验收）有独特优势

> **结论**：代码量不是竞争力，架构选择才是。AgentClaw 选择了"小而精"的路线——用最少的代码实现最核心的 Agent 自主能力，而非追求平台铺量。
