import { WECHAT_PUBLISH_SCRIPT } from "./wechat-publish-contract.js";

export type TaskToolProfile = {
  kind:
    | "default"
    | "news_brief"
    | "evidence_table_analysis"
    | "reddit_rss"
    | "wechat_publish"
    | "pptx_generation"
    | "text_only_followup"
    | "automation_schedule";
  allowedTools?: Set<string>;
  toolTotalLimits: Record<string, number>;
  webResearchToolLimit: number;
  hint?: string;
};

export function buildTaskToolProfile(
  inputText: string,
  isNewsBriefTask: boolean,
  isAiNewsTask: boolean,
  isPptxGenerationTask = false,
  options: { pptxVerifierPath?: string } = {},
): TaskToolProfile {
  if (isTextOnlyFollowupTask(inputText)) {
    return {
      kind: "text_only_followup",
      allowedTools: new Set(),
      toolTotalLimits: {},
      webResearchToolLimit: 0,
      hint: "[任务工具边界]当前是纯文本延续追问：不要调用 file_write、send_file、bash、web_search、web_fetch 或记忆工具；直接基于当前会话上下文回答。",
    };
  }

  if (isAutomationScheduleTask(inputText)) {
    return {
      kind: "automation_schedule",
      allowedTools: new Set(["schedule"]),
      toolTotalLimits: { schedule: 2 },
      webResearchToolLimit: 0,
      hint: '[任务工具边界]当前是自动化/提醒任务：必须使用 schedule 工具创建或查询；禁止 bash、crontab、Windows Task Scheduler，也不要只说明方案。创建每天 9 点任务用 cron="0 9 * * *"；提醒任务也优先用 schedule 工具。',
    };
  }

  if (
    /公众号|微信公众号|草稿箱|发布到公众号|发到公众号|发送到公众号|wechat/i.test(
      inputText,
    )
  ) {
    return {
      kind: "wechat_publish",
      allowedTools: new Set([
        "use_skill",
        "web_search",
        "web_fetch",
        "file_write",
        "bash",
      ]),
      toolTotalLimits: {
        use_skill: 2,
        web_search: 6,
        web_fetch: 4,
        file_write: 2,
        bash: 5,
      },
      webResearchToolLimit: 8,
      hint: `[任务工具边界]当前是微信公众号发布任务：可少量 web_search/web_fetch 补事实，但交付目标是写出 Markdown 并通过 wechat-publish 统一 CLI 发布。研究预算耗尽后禁止继续搜索，必须继续用 file_write 写 Markdown、use_skill 加载 wechat-publish、bash 调用 wechat_publish.py inspect/publish 完成交付；不要只输出阶段性总结。硬边界：没有可发布 Markdown 前不要用 bash；file_write 只写 .md 文章；bash 只允许执行 \`cd "<PROJECT_ROOT>" && python ${WECHAT_PUBLISH_SCRIPT} capabilities|inspect|publish ... --json\`，禁止 preview/convert/help、手写 HTML/Node 转换或查找其他 skill 路径。所有 wechat_publish.py 命令必须从仓库根目录执行，inspect/publish/capabilities 都必须带 --json。如果用户说发布/发送到公众号，写完 Markdown 后必须 inspect，inspect 通过后必须直接 publish 创建草稿，不要停在 preview 或询问是否继续。默认不要传 --theme，publish 子命令不能传 --draft；publish 优先带 --out-dir，漏写时 CLI 会使用 Markdown 同目录的 wechat-output。`,
    };
  }

  if (/reddit|rss|subreddit|子版块/i.test(inputText)) {
    return {
      kind: "reddit_rss",
      allowedTools: new Set(["rss_top", "file_write", "send_file"]),
      toolTotalLimits: { rss_top: 1, file_write: 2, send_file: 2 },
      webResearchToolLimit: 0,
      hint: "[任务工具边界]当前是 Reddit/RSS 日报任务：只能用 rss_top 获取订阅源 TopN，再用 file_write/send_file 输出。不要调用 web_search、web_fetch、bash 或其他抓取工具。",
    };
  }

  if (isEvidenceTableAnalysisTask(inputText)) {
    return {
      kind: "evidence_table_analysis",
      allowedTools: new Set(["web_fetch", "web_search", "bash"]),
      toolTotalLimits: {
        web_fetch: 4,
        web_search: 2,
        bash: 6,
      },
      webResearchToolLimit: 5,
      hint: "[任务工具边界]当前是表格化检查/分析任务：先用少量 web_fetch/web_search/bash 获取目标、公开页面、搜索结果或响应头等证据；拿到可支撑表格的事实后必须直接输出 Markdown 表格，不要继续深挖或循环抓取。",
    };
  }

  if (isNewsBriefTask || isAiNewsTask) {
    return {
      kind: "news_brief",
      allowedTools: isPptxGenerationTask
        ? new Set([
            "web_search",
            "web_fetch",
            "use_skill",
            "bash",
            "claude_code",
            "glob",
            "send_file",
          ])
        : new Set(["web_search", "web_fetch", "file_write", "send_file"]),
      toolTotalLimits: isPptxGenerationTask
        ? {
            web_search: 3,
            web_fetch: 3,
            use_skill: 2,
            bash: 8,
            claude_code: 2,
            glob: 3,
            send_file: 2,
          }
        : {
            web_search: 3,
            web_fetch: 3,
            file_write: 1,
            send_file: 1,
          },
      webResearchToolLimit: 6,
      hint: isPptxGenerationTask
        ? "[任务工具边界]当前是新闻类 PPTX 任务：最多 3 次 web_search + 3 次 web_fetch 获取事实；研究结束后必须继续用 use_skill 加载 pptx，随后在会话工作目录生成、verify_pptx --json 验证并 send_file 发送 PPTX。不要停在新闻总结。"
        : "[任务工具边界]当前是新闻简报任务：最多 3 次 web_search + 3 次 web_fetch，优先搜索，抓取只补关键事实；不要读取 observation；最终每条新闻必须附来源 URL。",
    };
  }

  if (isPptxGenerationTask && !shouldAllowProjectResearchForPptx(inputText)) {
    const verifierPath =
      options.pptxVerifierPath?.replace(/\\/g, "/") ??
      "<skills>/pptx/scripts/verify_pptx.py";
    return {
      kind: "pptx_generation",
      allowedTools: new Set([
        "use_skill",
        "bash",
        "claude_code",
        "file_write",
        "send_file",
      ]),
      toolTotalLimits: {
        use_skill: 2,
        bash: 8,
        claude_code: 2,
        file_write: 3,
        send_file: 2,
      },
      webResearchToolLimit: 0,
      hint: `[任务工具边界]当前是普通 PPTX 生成任务：不要调用 recall、glob、grep、file_read、web_search、web_fetch 做额外研究。直接 use_skill pptx；复杂 deck 可直接调用 claude_code 工具在会话工作目录生成，不要用 bash 运行 claude/claude-code；如果自己写 Python 生成脚本，必须先用 file_write 把脚本写入会话工作目录，再用 bash 运行 python，禁止运行尚不存在的 create_deck.py/create_pptx.py。生成 deck 后，必须用这个 verifier 绝对路径验证：python "${verifierPath}" "<会话工作目录>/output.pptx" --out-dir "<会话工作目录>/previews" --require-text --json；然后 send_file 发送验证通过的 .pptx。只有用户明确要求基于仓库/代码/文件研究时，才允许项目读取工具。`,
    };
  }

  return {
    kind: "default",
    toolTotalLimits: { web_search: 8, web_fetch: 8 },
    webResearchToolLimit: 6,
  };
}

export function filterToolDefinitionsForTask<T extends { name: string }>(
  tools: T[],
  profile: TaskToolProfile,
): T[] {
  if (!profile.allowedTools) return tools;
  return tools.filter((tool) => profile.allowedTools!.has(tool.name));
}

function isTextOnlyFollowupTask(inputText: string): boolean {
  const hasArtifactContinuationIntent =
    /生成|制作|做完|补完|完善|创建|导出|build|make|generate|finish|complete/i.test(
      inputText,
    ) &&
    /文件|PPT|pptx|ppt|幻灯片|deck|页面|文档|表格|报告|图片|视频|artifact|file|slide|document|spreadsheet|report|image|video/i.test(
      inputText,
    );
  const hasExplicitToolIntent =
    /保存|发送|写入|创建文件|下载|抓取|搜索|读取文件|运行|执行(?!验收)|修改|删除|send|save|write|download|search|fetch|run|execute/i.test(
      inputText,
    );
  return (
    /^(继续|基于刚才|展开|再说|说明|回答|只回答|只编号|给两个|给 2 个)/i.test(
      inputText.trim(),
    ) &&
    !hasExplicitToolIntent &&
    !hasArtifactContinuationIntent
  );
}

function isAutomationScheduleTask(inputText: string): boolean {
  return /自动化|定时|提醒|每天|每周|明天.*(?:提醒|上午|早上)|schedule|automation|reminder/i.test(
    inputText,
  );
}

function isEvidenceTableAnalysisTask(inputText: string): boolean {
  const wantsTable = /表格|table/i.test(inputText);
  const hasAnalysisVerb =
    /检查|审计|分析|评估|诊断|体检|audit|check|analy[sz]e|review/i.test(
      inputText,
    );
  const hasResearchableTarget =
    /https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}|官网|网站|网页|站点|安全|性能|转化|\bseo\b|搜索引擎优化|收录|sitemap|robots|响应头|headers?/i.test(
      inputText,
    );

  return wantsTable && hasAnalysisVerb && hasResearchableTarget;
}

function shouldAllowProjectResearchForPptx(inputText: string): boolean {
  return /基于.*(仓库|代码|源码|文件|目录|项目)|当前.*(仓库|代码|源码|文件|目录|项目)|仓库代码|代码库|repo|repository|codebase|read files|inspect files/i.test(
    inputText,
  );
}
