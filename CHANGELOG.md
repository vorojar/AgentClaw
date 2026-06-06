# 更新日志

## [1.5.40] - 2026-05-25

### Added
- **Agent memory arXiv 论文草稿**：新增 `docs/papers/` 论文区和 `Memory as a Control System for Production AI Agents` arXiv 源包，包含 LaTeX 主稿、BibTeX、投稿 metadata 草稿和公开站点入口，把 Active Memory、分层记忆、telemetry、治理和 trace replay 整理成可投稿的工程论文。

### Fixed
- **飞书 Wiki 全文 Markdown 交付**：`web_fetch` 对 Feishu/Lark 子域名跳过 Jina 目录页，使用 Playwright 抽取虚拟滚动正文；全文 overflow 在用户要求 Markdown 时自动发送 `.md`，并收窄登录墙关键词，避免正文里的“登录后可查看”误触发拦截。
- **新闻简报防过度收口**：AI 新闻简报完成策略至少需要 3 个高置信候选才会接管最终合成，并解析新闻 URL 中的日期；最终答复出口也会过滤聚合站、社媒、低质量 SEO 站和过期链接，避免单一来源或过期新闻被包装成“今日简报”。
- **恢复建议误报修正**：最终已成功响应或已发送可交付文件的 trace 不再因为中途工具限流/可恢复错误生成 branch recovery 建议，避免成功任务在 UI 上被误标成失败路径。
- **任务路由边界收窄**：表格化完成策略只覆盖网站/SEO/安全/响应头等技术检查，不再把竞品和产品表格调研压成固定网站检查模板；“继续生成文件类产物”也不再被误判成纯文本追问。
- **RSS 日报正文清理**：Reddit/RSS 自动完成报告会过滤内部工具限流提示，保留用户可读的日报内容和交付文件。

## [1.5.39] - 2026-05-23

### Added
- **会话树第一阶段原语**：对话轮次新增 `parentId`、`branchId` 和 conversation active leaf 持久化，`getHistory()` 在树形会话中只回放当前 active branch，同时保留旧线性会话兼容读取；新增 session tree 读取和 active leaf 切换 API，为后续“回到某一步重新走另一条路径”的智能分支能力打底。
- **失败路径分支恢复建议**：Agent trace 遇到工具错误、循环错误或 LLM 流错误时会持久化 `branchRecovery`，记录可重新分支的用户轮次、失败原因和失败工具；Gateway 新增 recovery suggestions 与 recover branch API，支持把失败用户轮次替换为新的同级分支重新执行，而不是只暴露一条失败记录。
- **自动恢复与恢复 UI**：新增 auto recover branch API，自动从失败用户轮次的父节点创建替换分支，并在恢复运行中禁用刚失败的工具；Chat 页面会展示可恢复失败路径，支持一键自动恢复或编辑草稿后恢复，恢复成功后旧失败建议会从当前 active branch 消失。

### Fixed
- **AI 新闻简报搜索闭环**：新闻简报在首轮搜索已拿到足够候选来源时会由完成策略直接生成结构化中文简报，并过滤 YouTube/Reddit/低质量博客等来源，避免模型继续批量 `web_fetch` 撞工具限流后把 raw snippets 或限流文案混入最终回答。
- **旧库会话树迁移启动顺序**：会话树索引延后到 `parent_id` 列迁移之后创建，避免已有 SQLite 数据库启动 gateway 时因旧 `turns` 表缺列失败。

## [1.5.38] - 2026-05-19

### Fixed
- **架构说明组件名修正**：移除文档中不存在的 `Planner`/`SimplePlanner` 表述，改为真实存在的 `TaskManager`，避免能力评估和架构说明误判规划能力边界。
- **通用表格化检查任务收口**：表格化检查/分析请求会进入受限证据预算，拿到页面、搜索结果、响应头或错误状态等最小证据后直接生成 Markdown 证据表，避免按领域穷举、过度抓取或退化为不可执行 XML 工具标记。
- **定时新闻/RSS 任务收口**：AI 新闻简报在搜索和抓取证据足够后会直接生成带来源的中文简报；Reddit/RSS 定时任务在 RSS 被 403 或已保存抓取报告后会直接发送并完成，避免继续输出不可执行 XML 工具标记。
- **Agent Loop 完成策略解耦**：将新闻简报、Reddit/RSS 日报、表格化证据分析的确定性完成逻辑抽出为 `completion-policies` 策略层，`agent-loop` 只负责循环状态机和副作用执行，避免继续按任务形态堆补丁。

## [1.5.37] - 2026-05-17

### Fixed
- **X/Twitter 长文全文抓取交付**：`web_fetch` 会将 `x.com/.../article/{id}` 规范化为可读的 `status/{id}` 抓取路径，拦截 X 错误/登录页，且用户明确要求“全文/不要截断”时会自动发送 overflow 原文文件；即使 `save_as` 已保存但模型漏掉 `auto_send`，agent loop 也会补发文件，避免只读 observation 预览后退化为概要。
- **天气查询事实充足度误判**：天气工具事实提示不再把月度气候/历史片段当成明日预报的充足事实，避免过早拦截后续 `web_fetch` 导致只能回答“精确预报未拿到”。
- **Reddit/RSS 日报伪工具标记恢复**：当模型在 RSS 日报交付阶段把 `file_write`/`send_file` 输出成不可执行 XML 文本时，agent loop 会继续要求结构化工具调用完成文件写入和发送，而不是直接降级为阶段性总结。
- **中文书稿 Markdown 粗体渲染修复**：统一修正书稿中 `**粗体**正文`、`**粗体**\`code\`` 等紧贴写法，在粗体闭合标记后补空格，避免 VitePress/Markdown 渲染时把星号原样显示。

## [1.5.36] - 2026-05-16

### Changed
- **中文书稿前言作者口吻修正**：重写《为什么现在可以从零造 Agent》开头，移除“公司公开介绍/小程序信息”式背书和运营数据堆叠，改为更自然的第一人称作者自述。
- **中文书稿入口叙事增强**：调整书籍首页导读，弱化栏目说明感，明确它是面向中文系统学习者的工程书，并补充 AgentClaw 开源仓库链接。
- **中文书稿首页吸引力强化**：重写 `book/index` 开头和读者承诺，用 Agent 失控的具体场景建立阅读钩子，并明确“Agent engineering 是控制系统工程”的核心判断。

### Removed
- **移除公开书区内部大纲稿**：删除 `book/outline` 公开入口和文件，避免“作者署名建议、封面文案、出版修改原则、写作时核对用”等内部交稿包痕迹出现在读者可见页面。

## [1.5.35] - 2026-05-16

### Fixed
- **移动端排版过窄**：放宽首页 hero、按钮、feature 卡片和文章正文的移动端宽度约束，将过度保守的 280-310px/`100vw - 120px` 收口改为正常 20-24px 级别边距，同时保留横向溢出保护，并取消正文 `break-all` 造成的英文切词。

## [1.5.34] - 2026-05-16

### Fixed
- **自定义域名资源路径**：VitePress 默认 `base` 从 `/AgentClaw/` 改为 `/`，匹配 `agentengineering.bibidu.com` 根域名部署，避免首页 HTML 仍引用 `/AgentClaw/assets/...` 导致 CSS/JS/logo 和导航链接失效。
- **GitHub Pages 自定义域名声明**：发布产物新增 `CNAME`，将 `agentengineering.bibidu.com` 作为文档站 canonical domain。

## [1.5.33] - 2026-05-16

### Changed
- **技术站品牌标识语义化**：将临时 `DJ` monogram 替换为 `AE` 标识，直接对应 Agent Engineering 刊物定位，避免读者误解或需要牵强解释。

## [1.5.32] - 2026-05-16

### Changed
- **技术站视觉细节收口**：修正首页 VitePress hero logo 图像边缘露出白底的问题，SVG 底色向外出血并在主题 CSS 中裁切圆角，避免 `VPImage image-src` 四周出现白边。
- **旗舰文章插图克制化**：不新增装饰性图片，仅为五篇旗舰工程文章现有 Mermaid 机制图补充 figure caption，使每张图都承担机制解释、验收边界或工程原则表达。

## [1.5.31] - 2026-05-16

### Changed
- **技术站定位改为 Agent Engineering 刊物**：站点标题、首页、导航、侧边栏、footer 和栏目入口从 AgentClaw 产品/文档站收敛为面向全球 agent 工程师和团队的工程刊物；AgentClaw 仅作为 production workbench、case study 和真实 trace 证据来源出现。
- **栏目体系刊物化**：导航改为 Blog、Series、Field Guides、Systems、Book；Guide 改为 Field Guides，Compare 改为 Systems Analysis，系列首页改为 production agent engineering curriculum。
- **文章主语去产品化**：旗舰文章、Agent Series、Field Guides 和 Systems Analysis 进一步弱化产品中心表达，强调通用 failure mode、机制、边界、验收证据和可迁移原则。

## [1.5.30] - 2026-05-16

### Added
- **技术站旗舰文章补齐**：新增 trace replay、last-mile delivery、skill runtime contract 三篇工程旗舰文，把真实 trace 回放、最终产物交付门禁和 skill 快路径/硬验收沉淀为公开可复用方法论。
- **中文书稿独立 Book 区**：新增 `docs/book/`，将《造一个真能用的 AI Agent》完整书稿、目录、附录和架构图作为独立主导航发布，不再混入 Blog/Guide/Compare 信息架构。

### Changed
- **公开文章按顶级工程博客标准重写**：重写 context compression、Agent Series 十篇文章、Guide、Roadmap、Engineering Lessons 和 Compare 页面，统一为失败场景、核心 thesis、机制、边界、验收证据和可迁移原则的结构。
- **技术站导航升级**：首页和 VitePress 导航新增 Book 入口，并把 Blog 推荐位调整为 memory、trace replay、delivery、skill contract、context compression 等高密度工程文章。
- **OpenClaw 对比降营销化**：将旧版分数型对比改为定位型比较，明确方法论、时效边界和双方取舍，避免不可验证的“碾压式”表述。

## [1.5.29] - 2026-05-16

### Added
- **AgentClaw Engineering 技术站**：新增 VitePress 驱动的 GitHub Pages 文档/博客站，包含首页、工程博客、Building AI Agent Frameworks 系列、系统指南、竞品对比、全文搜索、品牌图标和自定义工程刊物视觉主题。
- **GitHub Pages 自动部署**：新增 `.github/workflows/pages.yml`，在 `master` 的文档、依赖或部署 workflow 变更后自动构建 `docs/.vitepress/dist` 并发布到 GitHub Pages。
- **文档站本地脚本**：新增 `docs:dev`、`docs:build`、`docs:preview`，并引入 VitePress/Vite 依赖，支持本地开发、静态构建和预览验收。

### Changed
- **公开文档信息架构重组**：将工程文章整理到 `docs/blog/`，系统文档整理到 `docs/guide/`，竞品对比整理到 `docs/compare/`；旧的 `building-ai-agents` 系列迁移到博客栏目并修复系列跳转坏链。
- **公开发布边界收敛**：VitePress 配置显式排除私有规划、审计任务、Python 缓存和本地书稿交付包，避免 GitHub Pages 意外发布不适合公开传播的材料。

### Removed
- **过期内部报告**：删除 `docs/AUDIT-FIX-REPORT.md` 和 `docs/vsopenclawtask.md`，避免一次性修复报告和任务清单混入正式技术站。

## [1.5.28] - 2026-05-15

### Added
- **Active Memory 前置召回与记忆治理**：长期记忆注入前新增 provider-backed 主动选择器，按当前用户请求只注入最相关记忆并记录 `active_memory` telemetry；记忆管理页和 API 新增编辑、废弃、合并能力，修正内容更新后向量不刷新的问题，避免旧/错/重复记忆继续污染真实会话。
- **记忆场景回放硬测试**：新增默认测试链会执行的 P0/P1 记忆场景回放，覆盖同一会话省略 PPTX 主题时的 Active Memory 精准召回，以及编辑重算 embedding、废弃隐藏、合并 canonical target 的真实治理闭环。
- **记忆自动治理闭环**：新增记忆有效性/污染率 telemetry 聚合和 `memory janitor`，每日 consolidate 会自动废弃已被使用数据证明会污染上下文的记忆；同时提供机器可读的 effectiveness/janitor API，避免靠 UI 调参手工维护记忆库。

### Fixed
- **MiMo 老会话工具历史 400**：当旧会话中历史 assistant 工具调用缺少 `reasoning_content` 时，OpenAI-compatible provider 会在发送给小米 MiMo 前移除这段不可回放的工具调用及对应 tool result，同时保留可见 assistant 文本，避免用户必须新开会话才能继续使用 Mimo。
- **PPTX 生成收尾跑偏**：普通 PPTX 任务重新暴露结构化 `claude_code` 工具，并禁止通过 `bash` 直接运行 Claude Code，避免模型绕路调用不存在的 `./tools/claude-code`、搜索验证脚本或在 deck 已生成后因 bash 限流撞到 `max_iterations_reached`。
- **PPTX 暗色偏好污染**：PPTX 视觉风格记忆现在只作为可选参考，不能覆盖本次用途；拉赞助/招商/商业合作类 PPTX 默认注入明亮、干净、商业提案风规则，避免长期记忆把所有 deck 都带成暗色。
- **PPTX 预览误当交付**：PPTX 任务只发送 PDF/PNG 预览时不再触发自动完成，必须继续到已验证 `.pptx` 被发送，避免“生成 ppt”最终只收到 PDF 预览。
- **PPTX 依赖安装和自造预览绕路**：PPTX skill 明确禁止任务内 `pip install`，agent-loop 会硬化 `claude_code` 委托提示；生成 `.pptx` 候选文件后，非官方 `verify_pptx.py --json` 的自定义 Bash 检查/LibreOffice 预览会被跳过，避免卡在依赖安装、手写预览和最终不发送 `.pptx`。
- **PPTX verified 后仍只发预览**：官方 `verify_pptx.py --json` 返回 `ok:true` 后，agent-loop 会自动发送会话目录内已验证 `.pptx`；PPTX 任务的最终文件累积只认 `.pptx`，并跳过 PNG/PDF/脚本等旁路文件，避免迭代上限兜底时把预览图或 `gen_pptx.py` 当最终交付。
- **PPTX 慢预检和 subagent 绕路**：PPTX 生成链路不再提示或执行 `python -c "import pptx"` 依赖预检，而是直接写脚本运行并只在真实 `ModuleNotFoundError` 时报告缺依赖；普通 PPTX 任务默认跳过 subagent 预览检查，最终回复也会收敛为已发送的 `.pptx` 链接，避免把脚本/预览当交付物暴露给用户。

## [1.5.27] - 2026-05-15

### Added
- **分层记忆聚合**：长期记忆新增 L2 scene aggregate 和 L3 persona aggregate，自动把高置信 L1 原子记忆聚合为场景记忆和稳定用户画像，并保留 `sourceMemoryIds/evidence` 可回溯链路。
- **记忆使用 telemetry**：新增 `memory_usage` 记录，Context 注入 L1/L2/L3 记忆时会记录 memoryId、conversationId、layer 和来源，后续可计算哪条记忆真正参与了决策。
- **记忆真实回归入口**：新增 `scripts/memory-layered-regression.mts`，覆盖冲突废弃、L2 场景聚合、L3 用户画像、分层召回注入和 telemetry 四条链路。
- **记忆版本对比评测**：新增 `scripts/memory-10-case-eval.mts`，用 10 个固定检查点对比旧版/当前版的冲突处理、分层聚合、证据链、prompt 注入、telemetry 和 offload 符号图。

### Changed
- **分层召回优先级**：长期记忆注入改为优先 L3 用户画像和 L2 场景记忆，再合并 identity、preference 和 query 相关 L1/legacy 记忆，降低碎片记忆直接污染 prompt 的概率。
- **记忆抽取触发策略**：后台记忆抽取从单一首轮/固定周期改为 warmup 轮次、固定周期和 idle 触发组合，并按 agent memory namespace 写入。

### Fixed
- **偏好冲突污染**：同场景 preference/fact 出现“不要/改成/以后”等变更信号时，新 L1 记忆会 `supersedes` 旧记忆，并把旧记忆标记为 `deprecated`，避免新旧偏好同时注入。
- **废弃记忆召回**：Memory search 和 prompt 格式化会跳过 `deprecated/superseded` 记忆，防止已被替代的内容继续影响 Agent。
- **Web typecheck 旧债**：补齐 Vite/Babel/Web Speech 类型声明，修复知识源 union narrowing、ReactMarkdown components、i18n count 类型和任务 quick-add 签名，使全仓 `pnpm run typecheck` 恢复通过。

## [1.5.26] - 2026-05-14

### Added
- **Agent 记忆 L1 provenance**：后台记忆抽取现在把 conversation/trace 来源、source turn/step、sceneName、confidence 和 L1 layer 写入 memory metadata，避免长期记忆成为无来源事实池，并为后续受控 recall 和 scene/persona 铺路。
- **工具输出 offload active hint**：大工具输出进入 Observation Store 后，agent loop 会在下一轮注入 `active_tool_offload` 摘要，并在工具结果 metadata 中记录 `resultRef`、`nodeId`、`taskId` 和 `replaceabilityScore`，让长任务少读 overflow、必要时再定向回读原始观察。

### Changed
- **PPTX 生成任务工具路由收敛**：普通 PPTX 生成首轮不再暴露 `recall/glob/grep/file_read/web_search/web_fetch/claude_code`，避免模型把“做 PPTX”扩散成项目研究或外部委托；只有用户明确要求基于仓库/代码/文件时才保留项目读取工具。
- **长期记忆注入受控化**：系统 prompt 中的长期记忆现在会过滤低置信 L1 记忆，并为注入项附带 `src/trace/conf` 来源标记；legacy 记忆只保留身份、偏好和经验类，降低无来源事实污染。
- **PPTX 技能收敛为极简硬验收流程**：`pptx` skill 移除大段内联 `python-pptx` 生成示例，新增短指令旧会话处理、禁止验收失败发送、禁止写入用户 home 等硬规则，并提供 `skills/pptx/scripts/verify_pptx.py` 作为统一 PPTX 检查和预览报告入口。
- **PPTX 技能升级为设计先行流程**：`pptx` skill 从 `python-pptx` API 片段升级为 HTML-first / 可编辑约束 / 品牌资产 / two-slide showcase / anti-slop / 预览验收的生产流程，并保留 `python-pptx` 作为快速编辑和朴素内部门槛路径。

### Fixed
- **PPTX verifier Windows 输出解码**：LibreOffice 预览渲染输出按 UTF-8 replacement 解码，避免中文路径/本机编码导致 verifier 已成功但 stderr 打出 `UnicodeDecodeError`。

## [1.5.25] - 2026-05-13

### Fixed
- **MiMo 工具历史 400 Param Incorrect**：OpenAI-compatible provider 现在会保存并回传 `reasoning_content`，满足小米 MiMo 在 thinking mode 下对工具调用历史的 API 要求；agent loop 遇到 LLM stream 错误时也会在 trace/UI 暴露真实 provider 错误，不再误报“最大迭代次数”。
- **微信公众号 web_fetch 验证页误发**：`web_fetch` 对 `mp.weixin.qq.com` 改为本机直连提取 `#js_content`，不再优先走 Jina Reader；Jina 或最终内容出现“当前环境异常/完成验证后即可继续访问/CAPTCHA”时会硬拦截保存和 `auto_send`，避免把微信验证页当正文发送。

## [1.5.24] - 2026-05-09

### Added
- **微信公众号发布统一 CLI 契约**：`wechat-publish` 新增 `wechat_publish.py`，提供 `capabilities/inspect/preview/publish` 四个子命令和 `success/code/message/data` JSON envelope；`SKILL.md` 收敛为只走统一入口，避免 Agent 继续拆步骤或解析旧脚本行文本。
- **微信公众号发布真实入口回归**：新增 `scripts/wechat-publish-skill-regression.mts`，从真实 Agent session 验证 `use_skill`、统一 CLI、dry-run 产物、无旧脚本、无直接微信 API 和无参数缩写漂移；根测试命令纳入对应 evaluator 单测。

### Changed
- **微信公众号发布默认能力面收敛**：`capabilities.commands` 和 `canonical_args` 默认只暴露 `capabilities/inspect/publish`，`preview` 移到 `explicit_preview`，避免用户已要求发布时 Agent 先跑预览并因漏 `--out-dir` 产生无意义错误。
- **微信公众号发布 CLI 容错收敛**：`wechat_publish.py publish` 缺省 `--out-dir` 时自动使用 Markdown 同目录的 `wechat-output`，避免漏参触发重试雪崩；`capabilities.canonical_args` 不再把 `--theme` 作为默认发布参数暴露，减少 Agent 绕过 `auto` 主题选择的概率。
- **微信公众号书籍内容自动选题收敛**：`wechat_publish.py` 的 `auto` 主题识别新增书籍语境规则，能把“这本书/本书/全书/书中/一本书”等书评和书籍提炼内容自动选为 `minimal`；`wechat-publish` 技能说明同步禁止默认场景手写 `--theme`，并明确 `publish` 子命令不可使用 `--draft`。
- **微信公众号主题自动选择**：`wechat_publish.py` 的默认主题改为 `auto`，根据正文确定性选择 `minimal`/`sage`/`tech-modern`，并在 JSON 与 `manifest.json` 写入 `theme_selection` 审计信息；读书笔记、书摘和阅读心得不再因用户只说“发送到公众号”而误用科技风。
- **微信公众号发布体验增强**：`wechat_publish.py preview` 现在输出可直接打开的完整 HTML 页面；`publish` 写入 `manifest.json` 审计清单；`capabilities` 暴露 canonical 参数列表，并关闭 argparse 参数缩写，避免 `--out` 被隐式当成 `--out-dir`。

### Fixed
- **微信公众号发布 inspect 后漂移**：公众号发布任务在 `wechat_publish.py inspect` 返回 `INSPECT_READY` 后进入运行时状态机，下一轮只暴露 `bash` 并只允许锚定的 `publish` 命令，防止模型继续搜索、重写文章、调用预览或寻找不存在的 skill 路径。
- **微信公众号发布前置 bash 漂移**：公众号发布任务在没有 Markdown 源文前不再暴露 `bash`；`file_write` 成功写入 `.md` 后下一轮只暴露 CLI 所需 `bash`，动态提示下一条 inspect/publish 命令，并强制 `capabilities/inspect/publish` 带 `--json`，确保运行时能读取 `manifest_json` 和主题审计。
- **微信公众号发布参数漂移**：当模型在 `inspect` 通过后调用 `publish` 却漏掉 Markdown 位置参数时，运行时会用刚检查过的 canonical Markdown 路径补齐命令，避免一次 CLI 报错和重复发布尝试。
- **微信公众号技能重复加载**：`wechat-publish` 加载成功后，后续轮次会从工具面移除 `use_skill`，避免模型在研究和发布之间重复加载同一个技能。
- **微信公众号发布预览/错误子命令漂移**：公众号发布任务运行时只允许 `wechat_publish.py capabilities|inspect|publish`，会跳过 `preview/convert/help` 和 `publish --draft`，避免模型在用户已要求发布时停在预览或试不存在的转换命令。
- **微信公众号发布绕过统一 CLI**：公众号发布任务新增运行时硬边界，`bash` 只能执行锚定仓库根目录的 `wechat_publish.py`，`file_write` 只能写 Markdown 源文，阻止 Agent 手写 HTML/Node 转换或查找不存在的 `C:/Users/voroj/skills` 路径。
- **微信公众号发布真实路径漂移**：`wechat-publish` 技能入口固定为 `cd D:/mycode/agentclaw && python skills/wechat-publish/scripts/wechat_publish.py ...`，防止 Agent 在 `C:/Users/voroj` 或下载目录执行相对路径后找不到统一 CLI；真实回归 evaluator 同步拦截未锚定仓库根目录的调用。
- **微信公众号正文标题重复**：`wechat_publish.py` 在预览和发布正文中移除 Markdown 第一个 H1，保留草稿 metadata 标题和封面标题，避免公众号后台显示标题后正文再次出现同名大标题。

## [1.5.23] - 2026-05-08

### Fixed
- **伪工具 XML 流式外泄**：agent loop 不再把未经最终校验的模型文本直接作为 `response_chunk` 推给 WebSocket/IM 渠道；模型在合成阶段输出 `<tool_call>` / `<function=>` 等不可执行标记时，只释放系统兜底后的用户可见文本。
- **Skill 能力身份参数漂移**：`skill_manage` 不再把显示名 `name` 当作 `skillId`，`write_file` 不再接受隐藏 `fileContent`，`skill_curator` 的 `reason` 参数补齐到 schema；线上 skill 能力回归也改为只认 canonical `skillId`。
- **线上能力回归日期与工具漂移**：`live-agent-eval` 不再硬编码历史日期，也不再把已不存在的 `execute_code` 当作实时检索工具加分；脚本守卫测试纳入根测试命令。
- **新闻任务提示日期固化**：AI 新闻任务 runtime hint 不再写死 `2026-05-03`，改为每次 agent loop 运行时按当前本地日期注入。
- **工具预算硬停止不彻底**：全局工具调用上限触发后现在会立即进入强制合成模式，并在下一轮清空工具定义，避免模型收到“不要再调工具”的自然语言错误后继续尝试工具。
- **子代理预算绕过**：`SimpleSubAgentManager` 现在把父级共享 `IterationBudget` 传给子 agent loop，防止并行子代理绕开父任务预算继续执行。
- **CLI 当前时间固化**：交互式 CLI 的 system prompt 改为保留 `{{datetime}}` / `{{timezone}}` 模板变量，由 core 在每次 agent loop 创建时动态解析。
- **工具提示参数漂移**：`schedule` 空列表 hint 和缺参错误统一使用 canonical `prompt` 参数；`subagent` explore 白名单移除不存在的 `shell` 工具名。
- **工具 ID 与参数唯一事实源漂移**：preset hook 改为监听真实 `bash` 工具名，eval 示例同步使用 `bash`；`schedule` 创建任务不再接受隐藏的 `message` 参数，操作参数也只接受 canonical `op`，避免 schema、提示词和执行层继续分叉。
- **系统时间注入过期**：`system-prompt.md` 中的 `{{datetime}}` / `{{timezone}}` 不再在 gateway 启动时固化，而是在每次 agent loop 创建时解析，避免服务运行多天后“明天/今天”推算使用旧日期。
- **grep 后续读取误导**：`file_read` 新增 `line` / `context_lines` 行号上下文读取，`grep` hint 改为引导按匹配行读取，避免模型把 grep 行号当字符 offset 反复读到无关片段并耗尽工具预算。

## [1.5.22] - 2026-05-06

### Fixed
- **MiMo 1M 上下文未生效**：OpenAI-compatible 自定义 provider 现在会按默认模型自动登记模型元数据；`mimo-v2.5-pro` 和小米 MiMo API 地址自动识别为 1,048,576 context window，避免被通用 128K 默认值提前触发上下文压缩。

## [1.5.21] - 2026-05-05

### Added
- **一键安装脚本**：新增 `scripts/install.sh`，支持 Linux、macOS 和 Termux 交互式安装，自动检查基础依赖、配置模型 Provider/API Key、构建并启动服务，让默认路径直接进入 Web 对话。

### Changed
- **默认部署瘦身**：Docker 默认只启动 AgentClaw 核心服务，不再自动启动 SearXNG/Redis，本地搜索改为 `search` profile 和 Settings 配置；默认镜像不再安装 Chromium/CJK 字体，`browser_cdp` 需要显式设置 `AGENTCLAW_ENABLE_BROWSER_CDP=true` 才注册。

### Removed
- **默认 Deno 运行时**：移除 Docker 镜像中的 Deno 安装和启动时 Deno 探测；当前运行路径没有真实依赖，避免默认安装额外下载未使用的运行时。

## [1.5.20] - 2026-05-03

### Added
- **Trace 质量评分器**：新增 `evaluateTraceQuality`，可对真实 trace 的 LLM 轮次、工具调用、输入 token、耗时、cache 命中、overflow 全文读回和 Reddit 计数字段伪造进行确定性评分；新增 `scripts/trace-quality-regression.mts` 作为线上近似闭环回归入口。
- **Observation Store 回归指标**：`evaluateTraceQuality` 新增 observation 创建数、读取数、全文读回数、原始字符数、提示字符数、节省字符数和节省率，并提供最低创建数、最低节省率、最大全文读回数阈值，防止 P0 Observation Store 退化成上下文全文回灌。
- **微信公众号草稿发布脚本**：`wechat-publish` 新增 `publish_article.py` 一键发布入口和 `publish_draft.py` 草稿脚本，把封面生成、Markdown 转换、草稿 JSON 组装、封面上传和创建草稿收敛到单一命令，并支持 dry-run 回归验证。
- **纯文本字幕极速入口**：`bilingual-subtitle` 新增 `--txt-only` 和 `--beam-size`，URL 字幕任务可直接生成无时间戳 `.txt`，最快模板显式使用 `tiny + beam_size=1`，不再先生成 SRT 再用 shell 清洗。

### Changed
- **overflow 文件读取策略**：`file_read` 对 `overflow_*.txt` 默认只返回短预览，必须通过 `offset` / `length` 做定向范围读取，避免 `execute_code` 大输出被全文读回上下文。
- **JSON 抓取结果保持机器可解析**：`web_fetch` 对 `application/json` 不再追加人类 hint，避免 `execute_code` 中 `JSON.parse(await web_fetch(...))` 因尾部提示文本失败。
- **send_file 路径审计**：发送结果现在记录 `originalPath`、`effectivePath` 和 `relocated`，并且只有文件确实从 workDir 外复制进来时才标记 relocated。
- **shell 文件发送边界**：`shell` 只有显式 `auto_send=true` 时才发送检测到的文件，避免命令参数里的中间视频、SRT 等路径被误发给用户。
- **X 长视频纯文本字幕极速路径**：`bilingual-subtitle --txt-only` 的 URL 模式改为下载视频容器后直接交给 faster-whisper demux 转写；真实 83 分钟 X 视频回归从 10 分钟超时收敛到 8分43秒，只发送最终 `.txt`。
- **P1 任务工具路由**：新闻简报只暴露 `web_search`/`web_fetch`/输出工具，Reddit/RSS 日报只暴露 `rss_top`/文件输出工具，并按任务类型收紧工具预算；真实回归中 AI 新闻任务稳定在约 11.5K input token，Reddit 日报收敛为 1 次 `rss_top` + 文件输出链路。
- **P2 工具输出瘦身**：`web_search` 结果硬夹到 5 条，`web_fetch` 默认返回带来源 URL 的短事实卡并保留 `save_as` 完整保存路径，`rss_top` 对相同 feed/topN 做短期缓存；真实 AI 新闻回归约 `11.3K input token / 35.1s`，不再因超限搜索多跑一轮。

### Fixed
- **URL 字幕音频下载失败**：`bilingual-subtitle` 现在会定位 `ffmpeg/ffprobe` 并显式传给 `yt-dlp`，无 CC 字幕时只下载音频转写，不再因为 Python 子进程 PATH 缺失退化成手写下载完整视频。
- **Git Bash ffmpeg 路径识别**：`bilingual-subtitle` 支持 `/e/...` MSYS 路径转换，并优先选择同时包含 `ffmpeg` 和 `ffprobe` 的目录，避免只找到 `ffmpeg.exe` 但缺 `ffprobe.exe` 时失败。
- **字幕输出目录缺失**：纯文本/SRT 写出前会自动创建父目录，避免 gateway 会话工作目录尚未存在时，长视频转写完成后因写文件失败重跑。
- **微信公众号发布流程漂移**：`wechat-publish` 技能改为只走发布脚本，移除手写 token/curl 流程，避免模型绕过反代、读取历史临时脚本或重复创建草稿；`md2wx.py` 支持 UTF-8 BOM Markdown，防止 Windows 文件标题解析成文件名。
- **定时任务新闻 trace 长循环**：取消 `execute_code nudge` 对 `web_search/web_fetch` 的硬拦截，避免模型在轻量并行搜索和批量脚本之间来回反弹；同时限制包含 `web_search/web_fetch` 的 `execute_code` 网络批处理最多 3 次，超过后强制综合已有材料输出。
- **Web 研究组合预算**：新增 `web_search`/`web_fetch` 总调用上限和 overflow 文件读取上限，防止定时任务从 `execute_code` 长循环退化成搜索、抓取、读片段的混合长循环。
- **批量新闻任务 token 浪费回归**：用生产 trace 固化失败样本，防止新闻/RSS 类任务再次出现 5 轮 LLM、60K+ input token、overflow 全文回灌和 RSS 缺失点赞/评论却填 0 的问题。
- **最终回复 XML 外泄**：修复模型在合成阶段输出不可执行工具标记时，`response_complete` 仍发送旧 content block 的问题；新闻简报会在最终答案缺 URL 时从真实工具结果补来源链接。

## [1.5.19] - 2026-05-02

### Added
- **Skill P0 自进化闭环**：新增 `skill_manage` 和 `skill_curator` 内置工具，支持技能创建、唯一匹配 patch、支持文件写入、删除确认、归档、备份、dry-run 分析和状态查询。新增 `skill_usage` / `skill_changes` SQLite 表，记录技能使用成功率、失败原因、变更动作、hash 和原因，`use_skill` 会自动写入使用 telemetry。Gateway 新增 `/api/skills/usage`、`/api/skills/changes`、`/api/skills/curate`，让前端和外部流程可直接读取与触发 curator。
- **Evolution Ledger 进化账本**：新增 `evolution_runs` / `evolution_events` SQLite 表和 `/api/evolution/runs`、`/api/evolution/events` 查询端点，把能力变更从普通会话 trace 中独立出来审计。`skill_changes` 会自动关联 evolution run，并记录触发 trace、conversation、before/after hash、change event 和验证结果，支持按目标、状态、trace 反查，从“为什么改”追到“怎么改、是否变强、如何回滚”。
- **Settings 进化日志入口**：Settings 新增“进化日志”页签，展示 evolution run 摘要、目标/状态过滤、单次进化详情和 event 时间线，补齐从账本 API 到 UI 回看的闭环。

### Changed
- **Skills 工具组扩展**：`skills=true` 现在同时加载 `use_skill`、`skill_manage`、`skill_curator`，并把 `skillsDir`、归档目录、备份目录和 telemetry 回调注入工具执行上下文，形成可持续优化的程序性记忆闭环。
- **线上能力回归增强**：`scripts/skill-online-capability.mts` 记录每个真实线上 run 的 traceId，并在验证 skill 进化时写入 `baseline_eval` / `online_regression` 事件。`SimpleOrchestrator` 新增默认开启的 `enableBackgroundLearning` 开关，回归脚本可关闭后台学习，避免测试结束时后台记忆抽取干扰验收结果。

### Fixed
- **Trace max_tokens 诊断可读性**：Trace 时间线现在显示 LLM `stopReason`、错误和文本详情；agent-loop 遇到 `max_tokens` 且没有产生工具调用/回复时，会把 trace 标记为 `llm_max_tokens_truncated`，避免空白回复被误判为正常完成。
- **Codex CLI Windows Store 路径解析**：`claude_code` 降级到 Codex CLI 时会把 `where codex` 返回的 AppData 转接路径解析为真实 LocalCache 可执行文件，避免 Node `spawn()` 对转接路径报 `ENOENT`，保证未安装 Claude Code CLI 时仍可使用 Codex 委托。
- **外部委托工具不可用空转**：`claude_code` 先快速探测 Claude Code CLI，不可用时自动降级到 Codex CLI；两者都不可用时返回终端失败并让 agent-loop 立即收敛。agent-loop 新增连续 `max_tokens` 无工具调用熔断，避免 687 秒级无副作用空转；overflow 临时目录改为真正懒创建，短错误结果不再触碰文件系统。
- **线上 Skill 能力回归修复**：新增 `scripts/skill-online-capability.mts` 真实线上回归脚本，覆盖 create、use、patch 进化、curator dry-run、archive+backup 五条能力链路。修复两处线上暴露的问题：工具失败去重 key 改为“参数前缀 + 完整参数 hash”，避免纠正后的长参数被误杀；`skill_manage create` 以 `skillId` 作为唯一身份源，自动归一 SKILL.md frontmatter `name`，确保创建后可通过 `use_skill(skillId)` 加载。

## [1.5.18] - 2026-04-30

### 新功能
- **Task DAG（任务依赖图）**：任务支持 `blocked_by` 依赖关系，自动拓扑排序执行。新建 `task_dependencies` 联表存储依赖边，含循环检测（BFS）、`blocked→queued` 自动转换、任务完成时触发下游解锁。API 新增 `GET/POST/DELETE /api/tasks/:id/dependencies` 端点
- **Hook 编码修复**：所有 `.claude/hooks/*.ps1` 文件添加 UTF-8 BOM，修复 PowerShell 5.1 读取 UTF-8 中文字符时的 `TerminatorExpectedAtEndOfString` 解析错误

## [1.5.17] - 2026-04-29

### 优化
- **overflow 提示优化**：工具输出超长时不再提示 agent 用 file_read/grep 读取完整文件，改为"预览通常够用"。天气查询测试工具调用从 6 个降到 1 个，token 消耗从 134K 降到 28K（-79%），耗时从 63s 降到 7.7s（-88%）
- **grep 工具增强**：新增 `exclude_dir` 参数，默认排除 node_modules/dist/.git/target/binaries 等目录。解决搜索大目录时结果混入二进制文件、agent 转向 bash 调用失败的问题

### 修复
- **工具被禁用时的 agent 行为优化**：glob 等工具被 config deny 后，错误消息从 "blocked by a before hook" 改为明确告知 "disabled by configuration. Do NOT retry"。修前 agent 重试 3 次触发 max_iterations（149s），修后第 1 次被拒即改用替代方案
- **依赖漏洞修复**：通过 pnpm overrides 修复 45 个安全漏洞（2 critical → 0），涉及 protobufjs/rollup/dompurify/fastify/axios/postcss 等 14 个传递依赖。xlsx（2 high）无补丁可用，vite 7（3 high，仅 dev）受 Node.js 版本限制暂未覆盖
- **README 增强**：添加 MIT License + GitHub Stars badge；新增常见问题（FAQ）章节覆盖 API key 配置、Docker 部署、模型选择、工具禁用重试、上下文压缩等 5 个问题

## [1.5.16] - 2026-04-13

### 优化
- **execute_code nudge 机制**：agent-loop 检测 web_search/web_fetch 累计 ≥3 次时智能干预。已有足够数据时引导直接输出（禁止 file_read/grep overflow），否则引导用 execute_code 批量化。军事新闻测试 110K→26K（-76%）、10 轮→3 轮

## [1.5.15] - 2026-04-12

### 新功能
- **Anthropic prompt cache 三点标记**：系统提示词 + 最后一个工具定义 + 对话历史倒数第二条消息注入 `cache_control: ephemeral`，最大化 Claude API 缓存命中率
- **yt-dlp YouTube cookies 自动化**：skill 内置 cookies 路径检查指引 + 时间范围下载模板，新会话无需用户重新提供 cookies

### 移除
- **skill_manage 工具**：实测 agent 改坏 skill 的风险远大于收益（135K token 浪费 + 错误 patch），skill 维护回归人工控制

### 修复
- **PDF/二进制下载损坏根治**：系统提示词明确禁止 web_fetch 下载二进制文件，强制 `bash curl` 下载 + `pdftotext` 提取。修复前 PDF 任务 52 次调用/182K tok/277s，修复后 4 次/42K tok/32s
- **execute_code 误写 Python 根治**：工具描述强化 "JavaScript ONLY (NOT Python)"，系统提示词明确 Python 必须走 bash
- **schedule op 参数空白容错**：LLM 输出含制表符/换行时自动 trim
- **grep 支持单文件路径**：传文件路径不再报 ENOTDIR
- **execute_code web_search 解析加固**：跳过 Direct answer/Infobox 前缀，防止 URL 错位
- **claude_code stderr 64KB 上限**：防止极端错误输出导致 OOM
- **file_write JSON/Python 语法检查**：写入后自动验证，Python hook Windows 用 `python` 而非 `python3`

## [1.5.14] - 2026-04-10

### 新功能
- **Eval 基准框架**：`npm run eval` 一键评估 agent 表现（20 个黄金测试用例），Gateway 路由 `POST /api/eval/run` 支持 API 调用
- **recall 工具（记忆主动检索）**：agent 可在对话中途主动搜索记忆库，支持关键词 + 语义 + 类型过滤，解决"记了但想不起来"的问题
- **失败自动学习**：每次对话结束后自动分析 trace 中的工具错误，LLM 提取操作教训存为 episodic 记忆，同类错误不重犯
- **复杂任务规划引导**：系统提示词新增结构化计划模板（5+ 步骤任务：列步骤 + 验证条件 + 失败回退）

### 优化
- **file_write 语法验证增强**：新增 JSON（JSON.parse）和 Python（py_compile）语法检查 hook，写入后自动验证

## [1.5.13] - 2026-04-10

### 新功能
- **AXI 工具输出优化**：web_search 改为 TOON 格式（带结果总数），glob/grep/web_fetch/schedule 增加下一步 hint 提示，引导 agent 高效串联工具调用
- **明确空状态**：glob 0 匹配、grep 0 命中、web_search 0 结果时返回明确信息（含搜索范围），区分"没结果"和"工具失败"
- **迭代式压缩摘要**：上下文多次压缩时增量更新前次摘要，而非从头重建，长对话关键信息保留率提升
- **Unicode braille 动画**：聊天页思考动画和侧边栏 spinner 替换为 unicode-animations braille 字符动画

### 修复
- **自动补发未 send_file 的文件**：LLM 偶尔跳过 send_file 直接贴本地路径，框架层兜底扫描回复文本自动补发
- **Skill description 增加反例**：15 个 skill 统一加"不用于"反例，路由准确率提升

## [1.5.12] - 2026-04-05

### 新功能
- **wechat-publish 技能**：Markdown 转微信公众号排版（100% 内联 CSS），3 个主题（tech-modern/minimal/sage），自动处理外链→脚注、中英文间距、代码高亮

### 修复
- **Skill 热更新支持新安装**：`fs.watch` 检测到新目录时自动加载 SKILL.md，git clone 安装的 skill 不再需要重启
- **use_skill 结果不再被 Overflow 截断**：skill 内容超 8K 时被转存文件导致 LLM 只看到 1500 字符预览，skill 执行不完整

### 优化
- **记忆提取改白名单模式**：从黑名单（禁止 X/Y/Z）改为白名单（只允许 4 类），default-deny 更稳健
- **上下文压缩结构化模板**：全量压缩从"3-5 bullet points"改为 7 段结构（用户请求/当前状态/关键决策/文件/错误修复/下一步/用户原话）

## [1.5.11] - 2026-03-31

### 优化
- **MicroCompact 渐进截断**：旧 tool_result 不再粗暴替换为占位符，改为保留前 200 字符 + 原始长度标记（阈值 800 字符），兼顾上下文节省与信息保留
- **记忆提取防新闻污染**：MemoryExtractor prompt 增加 6 条过滤规则，禁止提取新闻事件、市场数据、搜索结果、时效性信息等外部内容，只记用户自身信息

## [1.5.10] - 2026-03-30

### 清理
- **删除 4 个死工具文件**：`compact.ts`、`context-search.ts`、`social-post.ts`、`browser.ts`——commit de10884 删了注册但遗漏了源文件（~600 行死代码）

### 修复
- **claude_code Windows spawn 彻底修复**：不再依赖 bash 或 cmd.exe，改为解析 `claude.cmd` 找到 `cli.js` 入口，用 `process.execPath`（Node 自身）直接 spawn，彻底消除 shell 间歇性 ENOENT

## [1.5.9] - 2026-03-27

### 新功能
- **Jina Reader 集成**：web_fetch 优先通过 Jina Reader（`r.jina.ai`）获取 Markdown，质量更高；不可用时自动 fallback 到本地 Readability+Turndown
- **站点配置外置**：web_fetch 的 SPA 域名、登录墙关键词、噪音模式、站点选择器等从 `skills/web-fetch/sites.json` 加载，支持用户扩展；TS 和 Python 共享同一配置

### 修复
- **文件链接缺少 session 路径**：Telegram/钉钉/飞书/QQ/企微/WhatsApp 渠道发送文件后，WebUI 中的预览链接缺少 conversationId 路径段（如 `/files/video.mp4` → `/files/mn31qyc3-mqf8t3gu/video.mp4`），导致点击 404
- **claude_code 工具 Windows 下 ENOENT**：`shell: true` 依赖 `cmd.exe`，但 `Start-Process -WindowStyle Hidden` 启动的 gateway 进程中 `cmd.exe` 不可达，改用 Git Bash 作为 shell

## [1.5.8] - 2026-03-24

### 新功能
- **侧边栏语言切换**：底部新增地球图标，一键中英切换，删除常规设置页（/settings 默认展示模型页）
- **搜索引擎连通测试**：设置页搜索引擎卡片增加 test 按钮，一键验证 SearXNG/Serper/Querit/自定义引擎可达性
- **Hook 系统**：ToolHookManager 扩展 BeforeReturn hook，散落的 incomplete-todo guard 迁移为声明式 hook，支持外部注册
- **工具权限控制**：config.json 驱动的 allow/deny 权限，通过 PreToolUse hook 拦截，Settings 页面可视化配置

### 修复
- **claude_code SDK 失败恢复**：SDK 运行时错误不再永久禁用 SDK 模式，仅 import 失败才标记不可用

## [1.5.7] - 2026-03-23

### 新功能
- **claude_code SDK 模式**：优先使用 Claude Agent SDK（会话连续性 + 无冷启动），不可用时自动 fallback CLI。同一会话内多次调用共享上下文
- **工具全局启用/禁用**：设置页工具列表加开关，禁用的工具 LLM 完全不可见。agent 详情页同步隐藏
- **设置菜单分栏**：配置项和系统项以分隔线分组

### 修复
- **auto_send 大小写不敏感**：兼容 "True"/"true"/"TRUE"，LLM 传大写 T 不再导致文件不发送
- **桌面版配置自定义 LLM 后仍跳设置页**：providers 数组未被识别，现在同时检查
- **restart.ps1 日志重定向截断 PATH**：回滚 -RedirectStandardOutput/Error，修复 claude_code spawn cmd.exe ENOENT

## [1.5.6] - 2026-03-22

### 新功能
- **企业微信 MCP 自动发现**：WebSocket 连接后动态获取企业微信文档/表格 MCP（8 个工具），零配置
- **纯文本文件预览**：30+ 种格式侧栏预览，代码类带 Prism 语法高亮 + 行号
- **桌面版内置 5 个默认 agent**：首次启动自动部署
- **work-report skill**：一键生成日报/周报并发邮件

### 修复
- **多任务完成率从 ~20% 提升到 100%**：5 个叠加 bug 系统性修复（autoComplete 误杀、auto_send "False" truthy、todo 进度依赖 LLM、提示词矛盾、循环终止不检查完成度）
- **Playwright 抓取恢复**：误删 fetch.py 导致 X/Twitter 等 SPA 站点全部返回"JavaScript 不可用"；恢复脚本并优化去除互动按钮噪音
- **桌面版首次发消息跳设置页**：getConfig 失败时引导到模型设置页
- **MCP HTTP Accept 头**：添加 text/event-stream 支持 Streamable HTTP 协议

## [1.5.5] - 2026-03-21

### 改进
- **SQLite 每日备份**：凌晨 2 点自动备份数据库到 `data/backups/`，保留最近 7 份，防止数据丢失
- **优雅关闭**：SIGTERM 超时从 10s 延长到 30s，关闭前等待活跃对话完成（最多 15s），避免 LLM 调用被截断

### 重构
- **IM 渠道公共逻辑抽取**：新增 `channel-utils.ts`，将 5 个渠道文件中重复的 promptUser 超时、sendFile 链接构建、PUBLIC_URL 拼接、chat targets 恢复、简单事件流处理等公共逻辑统一抽取，消除 ~360 行重复代码

## [1.5.4] - 2026-03-21

### 安全修复
- **SSRF 防护**：web_fetch 新增内网地址过滤（127.0.0.0/8, 10.0.0.0/8, 169.254.0.0/16 等），阻止请求内网/元数据服务
- **file_read 路径增强**：黑名单改为正则匹配（覆盖所有 .env.* 变体），拦截 /proc/ /sys/ /dev/ 系统路径、SSH 密钥
- **Trace 敏感信息混淆**：tool_result 写入 trace 前通过 env-obfuscator 替换敏感环境变量值
- **Shell 沙箱补充**：拦截 printenv/env、cat /proc/、curl/wget 元数据服务；移除错误消息中的沙箱绕过提示
- **Subagent 回调封堵**：子代理不再继承 sendFile/saveMemory 回调，堵住通过 shell 间接绕过工具黑名单的逃逸路径
- **MCP 结果消毒**：外部 MCP server 返回内容增加 prompt injection 模式检测和警告标记
- **记忆注入中文防护**：scanMemoryContent 新增 3 条中文 prompt injection 规则
- **env-obfuscator 覆盖扩展**：SENSITIVE_PATTERNS 新增 DSN/WEBHOOK 匹配

### 修复
- **runtimeHints 不生效（P0）**：hintText 在循环外计算后固定不变，三振升级/todo nag/background task 结果全部丢失——改为每次迭代动态 join
- **namespace 数据丢失（P0）**：rebuildMemoriesTableIfNeeded 重建表时丢失 namespace 列——建表语句和 SELECT 中补入 namespace
- **QQ Bot Resume 失效（P1）**：resumeUrl 硬编码为空字符串，断线后永远走 Identify——改为从 READY 事件中获取
- **sanitizeToolPairs block 级清理**：混合 tool_result 消息中的孤立 block 现在被正确过滤，防止 API 拒绝请求
- **Docker 安全**：非特权用户运行 + .dockerignore 排除 .env/*.pem/*.key

### 优化
- **MemoryExtractor 频率**：触发间隔从 3 轮改为 8 轮，减少 60% 的独立 LLM 调用
- **压缩缓存命中**：compressTurns cache key 改为基于 turns 数量而非 tail ID，避免每条新消息触发重复 LLM 压缩
- **Shell 参数截断**：bash 工具的 command 参数加入 TRUNCATE_ARG 覆盖，减少长脚本占用上下文

### 清理
- **死代码删除**：移除 SimplePlanner、WorkflowRunner、types/config.ts（AppConfig）、legacy trigger 系统（TriggerType/SkillTrigger/matchTrigger），共删除 ~800 行无引用代码

### 改进（借鉴 ClawRouter 架构）
- **L6 观察压缩**：旧 tool_result（>500 字符）不再简单截断，而是智能提取错误行、状态信息、JSON 关键字段，重复内容自动去重引用，典型 80-95% token 节省
- **基础 Token 压缩（L2+L5）**：所有 tool_result 自动执行空白规范化（多余换行/制表符/过度缩进）和 JSON 紧凑化（pretty-print → minify），3-30% token 节省，不影响模型理解
- **LLM 错误分类体系**：7 类错误自动分类（auth/quota/rate_limit/overloaded/server_error/config/network），SmartRouter 支持模型冷却（429→60s, 503→15s）和智能 fallback 排序（冷却模型降优先级而非移除）
- **三振升级机制**：agent-loop 检测连续 3 次相似 LLM 输出（输出指纹 >80% 重合），自动注入策略变更提示，防止模型陷入重复循环
- **onLLMError 回调钩子**：agent-loop → orchestrator → gateway 三层穿透的错误报告通道，支持运行时错误分类与模型冷却
- **browser_cdp Linux headless 适配**：自动检测无 display 环境并启用 `--headless=new` + `--no-sandbox`；修复连接状态检测（`isConnected()` + 彻底重置死连接）；Dockerfile 新增 Chromium + CJK 字体；支持 Docker 部署下的浏览器自动化

## [1.5.3] - 2026-03-20

### 改进
- **Micro-Compact（静默上下文压缩）**：每轮 LLM 调用前，自动将 3 轮之前的 tool_result 内容替换为 `[previous tool result]`（>100 字符才压缩），无需 LLM 参与，持续节省 token
- **Identity Re-Injection（压缩后身份恢复）**：context 压缩后消息只剩摘要时，自动在摘要确认消息后注入 `<identity>` 块，防止非 default agent 在压缩后丢失人格
- **Todo Nag Reminder（进度提醒）**：agent 调过 update_todo 后如果连续 3 轮未更新，自动注入 `<reminder>` 提醒更新进度
- **Compact 工具（主动压缩）**：新增 `compact` 核心工具，LLM 可主动触发上下文压缩（摘要旧消息 + 删除 + 保留最近 6 轮），不再只能被动等阈值触发
- **生产就绪优化**：workDir 懒创建（纯文本 API 调用不再创建 tmp 目录）；orchestrator sessions/turnCounters + context-manager dynamicContextCache/summaryCache 替换为 LRU 缓存（防止内存无限增长）；SQLite WAL 模式已确认启用
- **Tool Argument Truncation**：旧消息中 file_write/file_edit/execute_code 的大参数自动截断为 50 字符预览，执行后不再浪费上下文空间
- **Summarization Offload**：上下文压缩时将旧消息保存到 `conversation_history.md`，summary 中带文件路径，agent 可 file_read 回顾（压缩不再不可逆）
- **记忆存储指导**：系统提示词新增 `remember` 工具规范（存什么/不存什么/先存再回复/一条一个事实）
- **Compact 门槛**：对话需达到 compressAfter 的 50% 才允许手动 compact，防止过早压缩

## [1.5.2] - 2026-03-19

### 新功能
- **文档知识库（RAG）**：agent 可上传文档文件，系统自动切片 → embedding → 向量索引；LLM 通过自动生成的搜索工具按语义检索相关段落；支持 500 字分块、段落/句子边界对齐、100 字重叠
  - 支持 PDF（pdf-parse 提取文字层，扫描件自动提示不支持）
  - 支持 HTML（Readability + Turndown 清洗，与 web_fetch 同管道）
  - 支持纯文本（.txt/.md/.csv/.json/.xml/.yaml 等直读）
- **Agent 隔离与可见性控制**：`showInChat` 控制是否在聊天页选择器中显示；`allowHandoff` 开关控制是否允许被其他 agent 转交；API 请求完全隔离，系统提示词不注入任何 agent 信息

### 改进
- **Agent 测试体验升级**：移除 Agent 详情页内嵌的简易测试 Tab，替换为"测试对话"按钮直接跳转完整 ChatPage（流式响应、工具调用、多轮对话全支持）；ChatPage 新增 Agent 指示条，非默认 Agent 时在顶部显示当前 Agent 头像和名称
- **Agent 系统提示词裁剪**：当 agent 有工具白名单时，自动移除系统提示词中引用不可用工具的规则行（如 `execute_code`、`schedule`、`claude_code` 等），末尾追加明确的工具边界声明；防止 LLM 从提示词中"发现"不可用工具名并尝试调用；tool registry 的"not found"错误信息改为列出全部可用工具
- **记忆 namespace 隔离生效**：agent 的记忆空间按 agentId 自动隔离（orchestrator 用 agentId 作为 memoryNamespace），非 default agent 不再看到全局记忆；Memory 页面新增 namespace 下拉筛选器，支持按 agent 查看/管理记忆；新增 `GET /api/memories/namespaces` 接口
- **记忆自动整合**：每天凌晨 3 点自动执行三阶段整合——重要性衰减（半衰期 30 天，identity/preference 保底 0.3）、语义去重（>0.85 相似度合并，保留更完整的条目）、清理（重要性 <0.15 且从未被检索的条目删除）；手动触发 `POST /api/memories/consolidate`

## [1.5.1] - 2026-03-19

### 新功能
- **用量统计**：Traces 页新增 Agent 下拉筛选器，按 agent 过滤追踪记录；Agent 详情页 API Tab 显示 24h / 7d 用量摘要（调用次数、token 消耗、平均延迟）；新增 `GET /api/agents/:id/usage` 接口
- **Rate Limiting**：per-agent 速率限制，支持每分钟和每天两个维度；超限返回 `429 Too Many Requests`；内存滑动窗口计数器，自动重置

## [1.5.0] - 2026-03-19

### 新功能（Hive — Agent-as-a-Service）
- **Per-agent API 端点**：每个 agent 可独立发布为 API 服务，支持无状态（`POST /api/v1/agents/:id/chat`）和 Session 模式（多轮对话），SSE 流式输出
- **Per-agent API Key**：每个 agent 生成独立的 API Key（`ac_<agentId>_<secret>`），支持生成、吊销、过期时间；`/api/v1/` 路径走 agent 自有认证，不受全局 API Key 影响
- **Memory 命名空间隔离**：`memories` 表新增 `namespace` 列，每个 agent 的记忆读写完全隔离，互不可见；向后兼容，现有数据自动归入 `default` 命名空间
- **HTTP API 知识源**：agent 可配置外部 HTTP API 作为实时数据源，平台自动生成 Tool 注册给 LLM；支持 path/query/body 参数、自定义 Headers、响应字段提取（dot-notation）；零代码连接业务系统
- **Agent 详情页**（`/agents/:id`）：从弹窗升级为独立页面，5 个 Tab：
  - Profile — 头像、名称、Soul 编辑器、模型选择、温度/迭代次数
  - Tools & Skills — 工具白名单勾选、技能黑名单勾选
  - Knowledge — HTTP API 知识源完整表单（名称/URL/Method/Headers/参数/响应提取）
  - API — 发布开关、Key 管理、自动生成 curl 示例文档
- **多语言支持**：Agent 详情页全部文字支持中英文切换（50+ 翻译键）

### 改进
- `ToolRegistryImpl` 新增 `clone()` 方法，支持 per-agent 工具注入而不污染全局注册表
- Agent 卡片显示 "API" 标记（已发布的 agent）
- CSS 类名前缀从 `ad-` 改为 `agd-`，避免 AdGuard 等广告拦截器误拦

### 修复
- **Skill 黑名单生效**：`disabledSkills` 从 UI 配置 → context-manager 过滤 skill catalog → use_skill 工具拦截，全链路生效；有黑名单时跳过全局 skillCatalogCache，确保 per-agent 过滤
- **Trace agentId 追踪**：traces 表新增 `agent_id` 列，agent-loop 创建 trace 时自动从 context 获取 agentId，支持 per-agent 用量统计
- **API Key lastUsedAt 更新**：每次 key 验证通过后自动更新 `lastUsedAt` 时间戳到 config.json
- **use_skill 黑名单拦截**：use_skill 工具执行时检查 `disabledSkills`，被禁用的 skill 返回错误而非执行

## [1.4.4] - 2026-03-18

### 新功能
- **格式错误回滚**：工具调用因 JSON 解析失败或工具名未找到而全部失败时，自动删除当前轮次的 assistant + tool turns 并重试，不浪费迭代预算；最多连续回滚 3 次，防止无限重试
- **失败摘要**：agent 达到最大迭代次数时，额外发起一次轻量 LLM 调用生成结构化总结（已完成什么、未完成什么、建议下一步），替代固定的 "max iterations reached" 提示
- **预测性 token 管理**：上下文压缩触发条件从纯轮数改为 token 估算 + 轮数双条件；根据 provider context window 的 60% 自动计算 token 预算，每轮 chars/3 估算 token 数，超过预算 70% 即触发压缩；短消息多轮不会过早压缩，长工具结果少轮也能及时压缩
- **搜索引擎 WebUI 设置**：搜索引擎配置从 .env 文件迁移到 Settings 页面，支持 SearXNG / Serper / Querit 三种引擎 + 自定义引擎；可视化拖拽排序优先级，启用/禁用切换，API Key 和 URL 在线编辑；保存后即时热更新，无需重启；旧 .env 变量自动迁移到 config.json

### 优化
- **Shell 输出 ANSI 清理**：shell 工具返回结果自动剥离 ANSI 转义序列（颜色码、光标控制等），减少无效 token 消耗

### 修复
- **Overflow 文件死循环**：模型读 overflow 文件 → 结果再被 overflow → 新文件再被读 → 无限循环。修复：file_read 读取 overflow 文件时跳过二次 overflow，并将所有 overflow 文件读取归一化为同一个 dedup key，超过 2 次自动拦截
- **工具调用总次数上限**：同一 session 内 web_search 和 web_fetch 各限 8 次（不同参数也计数），超限后强制模型用已有结果合成回答，防止"换个词再搜一遍"的无限搜索风暴
- **全局工具调用安全网**：单条用户消息内所有工具调用总计不超过 40 次，超限后强制模型停止使用工具并立即回复，防止任何模式的死循环浪费 token
- **限流压力感知**：当一轮迭代中超半数工具调用被防护层拦截时，自动注入 `[SYSTEM]` 强制输出指令，避免模型继续浪费 LLM 推理时间尝试被拦的工具（glm-5-turbo 单次推理 ~90 秒，每省一轮迭代省 90 秒）
- **Querit API 修正**：端点从 `/search` 修正为 `/v1/search`，参数名 `max_results` → `count`，响应解析适配 `results.result[]` 结构

## [1.4.3] - 2026-03-17

### 新功能
- **Intent Tracing（意图追踪）**：每个工具 schema 自动注入 `_intent` 字段，LLM 调用工具时必须说明意图；intent 在执行前剥离（不传给工具），通过 WS 事件传递到前端，ToolCallCard 优先显示 intent 作为工具调用摘要，提升 agent 行为的可解释性
- **环境变量双向混淆**：发送到 LLM 的 messages 和 systemPrompt 中，敏感环境变量值（匹配 KEY/TOKEN/SECRET/PASSWORD 模式）自动替换为 `<<$env:VAR_NAME>>` 占位符；LLM 输出和工具参数中的占位符在执行前自动还原，防止密钥泄露到 provider 训练数据
- **记忆内容质量过滤**：remember 工具新增 `EPHEMERAL_PATTERNS` 检测，自动拦截新闻标题、产品发布、市场数据等瞬时内容写入长期记忆，避免浪费系统提示词 token
- **Skill 名自动重定向**：LLM 误将 skill 名当工具调用时（如 `agent-browser snapshot`），自动识别为前缀匹配并重定向到 `use_skill`，避免 "Tool not found" 错误
- **Programmatic Tool Calling (PTC)**：新增 `execute_code` 工具，LLM 编写 JavaScript 脚本在子进程中执行，通过 IPC 调用 7 个沙箱工具（web_search/web_fetch/file_read/file_write/shell/glob/grep），中间工具结果不进入上下文窗口，仅返回 stdout；将多步工具链压缩为单轮推理，显著降低 token 消耗。沙箱工具返回 JS 友好类型（glob/grep/web_search 返回数组），禁用原生 fetch() 强制走沙箱，runner 注入完整 API 文档注释
- **对话历史搜索（context_search）**：新增核心工具，允许 Agent 搜索被压缩/截断的早期对话历史；基于 SQLite FTS5 全文索引（turns 表），支持关键词搜索并返回匹配的消息角色、时间戳和内容摘要；FTS 不可用时自动降级为 LIKE 搜索
- **受保护尾部（Fresh Tail）**：新增 `freshTailCount` 参数（默认 32），保证最近 N 条消息永远不被压缩，即使超过 `compressAfter` 阈值；与 `compressAfter` 取较大值作为实际保护数量
- **三层压缩升级**：压缩失败时自动升级 — 正常 LLM 总结（500 字 3-5 要点）→ 激进 LLM 总结（低温 200 字）→ 确定性截断（2048 字硬截断 + 轮数标注），保证无论 LLM 状态如何都能前向进展
- **大文件智能提取**：历史消息中超 12K 字符的工具结果自动持久化到磁盘（`data/tmp/lcm-files/`），替换为结构化摘要；支持 JSON（schema + 预览）、CSV（表头 + 样本行）、XML（根元素 + 子元素）、代码（imports + 签名）、纯文本（首/中/尾采样）五种内容类型检测

## [1.4.2] - 2026-03-16

### 新功能
- **Subagent 并行执行 + Cross-feed**：`spawn_and_wait` 默认 3 路并发，先完成的 agent 结果自动 steer 给还在跑的兄弟 agent；激活 `steer()` 机制，通过 `backgroundQueue` 注入指令
- **工具并行执行**：LLM 一次返回多个工具调用时，纯工具（file_read/glob/grep/web_search/web_fetch/use_skill）自动并行执行，非纯工具作为屏障串行执行；3 个 web_search 并行时延迟从 3x RTT 降至 1x RTT
- **每日简报启停开关**：Tasks 页面新增 toggle 开关，点击即时生效，关闭后 cron job 不创建
- **重复工具调用防护**：同一工具+相同参数在同一 session 中调用超过 2 次自动拦截，强制模型使用已有结果，防止 agent 循环失控无限搜索
- **聊天表格样式**：消息中的 Markdown 表格增加边框、斑马条纹、表头背景、hover 高亮、横向滚动支持
- **表格复制按钮**：hover 表格右上角出现复制图标，一键复制完整 Markdown 表格
- **消息复制按钮**：hover assistant 消息时元信息行出现复制图标，复制原始 Markdown 文本
- **MCP 热更新**：新增 `/api/mcp` 系列 API（GET/POST/DELETE/reload），支持运行时动态添加、移除、重载 MCP server，无需重启 gateway

### 修复
- **getHistory 返回最旧记录**：`ORDER BY ASC LIMIT N` 返回最旧 N 条而非最新，超 50 轮对话后 agent 完全失忆；改用子查询取最新 N 条再正排
- **memories 表重建丢失 FTS 索引**：`rebuildMemoriesTableIfNeeded` 后 `memories_fts` 残留旧数据，全文搜索完全失效；重建后同步清理并重插 FTS
- **memories/tasks 表重建无事务保护**：多条 DDL 语句不在事务中，进程崩溃可致表永久丢失；包裹 `db.transaction()`
- **Gemini tool_use ID 碰撞**：同一响应中多次调用同一工具时 ID 重复（用了 function name 作 ID），改为始终生成唯一 ID
- **Ollama native API tool call ID 碰撞**：同一响应多个 tool call 使用 `Date.now()` 生成相同 ID，改用 `generateId()` 保证唯一
- **WS activeStreams 竞态条件**：两个并发消息可同时通过 `has()` 检查，导致同一 session 启动两个 agent loop；现在在 await 前立即占位
- **WS promptUser 定时器泄漏**：stream 结束时未清理 pendingPromptRef.timer，导致 5 分钟后回调仍然触发
- **QQ Bot Resume 路径 token 未 await**：`getToken()` 是 async 函数，Resume 路径直接拼接了 Promise 对象而非 token 字符串
- **Scheduler 一次性任务竞态**：one-shot 清理逻辑在 finally 块外，回调抛异常时任务不会被清理成为僵尸记录；启动时也增加了对已执行 one-shot 的孤儿清理
- **每日简报 cron NaN**：`daily_brief_time` 设置值格式异常时 `split(":").map(Number)` 产生 NaN，导致 cron 表达式无效；增加 fallback 默认值
- **任务列表 limit 无上限**：`/api/tasks` 的 `limit` 参数无上限校验，恶意请求可拉取全量数据；限制最大 500
- **IterationBudget use_skill 回滚遗漏**：`iterations--` 回滚本地计数器但未同步 `iterationBudget.unconsume()`，子代理 use_skill 会多消耗预算
- **Context 压缩 splitIdx 越界**：`turns.length - compressAfter` 可为负数导致崩溃，增加 `splitIdx <= 0` 守卫跳过压缩
- **Tool turn JSON 解析失败静默丢失**：空 catch 导致工具结果被丢弃为空消息，改为返回 fallback tool_result block
- **remember 工具缺少 identity 类型**：type assertion 和 `saveMemory` 签名均缺少 `"identity"` 选项，与 MemoryType 定义不一致
- **ask_user CLI fallback 无超时**：readline Promise 永远等待可能挂起进程，增加 5 分钟超时保护
- **Shell streaming 模式信号杀死误判成功**：进程被信号终止时 `code` 为 null 默认为 0，现在检查 signal 参数正确设置退出码为 1
- **ChatPage wsRef stale closure**：`wsRef.current` 被错误放入 useCallback 依赖数组，WS 重连后回调使用旧连接
- **SettingsPage 无限重渲染**：`fetchAll` 和 `selectedId` 构成循环依赖，改用 ref 打破循环
- **API client headers 被丢弃**：`request()` 函数丢弃调用方自定义 headers，改为合并默认与自定义 headers
- **saveConfig 浅合并丢失嵌套字段**：`{ ...existing, ...config }` 整体替换嵌套渠道对象，改为 `deepMerge` 递归合并
- **refreshConfig 无条件重启所有渠道**：改为比较新旧配置，只重启实际变更的渠道，避免无关渠道短暂中断
- **auth.ts API_KEY 模块加载固化**：改为每次请求动态读取 config.json + env，支持通过 Web UI 热更新 API key

## [1.4.1] - 2026-03-15

### 新增
- **多 Provider 实例架构**：支持同时配置任意数量的 LLM Provider（DeepSeek/通义千问/Kimi/智谱/火山引擎/Ollama 等），`providers[]` 数组存储，旧格式环境变量自动迁移
- **Model Tab 改版**：左侧列表展示所有已配置 Provider（带开关切换），右侧编辑表单，底部添加按钮支持 10 种预设模板一键添加
- **Agent 模型下拉选择**：Agent 编辑面板的 model 字段改为下拉菜单，直接从已配置 Provider 列表中选择
- **任务型侧边栏**：对话列表按状态分组（进行中 / 等你回复 / 已完成），右键菜单支持"标记完成"/"重新打开"，运行中的 agent loop 自动归入"进行中"
- **Shell 命令流式进度推送**：yt-dlp、ffmpeg 等长时间命令执行时，实时推送下载/编码进度到前端（3 秒节流）
- **渠道配置 UI 编辑**：Settings → Channels 页面改为左右分栏布局，支持在界面配置 Telegram/钉钉/飞书/QQ Bot/企微凭证，保存后自动热重启渠道

### 改进
- **定时任务可视化调度**：创建定时任务改用频率下拉（每天/工作日/每周/每月）+ 时间选择器，替代手写 cron 表达式；高级用户仍可选「自定义 cron」；动作输入改为多行文本框；支持编辑已有任务、立即运行、启停切换；操作按钮改为图标样式（编辑/运行/删除）
- **欢迎页改版**：新增图标 + 标题「开始协作」+ 副标题，参考 DeepSeek 风格
- **LLM 自动生成会话标题**：首轮对话后异步调用 LLM 生成简洁标题（≤20 字），替代原来截取前 50 字
- 侧边栏「新对话」改为「新任务」，对齐工具型产品定位
- 「等你回复」状态的会话增加脉冲圆点指示
- 删除 SetupWizard 组件（~600 行），未配置时直接跳转 Settings 页面，入口统一
- 渠道凭证读取改为 config.json 优先、环境变量兜底，兼容老用户 .env 配置
- General Tab 精简为外观（语言/主题）+ 系统信息，LLM 配置和用量统计移至 Model Tab

### 修复
- **Provider API Key 被脱敏值覆盖**：保存某个 Provider 配置时，其他 Provider 的 `apiKey` 从 GET 返回的脱敏值（`****xxxx`）被原样写回 config.json，导致重启后 key 失效。后端现在检测 `****` 前缀并保留原始值
- 任务型侧边栏：历史会话默认归入"已完成"而非"进行中"；分组后列表无法滚动
- 点击停止按钮后，正在执行的工具卡片时钟图标不停止旋转（含刷新后历史加载）
- 停止的会话缺失 usage stats——WS abort 跳过 generator 收尾 + 有工具调用但无文本回复时 message-meta 不渲染
- 删除会话时清理 `data/tmp/{sessionId}/` 目录及文件
- Tauri 桌面版 API/WS 连接失败（`tauri://localhost` 下相对路径打到资产协议而非 gateway）

## [1.4.0] - 2026-03-14

### 新增
- **Tauri v2 桌面客户端**：Rust 窗口 + 系统托盘 + sidecar 自动启停，三平台 CI/CD（.exe/.dmg/.deb）
- **统一配置系统**：`config.json` + 环境变量 + `.env` 三层合并，配置 REST API（读/写/验证）
- **Setup Wizard**：首次启动 4 步引导，未配置时发消息自动弹出
- **Provider N 选 1**：卡片式布局，每个 Provider 独立 API Key + 模型，radio 切换运行时生效
- **静态文件托管**：gateway 生产模式自动托管 web 前端
- **disableThinking 配置**：`config.json` 或 `DISABLE_THINKING=true`，Ollama 自动切原生 API 关闭思考
- **配置热更新**：前端保存 model/baseUrl/apiKey 等字段后自动重建 provider，无需重启

### 修复
- Tauri 启动 panic（移除无效 `plugins.shell.sidecar` 字段）
- NSIS 安装包内嵌 WebView2 引导
- 静态文件 404（fastify-static wildcard 限制）
- 应用图标替换为 512x512 高清龙虾
- Linux 打包 AppImage → deb

## [1.3.12] - 2026-03-14

### 新增
- **Chrome 146 CDP 直连**：自动探测 Chrome Remote Debugging，零扩展操控真实浏览器
- **agent-browser 集成**：Rust 原生无头浏览器，140+ 命令，自动按域名匹配登录态
- **Prompt cache 命中率**：Traces 页面显示 cache 命中百分比

### 安全
- **WebSocket / CORS origin 校验**：`ALLOWED_ORIGINS` 环境变量

### 性能
- LLM 流式中止主动 `abort()` 释放连接
- OpenAI 兼容 provider 支持 prompt cache 统计
- Subagent 返回超 2000 字符自动截断
- Skill 目录全局缓存

### 修复
- **长期记忆丢失**：新增 `identity` 记忆类型，始终注入系统提示词
- web_fetch 失败自动提示切换 agent-browser
- ask_user 后 thinking 动画不消失
- send_file 自动归档到 session 目录
- regenerate/edit 流式状态丢失

## [1.3.11] - 2026-03-13

### 新增
- **Thinking 动画**：发送后即时显示轮播短语（Thinking/Pondering/Brewing… 等），工具调用期间持续显示
- **溢出模式**：工具大输出自动存文件，LLM 收预览 + 引用可按需探索
- **后台任务模式**：shell 工具新增 `background` 参数，长时间命令后台执行

### 改进
- **`/` 斜杠命令面板**：输入 `/` 弹出技能选择菜单，支持键盘导航和模糊搜索
- **Agent 选择器**：输入框左下角药丸按钮，点击弹出下拉切换，多 Agent 时显示、单 Agent 时隐藏
- **欢迎页精简**：移除顶部 Agent 药丸组和 `田` 技能按钮
- **micro_compact 标注工具名**：压缩旧工具输出时替换为 `[Previous: used grep]` 等标注
- **web_fetch 移除 max_length**：由溢出模式统一处理上下文保护

### 重构
- **ASR 去 Python 化**：迁移到 sherpa-onnx-node，连续语音延迟从 2-5s 降至 <50ms；SILK 解码改用 silk-wasm（支持 QQ/微信语音）；输出繁转简（opencc-js）

### 修复
- **移动端返回键弹层竞争**：新增 `useBackClose` hook 统一管理 overlay 栈

## [1.3.10] - 2026-03-12

### 新增
- **Traces 渠道标记**：每条 trace 记录来源渠道，前端显示标签
- **Traces 工具调用统计面板**：顶部可展开统计面板，按工具名分组详细表格
- **Traces 按 conversationId 分组**：同一会话多轮 trace 自动分组
- **bilingual-subtitle 防呆**：process.py 直接支持 URL 输入
- **确定性 Workflow Agent**：Sequential/Parallel 执行引擎，步骤间模板变量传递
- **Trajectory 自动评估框架**：工具选择/参数正确性评估 + 黄金测试集
- **Subagent 安全防线**：工具黑名单 + IterationBudget 父子共享预算
- **Memory 内容安全审查**：拦截 prompt injection、隐形 unicode、凭证窃取
- **渠道格式提示**：各渠道自动注入格式指导到系统提示词
- **Frozen Snapshot**：session 内冻结 dynamic context，prompt cache 命中率提升，~75% input token 成本节省
- **Context 压缩 tool pair 保护**：压缩边界不在 tool_call/result 间切割
- **Subagent spawn_and_wait**：一次提交多个子任务，顺序执行结果一次性返回
- **SubAgentCard 卡片 UI**：subagent 调用以单卡片展示
- **Browser 增强**：人类化输入（模拟真人节奏）、快照过滤模式（只返回交互元素）、批处理摘要、反自动化检测

### 优化
- **TTS 去 Python 化**：用 `@bestcodes/edge-tts` 替换，冷启动从 ~800ms 降至 0，总延迟 ~300-600ms
- **语音回复防呆**：注入提示防止 LLM 自己跑 edge-tts CLI

### 修复
- **web_fetch save_as + auto_send**：抓取→保存→发送从 3 轮降到 1 轮（~134s → ~15s）
- **企业微信重启后 Session not found**：检测过期 session 自动清除映射
- **会话删除不停止 agent loop**：删除时先 stop 运行中的 loop
- **切换会话工具卡片重复**：修复 history/WS resuming 竞态条件

### 重构
- **Settings 整合**：管理页面（Channels/Agents/Memory/Tools/Skills/Traces 等）收入 Settings 子页面，侧边栏精简为 4 项，旧路径自动重定向
- **ChatPage hooks 提取**：WS 连接和 streaming 状态各提取为独立 hook，ChatPage 减少 ~150 行

### 修复
- **Subagent 记录持久化**：spawn/完成/失败/kill 写入 SQLite，页面不再永远 0 条
- **停止按钮恢复**：新会话首次发送时 stop 按钮不出现
- **Settings Tools 标签页**：缺少 switch case 导致显示 General 内容

## [1.3.9] - 2026-03-11

### 改进
- **预览面板刷新按钮**：文件名旁增加刷新按钮，点击后重新加载 iframe 和源码内容，解决文件更新后缓存不刷新的问题

### 修复
- **WS 断连时停止按钮误恢复**：断连回调不再清除 isSending，agent 仍在服务端运行时保持停止按钮可见

## [1.3.8] - 2026-03-10

### 改进
- **会话级工作目录**：同一会话复用 `data/tmp/{conversationId}/` 目录，后续消息可直接修改前几轮生成的文件，无需从零重建

### 修复
- **sidebar spinner 切换会话闪烁**：解耦 streamingSessionId 和 isSending，spinner 只在收到 done 时清除，不再因切换会话而消失
- **切换会话时工具调用串台**：切换会话时重置 resumingRef，防止 loadHistory 的 resuming 分支把旧会话的 streaming 消息合并到新会话
- **WS 重连时工具调用重复显示**：loadHistory resuming 合并时去掉 history 末尾的 assistant 消息，避免与 buffer 回放重复


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
