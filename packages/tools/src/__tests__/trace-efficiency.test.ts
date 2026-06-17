import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileReadTool } from "../builtin/file-read.js";
import { grepTool } from "../builtin/grep.js";
import { sendFileTool } from "../builtin/send-file.js";
import { webFetchTool } from "../builtin/web-fetch.js";
import { setSearchEngines, webSearchTool } from "../builtin/web-search.js";

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentclaw-tools-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  setSearchEngines([]);
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("trace efficiency tool behavior", () => {
  it("returns only a bounded preview when reading an overflow file without a range", async () => {
    const dir = await makeTmpDir();
    const path = join(dir, "overflow_execute_code_123.txt");
    await writeFile(path, "a".repeat(12_000), "utf-8");

    const result = await fileReadTool.execute({ path });

    expect(result.isError).toBe(false);
    expect(result.content.length).toBeLessThan(2_500);
    expect(result.content).toContain("overflow file preview");
    expect(result.metadata).toMatchObject({
      overflowPreview: true,
      originalLength: 12_000,
    });
  });

  it("supports bounded range reads for overflow files", async () => {
    const dir = await makeTmpDir();
    const path = join(dir, "overflow_execute_code_456.txt");
    await writeFile(path, `${"a".repeat(100)}TARGET${"b".repeat(100)}`, "utf-8");

    const result = await fileReadTool.execute({ path, offset: 95, length: 20 });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("TARGET");
    expect(result.content.length).toBeLessThan(400);
    expect(result.metadata).toMatchObject({
      overflowRange: true,
      offset: 95,
      length: 20,
    });
  });

  it("supports line-centered reads for grep match line numbers", async () => {
    const dir = await makeTmpDir();
    const path = join(dir, "source.ts");
    await writeFile(
      path,
      ["one", "two", "three", "target", "five", "six"].join("\n"),
      "utf-8",
    );

    const result = await fileReadTool.execute({
      path,
      line: 4,
      context_lines: 1,
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("  3 | three");
    expect(result.content).toContain("> 4 | target");
    expect(result.content).toContain("  5 | five");
    expect(result.content).not.toContain("one");
    expect(result.metadata).toMatchObject({
      path,
      line: 4,
      contextLines: 1,
    });
  });

  it("grep hint should point to line reads, not character offsets", async () => {
    const dir = await makeTmpDir();
    const path = join(dir, "source.ts");
    await writeFile(path, "const target = true;\n", "utf-8");

    const result = await grepTool.execute({ path, pattern: "target" });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('"line": <match line>');
    expect(result.content).not.toContain("file_read(path, offset)");
  });

  it("reports original and effective paths when send_file relocates a file", async () => {
    const sourceDir = await makeTmpDir();
    const workDir = await makeTmpDir();
    const sourcePath = join(sourceDir, "daily.md");
    await writeFile(sourcePath, "# daily", "utf-8");
    const sendFile = vi.fn().mockResolvedValue(undefined);

    const result = await sendFileTool.execute(
      { path: sourcePath, caption: "daily" },
      { workDir, sendFile },
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("original=");
    expect(result.content).toContain("effective=");
    expect(result.metadata).toMatchObject({
      originalPath: sourcePath,
      relocated: true,
    });
    expect(sendFile).toHaveBeenCalledWith(join(workDir, "daily.md"), "daily");
  });

  it("does not mark an absolute file inside workDir as relocated", async () => {
    const workDir = await makeTmpDir();
    const sourcePath = join(workDir, "already-there.md");
    await writeFile(sourcePath, "# daily", "utf-8");
    const sendFile = vi.fn().mockResolvedValue(undefined);

    const result = await sendFileTool.execute(
      { path: sourcePath, caption: "daily" },
      { workDir, sendFile },
    );

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      originalPath: sourcePath,
      effectivePath: sourcePath,
      relocated: false,
    });
    expect(sendFile).toHaveBeenCalledWith(sourcePath, "daily");
  });

  it("does not append human guidance to JSON responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => '{"ok":true}',
    } as Response);

    const result = await webFetchTool.execute({ url: "https://example.com/data.json" });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toEqual({ ok: true });
    expect(result.content).not.toContain("hint:");
  });

  it("compacts long fetched pages into a bounded source card by default", async () => {
    const body = `
      <html>
        <head><title>AI infrastructure update</title></head>
        <body>
          <article>
            <h1>AI infrastructure update</h1>
            <p>Published Time: 2026-05-03</p>
            <p>${"OpenAI expands compute capacity. ".repeat(180)}</p>
            <p>${"Nvidia and AMD supply accelerators. ".repeat(180)}</p>
          </article>
        </body>
      </html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => body,
    } as Response);

    const result = await webFetchTool.execute({
      url: "https://example.com/ai",
    });

    expect(result.isError).toBe(false);
    expect(result.content.length).toBeLessThan(4_500);
    expect(result.content).toContain("URL Source: https://example.com/ai");
    expect(result.content).toContain("AI infrastructure update");
    expect(result.content).toContain("[content compacted]");
    expect(result.metadata).toMatchObject({
      compacted: true,
      url: "https://example.com/ai",
    });
  });

  it("clamps web_search result count to keep snippets bounded", async () => {
    setSearchEngines([
      {
        id: "local",
        type: "searxng",
        enabled: true,
        url: "https://search.example",
      },
    ]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: Array.from({ length: 8 }, (_, i) => ({
          title: `Result ${i + 1}`,
          url: `https://example.com/${i + 1}`,
          content: "snippet ".repeat(30),
        })),
      }),
      headers: new Headers({ "content-type": "application/json" }),
    } as Response);

    const result = await webSearchTool.execute({
      query: "ai news",
      max_results: 8,
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("results[5]");
    expect(result.content).toContain("Result 5");
    expect(result.content).not.toContain("Result 6");
    expect(result.metadata).toMatchObject({ maxResults: 5 });
  });

  it("retries a broader query before returning a zero-result web_search failure", async () => {
    setSearchEngines([
      {
        id: "local",
        type: "searxng",
        enabled: true,
        url: "https://search.example",
      },
    ]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (url: string | URL | Request) => {
        const requested = String(url);
        if (requested.includes("site%3Atechcrunch.com")) {
          return {
            ok: true,
            json: async () => ({ results: [] }),
            headers: new Headers({ "content-type": "application/json" }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                title: "TechCrunch AI News",
                url: "https://techcrunch.com/category/artificial-intelligence/",
                content: "AI coverage and latest startup news.",
              },
            ],
          }),
          headers: new Headers({ "content-type": "application/json" }),
        } as Response;
      },
    );

    const result = await webSearchTool.execute({
      query: "site:techcrunch.com AI artificial intelligence 2026",
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("TechCrunch AI News");
    expect(result.metadata).toMatchObject({
      query: "site:techcrunch.com AI artificial intelligence 2026",
      effectiveQuery: "techcrunch.com AI artificial intelligence 2026",
      attemptedQueries: [
        "site:techcrunch.com AI artificial intelligence 2026",
        "techcrunch.com AI artificial intelligence 2026",
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks web_search zero results as an error when all query variants are empty", async () => {
    setSearchEngines([
      {
        id: "local",
        type: "searxng",
        enabled: true,
        url: "https://search.example",
      },
    ]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
      headers: new Headers({ "content-type": "application/json" }),
    } as Response);

    const result = await webSearchTool.execute({
      query: "nonexistent exact query 2026-06-17",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("0 results");
    expect(result.metadata).toMatchObject({ zeroResults: true });
  });
});
