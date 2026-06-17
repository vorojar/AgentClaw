import {
  collectToolResultContents,
  escapeMarkdownTableCell,
  escapeRegExp,
  firstMatch,
} from "./common.js";
import { isEvidenceTableAnalysisIntent } from "../ability/evidence-table-intent.js";
import type {
  CompletionPolicy,
  CompletionPolicyDecision,
  CompletionPolicyInput,
  SentFile,
} from "./types.js";
import type { Message } from "@agentclaw/types";

export const evidenceTableCompletionPolicy: CompletionPolicy = {
  name: "evidence_table_ready",
  evaluate(input: CompletionPolicyInput): CompletionPolicyDecision | null {
    if (
      input.taskKind !== "evidence_table_analysis" ||
      !hasEnoughEvidenceForTableCompletion(
        input.successfulWebSearchCalls,
        input.successfulWebFetchCalls,
        input.currentResultContents,
      )
    ) {
      return null;
    }

    const text = buildEvidenceTableFallbackResponse(
      input.inputText,
      input.messages,
      input.sentFiles,
      [...input.fallbackSnippets, ...input.currentResultContents],
      "表格化检查/分析所需的最小证据已经足够",
    );
    return text
      ? {
          policyName: this.name,
          text,
          artifacts: [],
        }
      : null;
  },
};

export function buildEvidenceTableFallbackResponse(
  inputText: string,
  messages: Message[],
  sentFiles: SentFile[],
  fallbackSnippets: string[],
  reason: string,
): string | null {
  if (!isEvidenceTableRequest(inputText)) {
    return null;
  }

  const contents = collectToolResultContents(messages);
  const combined = [
    ...contents.map((item) => item.content),
    ...fallbackSnippets,
  ].join("\n\n");
  if (!combined.trim()) return null;

  const targetHost = extractEvidenceTargetHost(inputText, combined);
  const hostPattern = targetHost
    ? new RegExp(`https?:\\/\\/(?:www\\.)?${escapeRegExp(targetHost)}\\/?`, "i")
    : /https?:\/\/[^\s]+/i;
  const title =
    firstMatch(
      combined,
      /^Title:\s*(.+)$/im,
      /^#\s*(.+)$/m,
      /title,url\}:\s*\n\s*([^—\n]+?)\s+—/i,
    ) ?? "未在已获取内容中明确发现";
  const homeUrl =
    firstMatch(
      combined,
      new RegExp(`URL Source:\\s*(${hostPattern.source})`, "i"),
      new RegExp(`(${hostPattern.source})`, "i"),
    ) ?? (targetHost ? `https://${targetHost}/` : "目标首页 URL 未明确发现");
  const headings = extractHeadingsForEvidenceTable(combined);
  const hasRobots = /robots\.txt[\s\S]*User-agent:\s*\*/i.test(combined);
  const robotsRules = extractRobotsRules(combined);
  const sitemapMissing =
    /sitemap\.xml[\s\S]{0,80}404|404[\s\S]{0,80}sitemap\.xml/i.test(combined);
  const securityMissing =
    /security\.txt/i.test(combined) &&
    /(?:HTTP\/[^\n]*404|HTTP 404|404 Not Found)/i.test(combined);
  const indexedUrls = extractIndexedUrls(combined, targetHost);
  const hasDescription =
    /<meta\s+name=["']description["']|^description:/im.test(combined);
  const hasViewport = /<meta\s+name=["']viewport["']|viewport/i.test(combined);
  const httpSummary = extractHttpSummary(combined);

  const rows: string[][] = [
    [
      "页面标题",
      title,
      title === "未在已获取内容中明确发现" ? "需补充" : "已发现",
      "标题应直接服务用户请求中的检查目标，避免只堆品牌口号或泛化描述。",
      homeUrl,
    ],
    [
      "标题结构",
      headings.length > 0
        ? headings.join("；")
        : "已获取内容中只看到正文摘要，标题层级不完整",
      headings.length > 0 ? "可优化" : "需复查源码",
      "围绕检查目标拆清主标题和子标题，避免关键结论只能从正文猜测。",
      homeUrl,
    ],
  ];
  if (
    hasDescription ||
    /\bseo\b|搜索引擎优化|收录|站点优化|网站优化/i.test(inputText)
  ) {
    rows.push([
      "Meta description",
      hasDescription
        ? "已发现 description 线索"
        : "已获取内容未看到明确 description",
      hasDescription ? "基本具备" : "建议补强",
      "为核心页面补唯一描述，并覆盖用户请求中的关键主题词。",
      homeUrl,
    ]);
  }
  if (/robots\.txt/i.test(combined) || /\bseo\b|robots|收录/i.test(inputText)) {
    rows.push([
      "robots.txt",
      hasRobots
        ? `可访问；${robotsRules || "存在 User-agent: *"}`
        : "未确认可访问",
      hasRobots ? "正常" : "需检查",
      "确认没有屏蔽核心页面或影响页面渲染所需资源。",
      targetHost ? `https://${targetHost}/robots.txt` : "robots.txt 证据",
    ]);
  }
  if (
    /sitemap\.xml/i.test(combined) ||
    /\bseo\b|sitemap|收录/i.test(inputText)
  ) {
    rows.push([
      "sitemap.xml",
      sitemapMissing
        ? `${targetHost ? `https://${targetHost}` : "目标站点"}/sitemap.xml 返回 404`
        : "未确认 sitemap 状态",
      sitemapMissing ? "高优先级问题" : "需补查",
      "如果任务涉及站点发现或收录，应生成并提交 sitemap.xml。",
      targetHost ? `https://${targetHost}/sitemap.xml` : "sitemap.xml 证据",
    ]);
  }
  if (/security\.txt/i.test(combined) || /安全|security/i.test(inputText)) {
    rows.push([
      "security.txt",
      securityMissing
        ? `${targetHost ? `https://${targetHost}` : "目标站点"}/.well-known/security.txt 返回 404`
        : "未确认 security.txt 状态",
      securityMissing ? "建议补充" : "需复查",
      "安全检查类任务可补充 security.txt，便于公开漏洞报告和安全联系人发现。",
      targetHost
        ? `https://${targetHost}/.well-known/security.txt`
        : "security.txt 证据",
    ]);
  }
  if (httpSummary) {
    rows.push([
      "HTTP/响应头",
      httpSummary,
      /HTTP Code:\s*(?:4|5)\d\d|HTTP\/[^\n]*\s(?:4|5)\d\d/i.test(combined)
        ? "异常"
        : "已获取",
      "结合任务目标继续检查跳转、缓存、安全响应头和可访问性。",
      homeUrl,
    ]);
  }
  rows.push(
    [
      "搜索结果/公开信息",
      indexedUrls.length > 0
        ? `发现 ${indexedUrls.length} 个相关 URL：${indexedUrls.slice(0, 3).join("、")}`
        : "已获取内容中未看到明确相关 URL",
      indexedUrls.length > 0 ? "已有证据" : "需复查",
      "后续判断应优先引用已抓取页面和搜索结果，避免无证据扩展。",
      indexedUrls[0] ?? homeUrl,
    ],
    [
      "移动端/页面基础",
      hasViewport ? "有 viewport/移动端线索" : "未在已获取内容中确认 viewport",
      hasViewport ? "基本具备" : "需复查源码",
      "如果该项影响用户请求目标，应继续检查首屏速度、可读性和核心路径。",
      homeUrl,
    ],
  );

  const table = [
    "| 检查项 | 当前发现 | 判断 | 建议 | 证据 |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(escapeMarkdownTableCell).join(" | ")} |`),
  ].join("\n");
  const files = sentFiles
    .map((file) => `- [${file.filename}](${file.url})`)
    .join("\n");

  return [
    "基于已成功获取的工具证据，先给出可复核的表格结论：",
    "",
    table,
    "",
    `主要证据来源：${homeUrl}`,
    files ? `\n已发送/生成的文件：\n${files}` : "",
    "",
    `说明：${reason}；系统未继续空转，已用已获取事实完成表格化结论。`,
  ]
    .filter(Boolean)
    .join("\n");
}

function isEvidenceTableRequest(inputText: string): boolean {
  return isEvidenceTableAnalysisIntent(inputText);
}

function hasEnoughEvidenceForTableCompletion(
  successfulWebSearchCalls: number,
  successfulWebFetchCalls: number,
  currentResultContents: string[],
): boolean {
  const currentEvidenceCount = currentResultContents.filter((content) =>
    content.trim(),
  ).length;
  const hasCurrentUrlEvidence = currentResultContents.some((content) =>
    /URL Source:|https?:\/\/|HTTP \d{3}|HTTP\/|results\[/i.test(content),
  );
  const hasToolEvidence =
    successfulWebSearchCalls >= 1 ||
    successfulWebFetchCalls >= 1 ||
    currentEvidenceCount >= 2;
  const hasSearchOrMultipleSources =
    successfulWebSearchCalls >= 1 ||
    successfulWebFetchCalls >= 2 ||
    currentEvidenceCount >= 2;

  return (
    currentEvidenceCount >= 2 &&
    hasCurrentUrlEvidence &&
    hasToolEvidence &&
    hasSearchOrMultipleSources
  );
}

function extractHeadingsForEvidenceTable(text: string): string[] {
  const headings: string[] = [];
  for (const match of text.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    const heading = match[1].trim();
    if (heading && !/^易哈佛\s*\|/.test(heading)) headings.push(heading);
    if (headings.length >= 4) break;
  }
  return [...new Set(headings)];
}

function extractRobotsRules(text: string): string {
  const rules = [...text.matchAll(/^Disallow:\s*([^\r\n]+)/gim)]
    .map((match) => `Disallow:${match[1].trim()}`)
    .slice(0, 4);
  return rules.join("；");
}

function extractHttpSummary(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      /^(HTTP Code|HTTP\/|Server:|Content-Type:|Strict-Transport-Security:|Content-Security-Policy:|X-Frame-Options:|X-Content-Type-Options:|Referrer-Policy:|Time Total:|Redirect)/i.test(
        line,
      ),
    )
    .slice(0, 5);
  return lines.length > 0 ? lines.join("；") : undefined;
}

function extractIndexedUrls(text: string, targetHost?: string): string[] {
  const urlPattern = targetHost
    ? new RegExp(
        `https?:\\/\\/(?:www\\.)?${escapeRegExp(targetHost)}\\/[^\\s)<>]*`,
        "gi",
      )
    : /https?:\/\/[^\s)<>]+/gi;
  return [
    ...new Set(
      [...text.matchAll(urlPattern)]
        .map((match) => match[0].replace(/[.,，。]+$/, ""))
        .filter((url) => !/robots\.txt|sitemap\.xml/i.test(url)),
    ),
  ].slice(0, 5);
}

function extractEvidenceTargetHost(
  inputText: string,
  evidenceText: string,
): string | undefined {
  const source = `${inputText}\n${evidenceText}`;
  const urlHost = source.match(
    /https?:\/\/(?:www\.)?([A-Za-z0-9.-]+\.[A-Za-z]{2,})/i,
  )?.[1];
  const bareHost = source.match(
    /(?:^|[\s：:，,])(?:www\.)?([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?:[\/\s，,。]|$)/i,
  )?.[1];
  return (urlHost ?? bareHost)?.replace(/^www\./i, "");
}
