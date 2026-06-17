import { describe, expect, it } from "vitest";
import {
  buildTaskToolProfile,
  filterToolDefinitionsForTask,
} from "../ability/task-router.js";

describe("ability task router", () => {
  it("纯文本延续追问不暴露任何工具", () => {
    const profile = buildTaskToolProfile(
      "继续第 3 项，展开为可执行验收步骤。",
      false,
      false,
    );

    expect(profile.kind).toBe("text_only_followup");
    expect(profile.allowedTools?.size).toBe(0);
    expect(profile.webResearchToolLimit).toBe(0);
  });

  it("自动化请求优先 schedule，即使同时包含新闻语义", () => {
    const profile = buildTaskToolProfile(
      "每天早上 9 点检查 Hacker News 是否有 Agent 相关热门新闻并通知我。",
      true,
      true,
    );

    expect(profile.kind).toBe("automation_schedule");
    expect(profile.allowedTools).toEqual(new Set(["schedule"]));
    expect(profile.toolTotalLimits.schedule).toBe(2);
  });

  it("表格化检查任务使用通用证据预算，避免按领域穷举", () => {
    const profile = buildTaskToolProfile(
      "专业的检查www.ehafo.com 的seo，用表格回答。",
      false,
      false,
    );

    expect(profile.kind).toBe("evidence_table_analysis");
    expect(profile.allowedTools).toEqual(
      new Set(["web_fetch", "web_search", "bash"]),
    );
    expect(profile.toolTotalLimits).toMatchObject({
      web_fetch: 4,
      web_search: 2,
      bash: 6,
    });
    expect(profile.webResearchToolLimit).toBe(5);
    expect(profile.hint).toContain("表格化检查");

    const securityProfile = buildTaskToolProfile(
      "检查www.example.com 的安全问题，用表格回答。",
      false,
      false,
    );
    expect(securityProfile.kind).toBe("evidence_table_analysis");
    expect(securityProfile.allowedTools).toEqual(
      new Set(["web_fetch", "web_search", "bash"]),
    );
    expect(securityProfile.toolTotalLimits).toMatchObject({
      web_fetch: 4,
      web_search: 2,
      bash: 6,
    });
    expect(securityProfile.webResearchToolLimit).toBe(5);
    expect(securityProfile.hint).toContain("表格化检查");
  });

  it("竞品和产品表格调研不应落入网站技术检查模板", () => {
    const profile = buildTaskToolProfile(
      "用表格分析 OpenAI 和 Anthropic 的产品定位、价格和生态差异。",
      false,
      false,
    );

    expect(profile.kind).toBe("default");
    expect(profile.allowedTools).toBeUndefined();
  });

  it("继续生成文件类产物不应被误判成纯文本追问", () => {
    const profile = buildTaskToolProfile(
      "继续生成剩下几页 PPTX，并把文件发给我。",
      false,
      false,
      true,
    );

    expect(profile.kind).toBe("pptx_generation");
    expect(profile.allowedTools?.size).toBeGreaterThan(0);
  });

  it("Reddit/RSS 日报边界只由 task router 暴露专用工具", () => {
    const profile = buildTaskToolProfile(
      "抓取 r/LocalLLaMA 和 r/MachineLearning 的 RSS，生成日报并发给我。",
      false,
      false,
    );

    expect(profile.kind).toBe("reddit_rss");
    expect(profile.allowedTools).toEqual(
      new Set(["rss_top", "file_write", "send_file"]),
    );
    expect(profile.toolTotalLimits).toEqual({
      rss_top: 1,
      file_write: 2,
      send_file: 2,
    });
    expect(profile.webResearchToolLimit).toBe(0);
    expect(profile.hint).toContain("只能用 rss_top");
  });

  it("负向排除 Reddit 时不得误判为 Reddit/RSS 日报任务", () => {
    const profile = buildTaskToolProfile(
      "请真实搜索并抓取最近7天 AI 领域的高可信新闻，输出 Markdown 对比表；不要用 Reddit/YouTube/SEO 聚合站。",
      true,
      true,
    );

    expect(profile.kind).toBe("news_brief");
    expect(profile.allowedTools).toEqual(
      new Set(["web_search", "web_fetch", "file_write", "send_file"]),
    );
    expect(profile.allowedTools).not.toContain("rss_top");
  });

  it("按任务 profile 过滤工具定义", () => {
    const profile = buildTaskToolProfile("继续第 3 项。", false, false);
    const filtered = filterToolDefinitionsForTask(
      [{ name: "bash" }, { name: "web_search" }],
      profile,
    );

    expect(filtered).toEqual([]);
  });
});
