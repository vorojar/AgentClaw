---
name: wechat-publish
description: Markdown 转微信公众号排版并发布草稿。Use this whenever the user asks to convert Markdown to WeChat Official Account HTML, inspect publish readiness, preview local WeChat layout, or create a WeChat draft. 不用于：写文章内容、其他平台发布。
---

# wechat-publish

将 Markdown 转成微信公众号兼容 HTML，可预览或创建草稿箱草稿。所有常规操作只走统一入口：

```bash
cd "<PROJECT_ROOT>" && python skills/wechat-publish/scripts/wechat_publish.py capabilities --json
cd "<PROJECT_ROOT>" && python skills/wechat-publish/scripts/wechat_publish.py inspect {INPUT_MD} --json
cd "<PROJECT_ROOT>" && python skills/wechat-publish/scripts/wechat_publish.py publish {INPUT_MD} --title "封面标题" --subtitle "封面副标题" --scheme dark --author "爬爬虾" --out-dir {WORKDIR} --json
```

离线验收或调试时使用 `--dry-run`，不会创建真实草稿：

```bash
cd "<PROJECT_ROOT>" && python skills/wechat-publish/scripts/wechat_publish.py publish {INPUT_MD} --title "封面标题" --subtitle "封面副标题" --out-dir {WORKDIR} --dry-run --json
```

## 执行规则

- 先用 `capabilities --json` 获取当前可用主题、封面配色和 JSON 契约，不要从文档猜。
- 发布前优先跑 `inspect {INPUT_MD} --json`。如果 `readiness.convert_ready=false`，按 `checks[].code` 处理，不要继续发布。
- 如果用户还没有提供 Markdown 文件，先用 `file_write` 写 `.md` 源文；不要用 `bash`/`cat`/Node/Python 临时脚本拼接或检查正文。
- 用户只要求查看效果、预览或明确说不要发布时才用 `preview`，它只写可直接打开的本地 HTML，不上传图片、不创建草稿。
- 用户说“发布到公众号 / 发送到公众号 / 发到公众号 / 草稿箱”时，`inspect` 通过后必须直接用 `publish` 创建草稿；不要停在 `preview`，不要询问是否继续发布。
- 用户明确要求发布到公众号草稿箱时才用 `publish`。成功后只根据 JSON 中的 `data.draft_media_id`、`data.artifacts.manifest_json` 和 `data.theme_selection.resolved` 汇报结果；`manifest_json` 是本次执行的审计清单。
- stdout 是唯一机器契约：`success/code/message/data`。不要解析旧脚本的行文本输出。
- 参数名必须写完整，尤其是 `--out-dir`；CLI 不接受 `--out` 这类缩写。
- 所有 `wechat_publish.py` 命令都必须从仓库根目录执行：先 `cd "<PROJECT_ROOT>" && ...`。不要在用户 home、Downloads 或临时目录里直接运行相对路径 `skills/wechat-publish/...`。
- 默认不要传 `--theme`。不传时 CLI 会使用 `auto`，根据正文把读书笔记、书摘、阅读心得、书评和书籍提炼选为 `minimal`，把 AgentClaw/产品/品牌/发布复盘选为 `sage`，把技术教程/API/CLI/部署类文章选为 `tech-modern`。只有用户明确指定某个主题时才传 `--theme`。
- `--draft` 只属于 `inspect` 子命令的特殊草稿就绪检查，常规发布不需要；`publish` 子命令没有 `--draft`。发布时优先写 `--out-dir {WORKDIR}`；如果漏写，CLI 会默认输出到 Markdown 同目录的 `wechat-output`。
- 发布或 dry-run 成功后，最终回复必须包含 `code`、`data.draft_media_id`、`data.artifacts.manifest_json` 和 `data.theme_selection.resolved`，不要只发送封面图。

## 禁止事项

- 禁止使用不存在的 `upload.py`、`publish.py`。
- 禁止手写访问令牌、上传封面或 `curl` 微信草稿接口。
- 禁止绕过 `wechat_publish.py` 直接访问微信接口。
- 禁止读取 `data/tmp/**/skills/**` 里的历史脚本。
- 禁止在发布成功后再读取 `article.json` 做无必要预览。
- 禁止在 `publish` 子命令里添加 `--draft`。
- 禁止在用户已经要求发布时只生成 preview 或发送 preview 文件后停止。

## 显式预览

只有用户要求“预览、查看效果、不要发布”时才运行：

```bash
cd "<PROJECT_ROOT>" && python skills/wechat-publish/scripts/wechat_publish.py preview {INPUT_MD} --out-dir {WORKDIR} --json
```

## 常用参数

- `--theme`：文章主题，默认 `auto`；可用值以 `capabilities --json` 为准。用户明确指定时才使用指定主题，默认发布不要传。
- `--scheme`：封面配色，默认 `dark`；可用值以 `capabilities --json` 为准。
- `--article-title`：覆盖文章 metadata 标题；不传时取 Markdown 第一个 H1。
- `--digest`：覆盖摘要；不传时从正文生成，最长 120 字符。
- `--thumb-media-id`：使用已有微信永久封面素材 ID。
- `--dry-run`：只生成本地 `article.json` / `draft.json`，不创建真实草稿。

## 微信限制自动处理

脚本自动处理：

1. 外链转脚注，避免微信外链限制。
2. 列表改成 `<section>` flex 布局，避免原生列表在微信编辑器里失真。
3. CJK 和 Latin 字符间插入空格。
4. 代码块使用 `white-space: pre-wrap` 防止横向溢出。
5. 输出 100% 内联 CSS，避免微信剥离 `<style>`。
6. 正文自动移除 Markdown 第一个 H1，避免和草稿标题重复。
