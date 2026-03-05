# AgentClaw vs OpenClaw 核心能力对比

 对比时间：2026-03-05
核心评估维度：**给目标就能自己干活、自己验收**

> 本文基于 **OpenClaw** 和 **AgentClaw** GitHub 仓库源码实际代码核查
>
> - AgentClaw：https://github.com/vorojar/AgentClaw
> - OpenClaw：https://github.com/openclaw/openclaw

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

## 六、Token 消耗效率（架构层面分析）

> ⚠️ 以下为架构设计层面的定性分析，非同一任务实测数据（两个项目未做 A/B benchmark）

### 6.1 每轮对话的固定开销

| 开销项 | OpenClaw | AgentClaw | 差异 |
|---|---|---|---|
| **System Prompt** | 每轮全量发送，无缓存优化 | 固定前缀 + Claude `cache_control` / Gemini `cachedContent` | AgentClaw 缓存命中后输入 token 成本降 ~90% |
| **Skill 指令注入** | 架构未明确，skill 加载方式不详 | 按需加载：仅在 LLM 调用 `use_skill` 时注入 1 个 skill (~200 tok)，不用时 0 开销 | AgentClaw 省 ~2400 tok/轮（vs 全量注入 ~2600 tok） |
| **工具定义** | 工具数量多（21 IM + 设备工具），定义体积更大 | 核心 6 + 条件 6，总量精简 | AgentClaw 工具定义 token 更少 |

### 6.2 长对话的 token 膨胀控制

| 机制 | OpenClaw | AgentClaw | 判定 |
|---|---|---|---|
| **上下文压缩** | `/compact` 手动命令，用户不触发则持续膨胀 | 超 20 轮自动 LLM 摘要压缩 | **AgentClaw 胜** |
| **进度追踪防跑偏** | 无 | todo.md 写在上下文末尾，LLM 始终能看到目标 | **AgentClaw 胜**（减少纠正轮次） |
| **记忆召回精度** | 6 种 embedding + LanceDB，召回更精准 → 减少冗余上下文 | BM25 + 向量 + MMR，本地 embedding 精度较低 | **OpenClaw 胜** |

### 6.3 Thinking Token 消耗

| 机制 | OpenClaw | AgentClaw |
|---|---|---|
| **Thinking 级别** | 六档可调（off → xhigh） | 无分级，跟随模型默认 |
| **影响** | high/xhigh 模式下思考 token 可达回复的 2-5 倍 | 无额外思考 token 开销 |
| **判定** | 灵活但高档位极费 token | 省 token 但牺牲了可控性 |

### 6.4 综合估算（假设同一个 10 轮任务，Claude Sonnet）

| 环节 | OpenClaw 估算 | AgentClaw 估算 | 说明 |
|---|---|---|---|
| System Prompt（10 轮） | 10 × ~2000 = **20,000 tok** | 1 × 2000 + 9 × ~200 = **3,800 tok** | AgentClaw KV-Cache 命中后只计增量 |
| Skill 指令 | 不确定 | 按需 1 次 ~200 tok = **200 tok** | 仅在需要时加载 |
| 工具定义（10 轮） | 10 × ~3000 = **30,000 tok** | 10 × ~1500 = **15,000 tok** | 工具数量差异 + 缓存 |
| Thinking（medium 档） | 10 × ~500 = **5,000 tok** | 0 | OpenClaw 独有开销 |
| **输入 token 小计** | **~55,000 tok** | **~19,000 tok** | **AgentClaw 约为 1/3** |

> 以上为粗略估算，实际取决于模型、任务复杂度、对话长度。核心结论：**AgentClaw 的 KV-Cache 优化 + Skill 按需加载 + 自动压缩三板斧，在 token 效率上有结构性优势。**

---

## 七、项目规模对比

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
| **项目启动** | 2026-02-20 | 2025-11-24 |  |

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
