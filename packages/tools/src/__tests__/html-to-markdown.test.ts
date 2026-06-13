import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../html-to-markdown.js";

describe("htmlToMarkdown", () => {
  it("converts fallback HTML through one shared sanitizer and markdown pipeline", () => {
    const markdown = htmlToMarkdown(
      `<!doctype html>
      <html>
        <body>
          <script>window.secret = true</script>
          <style>body { color: red }</style>
          <nav>Navigation</nav>
          <header>Header chrome</header>
          <main><h1>Report</h1><p>Useful body.</p></main>
          <footer>Footer chrome</footer>
        </body>
      </html>`,
      {
        minArticleTextLength: 1_000,
        stripTags: ["script", "style", "nav", "header", "footer"],
      },
    );

    expect(markdown).toContain("# Report");
    expect(markdown).toContain("Useful body.");
    expect(markdown).not.toContain("window.secret");
    expect(markdown).not.toContain("Navigation");
    expect(markdown).not.toContain("Header chrome");
    expect(markdown).not.toContain("Footer chrome");
  });

  it("removes caller-provided markdown noise lines", () => {
    const markdown = htmlToMarkdown(
      `<main><h1>Article</h1><p>Don't miss what's happening</p><p>Real content.</p></main>`,
      {
        minArticleTextLength: 1_000,
        noisePatterns: [/^Don't miss what's happening$/i],
      },
    );

    expect(markdown).toContain("# Article");
    expect(markdown).toContain("Real content.");
    expect(markdown).not.toContain("Don't miss what's happening");
  });
});
