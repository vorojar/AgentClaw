import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractFileContent } from "../knowledge-preprocess.js";

describe("extractFileContent", () => {
  it("extracts HTML knowledge files through the shared markdown converter", async () => {
    const root = mkdtempSync(join(tmpdir(), "agentclaw-knowledge-html-"));
    const filePath = join(root, "article.html");
    writeFileSync(
      filePath,
      `<!doctype html>
      <html>
        <body>
          <script>window.secret = true</script>
          <style>body { color: red }</style>
          <header>Header chrome</header>
          <nav>Navigation</nav>
          <main><h1>Quarterly Report</h1><p>Useful knowledge content.</p></main>
          <footer>Footer chrome</footer>
        </body>
      </html>`,
      "utf-8",
    );

    const result = await extractFileContent(filePath, ".html");

    expect(result.error).toBeUndefined();
    expect(result.content).toContain("# Quarterly Report");
    expect(result.content).toContain("Useful knowledge content.");
    expect(result.content).not.toContain("window.secret");
    expect(result.content).not.toContain("Header chrome");
    expect(result.content).not.toContain("Navigation");
    expect(result.content).not.toContain("Footer chrome");
  });
});
