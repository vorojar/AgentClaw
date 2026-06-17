import { describe, expect, it } from "vitest";
import { evaluateCompletionPolicies } from "../completion-policies/index.js";
import { ensureNewsBriefFinalQuality } from "../completion-policies/news-brief.js";

const now = new Date("2026-05-21T08:00:00+08:00");

function baseInput() {
  return {
    taskKind: "default" as const,
    inputText: "",
    messages: [],
    sentFiles: [],
    fallbackSnippets: [],
    currentResultContents: [],
    toolResults: [],
    successfulWebSearchCalls: 0,
    successfulWebFetchCalls: 0,
    wantsFileDelivery: false,
    now,
  };
}

describe("completion policies", () => {
  it("AI 新闻证据足够时由新闻策略直接生成带来源简报", () => {
    const decision = evaluateCompletionPolicies({
      ...baseInput(),
      taskKind: "news_brief",
      inputText: "在外网搜索今日AI界新闻生成简报",
      successfulWebSearchCalls: 3,
      successfulWebFetchCalls: 2,
      fallbackSnippets: [
        "OpenAI releases a new agent feature — May 21, 2026",
        "https://openai.com/news/example",
        "Anthropic publishes safety update — May 21, 2026",
        "https://www.anthropic.com/news/example",
        "Google DeepMind announces research update — May 21, 2026",
        "https://deepmind.google/discover/blog/example",
      ],
      currentResultContents: [
        "Title: AI News Source\nURL Source: https://www.theverge.com/ai-artificial-intelligence\nThe Verge reports fresh AI industry updates.",
      ],
    });

    expect(decision?.policyName).toBe("news_brief_ready");
    expect(decision?.text).toContain("今日 AI 简报（2026-05-21）");
    expect(decision?.text).toContain("来源链接");
    expect(decision?.artifacts).toEqual([]);
  });

  it("AI 新闻搜索结果只有单一高置信来源时不应由策略过早收工", () => {
    const decision = evaluateCompletionPolicies({
      ...baseInput(),
      taskKind: "news_brief",
      inputText: "在外网搜索今日AI界新闻生成简报",
      successfulWebSearchCalls: 3,
      successfulWebFetchCalls: 0,
      fallbackSnippets: [
        "Microsoft Research shares what's next in AI — May 21, 2026",
        "https://www.microsoft.com/en-us/research/articles/whats-next-in-ai/",
      ],
    });

    expect(decision).toBeNull();
  });

  it("AI 新闻要求至少 8 条表格时不足数量不得提前收束", () => {
    const decision = evaluateCompletionPolicies({
      ...baseInput(),
      taskKind: "news_brief",
      inputText: "搜索最近 AI 新闻，输出 Markdown 对比表，至少 8 条。",
      successfulWebSearchCalls: 3,
      successfulWebFetchCalls: 0,
      fallbackSnippets: [
        "OpenAI ships agent update — May 21, 2026",
        "https://openai.com/news/agent-update",
        "Anthropic publishes safety update — May 21, 2026",
        "https://www.anthropic.com/news/safety-update",
        "TechCrunch reports AI funding round — May 21, 2026",
        "https://techcrunch.com/2026/05/21/ai-funding-round/",
        "The Verge covers AI data center dispute — May 21, 2026",
        "https://www.theverge.com/ai-artificial-intelligence/data-center",
        "Reuters reports AI policy change — May 21, 2026",
        "https://www.reuters.com/technology/artificial-intelligence/ai-policy-2026-05-21/",
      ],
    });

    expect(decision).toBeNull();
  });

  it("AI 新闻要求表格且候选足够时应按 Markdown 表格收束", () => {
    const snippets = [
      ["OpenAI ships agent update — May 21, 2026", "https://openai.com/news/agent-update"],
      ["Anthropic publishes safety update — May 21, 2026", "https://www.anthropic.com/news/safety-update"],
      ["TechCrunch reports AI funding round — May 21, 2026", "https://techcrunch.com/2026/05/21/ai-funding-round/"],
      ["The Verge covers AI data center dispute — May 21, 2026", "https://www.theverge.com/ai-artificial-intelligence/data-center"],
      ["Reuters reports AI policy change — May 21, 2026", "https://www.reuters.com/technology/artificial-intelligence/ai-policy-2026-05-21/"],
      ["MIT Technology Review profiles robot model — May 21, 2026", "https://www.technologyreview.com/2026/05/21/robot-model/"],
      ["Google DeepMind releases model research — May 21, 2026", "https://deepmind.google/discover/blog/model-research/"],
      ["Nvidia announces AI data center systems — May 21, 2026", "https://www.nvidia.com/en-us/data-center/news-ai-systems/"],
    ].flat();
    const decision = evaluateCompletionPolicies({
      ...baseInput(),
      taskKind: "news_brief",
      inputText: "搜索最近 AI 新闻，输出 Markdown 对比表，至少 8 条。",
      successfulWebSearchCalls: 3,
      successfulWebFetchCalls: 0,
      fallbackSnippets: snippets,
    });

    expect(decision?.policyName).toBe("news_brief_ready");
    expect(decision?.text).toContain("| 日期 | 来源 | 标题 | 为什么重要 | 来源链接 |");
    expect(decision?.text?.split("\n").filter((line) => /^\| .*https?:\/\//.test(line))).toHaveLength(8);
  });

  it("AI 新闻候选 URL 日期早于 7 天时不应被当作今日简报证据", () => {
    const decision = evaluateCompletionPolicies({
      ...baseInput(),
      taskKind: "news_brief",
      inputText: "在外网搜索今日AI界新闻生成简报",
      successfulWebSearchCalls: 3,
      successfulWebFetchCalls: 2,
      fallbackSnippets: [
        "White House Considers Vetting A.I. Models Before They Are Released",
        "https://www.nytimes.com/2026/05/04/technology/trump-ai-models.html",
        "AI Foundation Model Transparency Act of 2026",
        "https://www.congress.gov/119/bills/hr8094/BILLS-119hr8094ih.htm",
        "Old AI policy explainer",
        "https://www.theverge.com/2026/05/01/ai-policy-old",
      ],
      now: new Date("2026-05-24T08:00:00+08:00"),
    });

    expect(decision).toBeNull();
  });

  it("AI 新闻最终答复只有聚合站来源时应改为可信来源不足", () => {
    const checked = ensureNewsBriefFinalQuality(
      [
        "今日 AI 简报",
        "### 1. Anthropic 传闻完成巨额融资",
        "来源：https://www.buildfastwithai.com/blogs/ai-news-today-may-21-2026",
        "### 2. 白宫撤销 AI 行政令",
        "来源：https://www.buildfastwithai.com/blogs/ai-news-today-may-21-2026",
        "### 3. OpenAI IPO 传闻",
        "来源：https://www.buildfastwithai.com/blogs/ai-news-today-may-21-2026",
      ].join("\n"),
      [
        "results[1]{title,url}: AI News Today — https://www.buildfastwithai.com/blogs/ai-news-today-may-21-2026",
      ],
      now,
    );

    expect(checked).toContain("可信来源不足");
    expect(checked).toContain("不硬凑 3 条");
    expect(checked).not.toContain("Anthropic 传闻完成巨额融资");
    expect(checked).not.toContain("buildfastwithai.com");
  });

  it("AI 新闻最终答复标题缺失时应从可信抓取页面正文重建", () => {
    const checked = ensureNewsBriefFinalQuality(
      [
        "今日 AI 简报（2026-06-17）",
        "",
        "- 🔗",
        "  来源：https://www.theverge.com/ai-artificial-intelligence",
      ].join("\n"),
      [
        [
          "URL Source: https://www.theverge.com/ai-artificial-intelligence",
          "",
          "# Artificial Intelligence",
          "The Justice Department argues that xAI’s Mississippi data center should be allowed to pollute the air because it is critical for military operations.",
          "Today’s Vergecast: The Mythos mess and your AI questions, answered.",
          "Anthropic and the US government are once again at odds over the Claude Fable 5 model.",
          "Disney is using Adobe AI for theme park Imagineering.",
        ].join("\n"),
      ],
      new Date("2026-06-17T08:00:00+08:00"),
    );

    expect(checked).toContain("今日 AI 简报（2026-06-17）");
    expect(checked).toContain("xAI’s Mississippi data center");
    expect(checked).toContain("Today’s Vergecast");
    expect(checked).toContain("Disney is using Adobe AI");
    expect(checked).not.toContain("- 🔗");
    expect(checked).not.toContain("more a part of our lives than ever before");
  });

  it("AI 新闻最终答复混入 fetch 失败项时应从工具证据重建", () => {
    const checked = ensureNewsBriefFinalQuality(
      [
        "今日 AI 简报（2026-06-17）",
        "",
        "- Failed to fetch fetch failed",
        "  来源：https://techcrunch.com/category/artificial-intelligence/",
        "- AI News & Artificial Intelligence | TechCrunch：Read the latest on artificial intelligence.",
        "  来源：https://techcrunch.com/category/artificial-intelligence/",
      ].join("\n"),
      [
        [
          "URL Source: https://techcrunch.com/category/artificial-intelligence/",
          "AI News & Artificial Intelligence | TechCrunch",
          "The AI layoff wave is becoming a powder keg - TechCrunch",
          "TechCrunch reports on AI startup funding and model releases.",
          "OpenAI and Anthropic competition remains a central AI industry story.",
        ].join("\n"),
      ],
      new Date("2026-06-17T08:00:00+08:00"),
    );

    expect(checked).not.toContain("Failed to fetch");
    expect(checked).toContain("The AI layoff wave");
    expect(checked).toContain("OpenAI and Anthropic");
  });

  it("Reddit RSS 失败且没有 save_as 时返回写入并发送 Markdown 的交付意图", () => {
    const rssContent =
      "## r/technology\n- 抓取失败：HTTP 403 Blocked\n- https://www.reddit.com/r/technology/.rss";
    const decision = evaluateCompletionPolicies({
      ...baseInput(),
      taskKind: "reddit_rss",
      inputText: "Reddit RSS 日报，最后用 send_file 发送",
      currentResultContents: [rssContent],
      toolResults: [
        {
          effectiveToolName: "rss_top",
          result: { content: rssContent },
        },
      ],
      wantsFileDelivery: true,
    });

    expect(decision?.policyName).toBe("reddit_rss_terminal_result");
    expect(decision?.text).toContain("Reddit 科技AI日报");
    expect(decision?.artifacts).toEqual([
      expect.objectContaining({
        kind: "write_and_send_markdown",
        filename: "reddit-tech-ai-daily-2026-05-21.md",
        content: decision?.text,
        writeEffectSource: "auto_write_reddit_rss_report",
        sendEffectSource: "auto_send_reddit_rss_report",
      }),
    ]);
  });

  it("Reddit RSS 已保存报告时只返回发送已有文件的交付意图", () => {
    const savedPath =
      "D:/mycode/agentclaw/data/tmp/conv-rss/reddit_tech_ai_daily.md";
    const rssContent = [
      "## r/artificial",
      "- 抓取失败：HTTP 403 Blocked",
      "- https://www.reddit.com/r/artificial/.rss",
      `Saved to: ${savedPath}`,
    ].join("\n");
    const decision = evaluateCompletionPolicies({
      ...baseInput(),
      taskKind: "reddit_rss",
      inputText: "Reddit RSS 日报，最后用 send_file 发送",
      currentResultContents: [rssContent],
      toolResults: [
        {
          effectiveToolName: "rss_top",
          result: { content: rssContent },
        },
      ],
      wantsFileDelivery: true,
    });

    expect(decision?.artifacts).toEqual([
      {
        kind: "send_existing_file",
        path: savedPath,
        sendEffectSource: "auto_send_reddit_rss_report",
      },
    ]);
  });

  it("表格化检查证据足够时由证据表策略生成 Markdown 表格", () => {
    const decision = evaluateCompletionPolicies({
      ...baseInput(),
      taskKind: "evidence_table_analysis",
      inputText: "用表格检查 https://www.ehafo.com 的 SEO 和安全问题",
      successfulWebSearchCalls: 1,
      successfulWebFetchCalls: 2,
      currentResultContents: [
        'Title: 易哈佛\nURL Source: https://www.ehafo.com\n# 首页\n<meta name="description" content="教育">',
        "HTTP Code: 404\nURL Source: https://www.ehafo.com/.well-known/security.txt",
      ],
    });

    expect(decision?.policyName).toBe("evidence_table_ready");
    expect(decision?.text).toContain(
      "| 检查项 | 当前发现 | 判断 | 建议 | 证据 |",
    );
    expect(decision?.artifacts).toEqual([]);
  });

  it("默认任务不触发任何特化完成策略", () => {
    expect(evaluateCompletionPolicies(baseInput())).toBeNull();
  });
});
