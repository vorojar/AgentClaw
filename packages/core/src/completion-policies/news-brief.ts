import {
  currentLocalDateString,
  escapeMarkdownTableCell,
  extractFallbackLines,
} from "./common.js";
import type {
  CompletionPolicy,
  CompletionPolicyDecision,
  CompletionPolicyInput,
} from "./types.js";

const MIN_SEARCH_ONLY_CANDIDATES = 3;

export const newsBriefCompletionPolicy: CompletionPolicy = {
  name: "news_brief_ready",
  evaluate(input: CompletionPolicyInput): CompletionPolicyDecision | null {
    const candidates = extractNewsCandidates(
      [
        ...input.fallbackSnippets,
        ...expandNewsEvidenceLines(input.currentResultContents),
      ],
      input.now,
    );
    const outputContract = {
      ...readNewsOutputContract(input.inputText),
      requireExplicitRecencyEvidence: input.successfulWebFetchCalls === 0,
    };
    const completionReadyCandidates = selectCandidatesForOutputContract(
      candidates,
      outputContract,
    );
    const requiredCandidates = Math.max(
      MIN_SEARCH_ONLY_CANDIDATES,
      outputContract.minItems,
    );
    if (
      input.taskKind !== "news_brief" ||
      input.successfulWebSearchCalls < 3 ||
      (input.successfulWebFetchCalls < 2 &&
        completionReadyCandidates.length < requiredCandidates) ||
      completionReadyCandidates.length < requiredCandidates
    ) {
      return null;
    }

    const text = buildNewsBriefCompletionResponse(
      input.fallbackSnippets,
      input.currentResultContents,
      "新闻简报已获取足够近期可信来源",
      input.now,
      outputContract,
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

export function ensureNewsBriefFinalQuality(
  response: string,
  evidenceContents: string[],
  now?: Date,
): string {
  if (!/https?:\/\//i.test(response)) return response;

  const responseUrls = extractTrustedRecentUrls(response, now);
  const responseCandidates = extractNewsCandidates(
    response.split(/\r?\n/),
    now,
  );
  const responseContainsFailedEvidence = containsFailedEvidence(response);
  if (
    !responseContainsFailedEvidence &&
    (responseUrls.length >= MIN_SEARCH_ONLY_CANDIDATES ||
      responseCandidates.length >= MIN_SEARCH_ONLY_CANDIDATES)
  ) {
    return response;
  }

  const evidenceLines = expandNewsEvidenceLines(evidenceContents);
  const evidenceCandidates = extractNewsCandidates(
    [...response.split(/\r?\n/), ...evidenceLines],
    now,
  );
  if (evidenceCandidates.length >= MIN_SEARCH_ONLY_CANDIDATES) {
    const rebuilt = buildNewsBriefCompletionResponse(
      response.split(/\r?\n/),
      evidenceContents,
      "最终回答未满足可信来源门槛，已改用工具证据重建简报",
      now,
    );
    return (
      rebuilt ?? buildInsufficientTrustedNewsResponse(evidenceCandidates, now)
    );
  }

  return buildInsufficientTrustedNewsResponse(evidenceCandidates, now);
}

function buildNewsBriefCompletionResponse(
  fallbackSnippets: string[],
  currentResultContents: string[],
  reason: string,
  now?: Date,
  outputContract: NewsOutputContract = DEFAULT_NEWS_OUTPUT_CONTRACT,
): string | null {
  const lines = [
    ...fallbackSnippets,
    ...expandNewsEvidenceLines(currentResultContents),
  ];
  const unique = [...new Set(lines)];
  const candidates = selectCandidatesForOutputContract(
    extractNewsCandidates(unique, now),
    outputContract,
  );
  const sources = candidates.map((item) => item.url);

  if (
    candidates.length < outputContract.minItems ||
    (candidates.length === 0 && sources.length === 0)
  ) {
    return null;
  }

  if (outputContract.wantsTable) {
    return buildNewsTableCompletionResponse(
      candidates,
      sources,
      reason,
      now,
      outputContract,
    );
  }

  const briefItems =
    candidates.length > 0
      ? candidates
          .slice(0, 5)
          .map((item) => {
            const detail = item.summary ? `：${item.summary}` : "";
            return `- ${item.title}${detail}\n  来源：${item.url}`;
          })
          .join("\n")
      : "- 已获取到来源链接，但可抽取标题不足；建议后续改用更高质量新闻源。";
  const sourceList =
    sources.length > 0
      ? sources
          .slice(0, 6)
          .map((url) => `- ${url}`)
          .join("\n")
      : "- 已获取的工具结果中未提取到明确 URL。";
  const confidenceNote =
    candidates.length < 3
      ? "已过滤过期、低质或预测类来源；本轮只保留可确认的高置信候选。"
      : "已过滤过期、低质或预测类来源。";

  return [
    `今日 AI 简报（${currentLocalDateString(now)}）`,
    "",
    briefItems,
    "",
    `今日洞察：${confidenceNote}本次基于可核验来源整理简报。`,
    "",
    "来源链接：",
    sourceList,
    "",
    `说明：${reason}；已基于可核验来源完成本轮简报。`,
  ].join("\n");
}

type NewsOutputContract = {
  wantsTable: boolean;
  minItems: number;
  requireExplicitRecencyEvidence: boolean;
};

const DEFAULT_NEWS_OUTPUT_CONTRACT: NewsOutputContract = {
  wantsTable: false,
  minItems: MIN_SEARCH_ONLY_CANDIDATES,
  requireExplicitRecencyEvidence: false,
};

function readNewsOutputContract(inputText: string): NewsOutputContract {
  const wantsTable = /表格|对比表|Markdown\s*table|table/i.test(inputText);
  const minItemsMatch =
    inputText.match(/至少\s*(\d+)\s*条/i) ??
    inputText.match(/(\d+)\s*条/i);
  const requestedItems = minItemsMatch ? Number(minItemsMatch[1]) : undefined;
  const minItems = Number.isFinite(requestedItems)
    ? Math.max(MIN_SEARCH_ONLY_CANDIDATES, requestedItems!)
    : wantsTable
      ? 5
      : MIN_SEARCH_ONLY_CANDIDATES;
  return { wantsTable, minItems, requireExplicitRecencyEvidence: false };
}

function buildNewsTableCompletionResponse(
  candidates: NewsCandidate[],
  sources: string[],
  reason: string,
  now: Date | undefined,
  outputContract: NewsOutputContract,
): string {
  const rows = candidates.slice(0, outputContract.minItems).map((item) => [
    inferCandidateDate(item, now),
    inferSourceName(item.url),
    item.title,
    item.summary ||
      "来自可信来源的近期 AI 事件，已纳入本轮高置信对比。",
    `[来源](${item.url})`,
  ]);
  const table = [
    "| 日期 | 来源 | 标题 | 为什么重要 | 来源链接 |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(escapeMarkdownTableCell).join(" | ")} |`),
  ].join("\n");
  const sourceList =
    sources.length > 0
      ? sources
          .slice(0, Math.max(outputContract.minItems, 6))
          .map((url) => `- ${url}`)
          .join("\n")
      : "- 已获取的工具结果中未提取到明确 URL。";

  return [
    `今日 AI 新闻对比表（${currentLocalDateString(now)}）`,
    "",
    table,
    "",
    "来源链接：",
    sourceList,
    "",
    `说明：${reason}；已按用户要求输出 Markdown 表格。`,
  ].join("\n");
}

function selectCandidatesForOutputContract(
  candidates: NewsCandidate[],
  outputContract: NewsOutputContract,
): NewsCandidate[] {
  const filtered = outputContract.requireExplicitRecencyEvidence
    ? candidates.filter(
        (candidate) =>
          candidate.hasExplicitRecencyEvidence &&
          !isEvergreenOrIndexCandidate(candidate),
      )
    : candidates;
  const seenUrls = new Set<string>();
  const selected: NewsCandidate[] = [];
  for (const candidate of filtered) {
    const key = candidate.url.toLowerCase().replace(/\/+$/, "");
    if (outputContract.requireExplicitRecencyEvidence && seenUrls.has(key)) {
      continue;
    }
    seenUrls.add(key);
    selected.push(candidate);
  }
  return selected;
}

function isEvergreenOrIndexCandidate(candidate: NewsCandidate): boolean {
  const text = `${candidate.title} ${candidate.summary} ${candidate.url}`;
  return /\b(?:AI Index Report|annual report|category|regulatory-framework|policies\/regulatory-framework|latest AI news we announced|news highlights|daily AI news|roundup)\b/i.test(
    text,
  );
}

function inferCandidateDate(item: NewsCandidate, now?: Date): string {
  const text = `${item.title} ${item.summary} ${item.url}`;
  const urlDate = text.match(/\b(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (urlDate) {
    return `${urlDate[1]}-${urlDate[2].padStart(2, "0")}-${urlDate[3].padStart(2, "0")}`;
  }
  const monthDate = text.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i,
  );
  if (monthDate) {
    const month = MONTH_INDEX[monthDate[1].toLowerCase().slice(0, 3)];
    if (month !== undefined) {
      return `${monthDate[3]}-${String(month + 1).padStart(2, "0")}-${monthDate[2].padStart(2, "0")}`;
    }
  }
  return currentLocalDateString(now);
}

function inferSourceName(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "可信来源";
  }
}

function buildInsufficientTrustedNewsResponse(
  candidates: NewsCandidate[],
  now?: Date,
): string {
  const retainedCandidates = selectCandidatesForOutputContract(candidates, {
    ...DEFAULT_NEWS_OUTPUT_CONTRACT,
    requireExplicitRecencyEvidence: true,
  });
  const candidateLines =
    retainedCandidates.length > 0
      ? retainedCandidates
          .slice(0, MIN_SEARCH_ONLY_CANDIDATES)
          .map((item) => {
            const detail = item.summary ? `：${item.summary}` : "";
            return `- ${item.title}${detail}\n  来源：${item.url}`;
          })
          .join("\n")
      : "- 本轮搜索结果未留下可确认的近期可信来源候选。";

  return [
    `今日 AI 简报（${currentLocalDateString(now)}）`,
    "",
    "可信来源不足，本轮不硬凑 3 条。",
    "",
    "已保留的可信候选：",
    candidateLines,
    "",
    "说明：系统已过滤聚合站、社交媒体、低质量 SEO 站、过期链接或无法确认的来源；请稍后重试，或指定 Reuters/AP/Bloomberg/FT/官方博客等来源后再查。",
  ].join("\n");
}

type NewsCandidate = {
  title: string;
  summary: string;
  url: string;
  hasExplicitRecencyEvidence: boolean;
};

const LOW_QUALITY_SOURCE_RE =
  /\/\/(?:www\.)?(?:youtube\.com|youtu\.be|reddit\.com|x\.com|twitter\.com|blog\.mean\.ceo|fazm\.ai|medium\.com|substack\.com|marketingprofs\.com|linkedin\.com|buildfastwithai\.com|launchpadagency\.com)\b/i;

const LOW_QUALITY_TITLE_RE =
  /\b(?:YouTube|Reddit|Substack)\b|what can we expect from AI in 2026|AI Will Hit a Wall|trends to watch in 2026|what's next in AI/i;

const BOILERPLATE_RE =
  /^(?:results\[|hint:|\[content compacted\]|Title:|URL Source:|Published Time:|Markdown Content:|Check out other fresh news|When your AI startup)/i;

function expandNewsEvidenceLines(contents: string[]): string[] {
  const lines: string[] = [];
  for (const content of contents) {
    lines.push(...extractFallbackLines(content));
    lines.push(
      ...content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 200),
    );
  }
  return lines;
}

function extractNewsCandidates(lines: string[], now?: Date): NewsCandidate[] {
  const candidates: NewsCandidate[] = [];
  const seen = new Set<string>();
  let currentSourceUrl: string | undefined;
  const cleanLines = lines
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    if (containsFailedEvidence(line)) continue;
    const sourceUrl = line.match(/^URL Source:\s*(https?:\/\/\S+)/i)?.[1];
    if (sourceUrl && isTrustedNewsSource(sourceUrl)) {
      currentSourceUrl = sourceUrl.replace(/[.,;:]+$/g, "");
    }
    if (BOILERPLATE_RE.test(line)) continue;
    const urlInLine = line.match(/https?:\/\/[^\s)>\]]+/)?.[0];
    let url = urlInLine;
    if (!url) {
      url = cleanLines
        .slice(i + 1, i + 3)
        .find((candidate) => /^https?:\/\//i.test(candidate));
    }
    if (!url && currentSourceUrl && isUsableNewsTitle(line)) {
      url = currentSourceUrl;
    }
    if (!url || LOW_QUALITY_SOURCE_RE.test(url)) continue;
    if (!isTrustedNewsSource(url)) continue;

    const withoutUrl = line.replace(url, "").trim();
    const parsed = splitTitleAndSummary(withoutUrl);
    if (!parsed.title) continue;
    if (!isUsableNewsTitle(parsed.title)) continue;
    if (LOW_QUALITY_TITLE_RE.test(parsed.title)) continue;
    const normalizedUrl = url.replace(/[.,;:]+$/g, "");
    const recency = getNewsRecency(line, normalizedUrl, now);
    if (!recency.isRecent) continue;
    const seenKey = `${normalizedUrl}::${parsed.title.toLowerCase()}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    candidates.push({
      title: parsed.title,
      summary: parsed.summary,
      url: normalizedUrl,
      hasExplicitRecencyEvidence: recency.hasExplicitDate,
    });
  }

  return candidates.slice(0, 20);
}

function isUsableNewsTitle(title: string): boolean {
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (cleaned.length < 12) return false;
  if (/^来源[:：]?$/i.test(cleaned)) return false;
  if (containsFailedEvidence(cleaned)) return false;
  if (/more a part of our lives than ever before|some might call it hype/i.test(cleaned)) {
    return false;
  }
  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\W]+$/u.test(cleaned)) {
    return false;
  }
  if (/^Artificial Intelligence$/i.test(cleaned)) return false;
  if (/^URL Source:/i.test(cleaned)) return false;
  return /AI|A\.I\.|artificial intelligence|OpenAI|Anthropic|Google|Microsoft|Meta|Nvidia|xAI|Grok|model|robot|data center|generative|Siri|Adobe|Fortnite|Musk|智能|模型|人工智能/i.test(
    cleaned,
  );
}

function containsFailedEvidence(text: string): boolean {
  return /Failed to fetch|Request timed out|0 results for|You have called .*limit|工具调用失败|抓取失败/i.test(
    text,
  );
}

function extractTrustedRecentUrls(text: string, now?: Date): string[] {
  const urls: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s)>\]]+/g)) {
    const url = match[0].replace(/[.,;:]+$/g, "");
    if (LOW_QUALITY_SOURCE_RE.test(url)) continue;
    if (!isTrustedNewsSource(url)) continue;
    if (!isRecentEnoughForNews(text, url, now)) continue;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

function splitTitleAndSummary(line: string): {
  title: string;
  summary: string;
} {
  const cleaned = line
    .replace(/\s+/g, " ")
    .replace(/^#+\s*/, "")
    .trim();
  const [rawTitle, ...rest] = cleaned.split(/\s+—\s+/);
  const title = rawTitle.trim().slice(0, 120);
  const summary = rest.join(" — ").trim().slice(0, 180);
  return { title, summary };
}

function isTrustedNewsSource(url: string): boolean {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }

  if (hostname.endsWith(".gov") || hostname.endsWith(".edu")) return true;
  if (hostname.endsWith(".europa.eu")) return true;
  if (hostname.startsWith("investors.")) return true;

  return TRUSTED_NEWS_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

const TRUSTED_NEWS_DOMAINS = [
  "reuters.com",
  "apnews.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "nytimes.com",
  "theverge.com",
  "techcrunch.com",
  "technologyreview.com",
  "wired.com",
  "openai.com",
  "anthropic.com",
  "googleblog.com",
  "blog.google",
  "deepmind.google",
  "microsoft.com",
  "meta.com",
  "about.fb.com",
  "nvidia.com",
  "stanford.edu",
  "mit.edu",
  "futureoflife.org",
];

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function isRecentEnoughForNews(
  line: string,
  url: string,
  now = new Date(),
): boolean {
  return getNewsRecency(line, url, now).isRecent;
}

function getNewsRecency(
  line: string,
  url: string,
  now = new Date(),
): { isRecent: boolean; hasExplicitDate: boolean } {
  const parsedFromText = parseNewsDate(line, now);
  const parsed = parsedFromText ? parsedFromText : parseNewsDateFromUrl(url);
  if (!parsed) return { isRecent: true, hasExplicitDate: false };
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ageDays = Math.floor(
    (nowDate.getTime() - parsed.getTime()) / (24 * 60 * 60 * 1000),
  );
  return { isRecent: ageDays >= 0 && ageDays <= 7, hasExplicitDate: true };
}

function parseNewsDateFromUrl(url: string): Date | null {
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  const slashDate = pathname.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/);
  if (slashDate) {
    return new Date(
      Number(slashDate[1]),
      Number(slashDate[2]) - 1,
      Number(slashDate[3]),
    );
  }

  const dashDate = pathname.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (dashDate) {
    return new Date(
      Number(dashDate[1]),
      Number(dashDate[2]) - 1,
      Number(dashDate[3]),
    );
  }

  return null;
}

function parseNewsDate(line: string, now: Date): Date | null {
  const iso = line.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    return new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
    );
  }

  const numeric = line.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (numeric) {
    return new Date(
      Number(numeric[3]),
      Number(numeric[1]) - 1,
      Number(numeric[2]),
    );
  }

  const named = line.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/i,
  );
  if (named) {
    return new Date(
      Number(named[3]),
      MONTH_INDEX[named[1].toLowerCase()],
      Number(named[2]),
    );
  }

  const monthOnly = line.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i,
  );
  if (monthOnly) {
    const month = MONTH_INDEX[monthOnly[1].toLowerCase()];
    const year = Number(monthOnly[2]);
    if (year === now.getFullYear() && month === now.getMonth()) return null;
    return new Date(year, month, 1);
  }

  return null;
}
