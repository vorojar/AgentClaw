import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

const DEFAULT_STRIP_TAGS = ["script", "style", "nav"] as const;

export interface HtmlToMarkdownOptions {
  noisePatterns?: readonly RegExp[];
  stripTags?: readonly string[];
  charThreshold?: number;
  minArticleTextLength?: number;
}

export function cleanMarkdown(
  md: string,
  options: Pick<HtmlToMarkdownOptions, "noisePatterns"> = {},
): string {
  const noisePatterns = options.noisePatterns ?? [];
  return md
    .split("\n")
    .filter((line) => !noisePatterns.some((p) => p.test(line.trim())))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlFragmentToMarkdown(
  html: string,
  options: Pick<HtmlToMarkdownOptions, "noisePatterns"> = {},
): string {
  return cleanMarkdown(turndown.turndown(html), options);
}

export function htmlToMarkdown(
  html: string,
  options: HtmlToMarkdownOptions = {},
): string {
  const charThreshold = options.charThreshold ?? 100;
  const minArticleTextLength = options.minArticleTextLength ?? 200;

  try {
    const { document } = parseHTML(html);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new Readability(document as any, { charThreshold });
    const article = reader.parse();
    if (
      article?.content &&
      (article.textContent?.length ?? 0) > minArticleTextLength
    ) {
      const title = article.title ? `# ${article.title}\n\n` : "";
      return cleanMarkdown(title + turndown.turndown(article.content), options);
    }
  } catch {
    // Readability failed; fall back to full-page conversion below.
  }

  const strippedHtml = stripTags(html, options.stripTags ?? DEFAULT_STRIP_TAGS);
  return htmlFragmentToMarkdown(strippedHtml, options);
}

function stripTags(html: string, tags: readonly string[]): string {
  let result = html;
  for (const tag of tags) {
    result = result.replace(
      new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, "gi"),
      "",
    );
  }
  return result;
}
