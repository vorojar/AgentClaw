import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext } from "@agentclaw/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: childProcessMock.execFile,
}));

import { webFetchTool } from "../builtin/web-fetch.js";

function response(
  body: string,
  contentType = "text/html; charset=utf-8",
): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

async function makeContext(): Promise<{
  workDir: string;
  sendFile: ReturnType<typeof vi.fn>;
  context: ToolExecutionContext;
}> {
  const workDir = await mkdtemp(join(tmpdir(), "agentclaw-web-fetch-"));
  const sendFile = vi.fn().mockResolvedValue(undefined);
  return { workDir, sendFile, context: { workDir, sendFile } };
}

describe("web_fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    childProcessMock.execFile.mockReset();
  });

  it("抓取微信公众号文章时应跳过 Jina 并保存本机直连提取的正文", async () => {
    const url = "https://mp.weixin.qq.com/s/UlXwNASDL2NU7Mjz-yy9lg";
    const nativeHtml = `
      <!doctype html>
      <html>
        <head><title>Weixin</title></head>
        <body>
          <h1 id="activity-name">测试公众号文章标题</h1>
          <div id="js_content">
            <p>这是微信正文第一段，用来验证工具保存的是原文内容。</p>
            <p>这是微信正文第二段，证明没有误用 Jina 的验证页。</p>
          </div>
        </body>
      </html>
    `;
    const jinaCaptcha = `
      Title: Weixin Official Accounts Platform
      Warning: This page maybe requiring CAPTCHA.

      ## 环境异常
      当前环境异常，完成验证后即可继续访问。
      [去验证](https://mp.weixin.qq.com/s/UlXwNASDL2NU7Mjz-yy9lg)
    `.repeat(4);
    const fetchMock = vi.fn(async (fetchUrl: string | URL | Request) => {
      const requested = String(fetchUrl);
      if (requested.startsWith("https://r.jina.ai/")) {
        return response(jinaCaptcha, "text/markdown; charset=utf-8");
      }
      return response(nativeHtml);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { workDir, sendFile, context } = await makeContext();
    const result = await webFetchTool.execute(
      { url, save_as: "article.md", auto_send: true, max_chars: 100_000 },
      context,
    );

    expect(result.isError).toBe(false);
    expect(
      fetchMock.mock.calls.some(([requested]) =>
        String(requested).startsWith("https://r.jina.ai/"),
      ),
    ).toBe(false);
    expect(result.metadata?.strategy).toBe("native");
    expect(sendFile).toHaveBeenCalledWith(join(workDir, "article.md"), "article.md");

    const saved = await readFile(join(workDir, "article.md"), "utf-8");
    expect(saved).toContain("测试公众号文章标题");
    expect(saved).toContain("这是微信正文第一段");
    expect(saved).toContain("这是微信正文第二段");
    expect(saved).not.toContain("环境异常");
  });

  it("最终内容是验证码或环境异常页时不应保存或自动发送文件", async () => {
    const url = "https://example.com/article";
    const verificationHtml = `
      <html>
        <body>
          <h1>环境异常</h1>
          <p>当前环境异常，完成验证后即可继续访问。</p>
          <a href="https://example.com/article">去验证</a>
        </body>
      </html>
    `;
    const fetchMock = vi.fn(async (fetchUrl: string | URL | Request) => {
      const requested = String(fetchUrl);
      if (requested.startsWith("https://r.jina.ai/")) {
        return response("too short", "text/markdown; charset=utf-8");
      }
      return response(verificationHtml);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { workDir, sendFile, context } = await makeContext();
    const result = await webFetchTool.execute(
      { url, save_as: "blocked.md", auto_send: true },
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("需要验证");
    expect(sendFile).not.toHaveBeenCalled();
    await expect(readFile(join(workDir, "blocked.md"), "utf-8")).rejects.toThrow();
  });

  it("本机直连超时时应尝试 Jina Reader fallback", async () => {
    const url = "https://www.theverge.com/ai-artificial-intelligence";
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const jinaMarkdown = `
      Title: Artificial Intelligence | The Verge
      URL Source: ${url}

      The Justice Department argues xAI's data center is necessary for national security.
      Anthropic and the US government are once again at odds over a model release.
    `;
    const fetchMock = vi.fn(async (fetchUrl: string | URL | Request) => {
      const requested = String(fetchUrl);
      if (requested.startsWith("https://r.jina.ai/")) {
        return response(jinaMarkdown, "text/markdown; charset=utf-8");
      }
      throw abortError;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await webFetchTool.execute({ url, max_chars: 4000 });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("The Justice Department argues");
    expect(result.metadata).toMatchObject({
      url,
      strategy: "jina",
      recoveredFrom: "native_timeout",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("本机直连 fetch failed 时也应尝试 Jina Reader fallback", async () => {
    const url = "https://techcrunch.com/category/artificial-intelligence/";
    const jinaMarkdown = `
      Title: AI News & Artificial Intelligence | TechCrunch
      URL Source: ${url}

      TechCrunch covers artificial intelligence startup funding and model releases.
    `;
    const fetchMock = vi.fn(async (fetchUrl: string | URL | Request) => {
      const requested = String(fetchUrl);
      if (requested.startsWith("https://r.jina.ai/")) {
        return response(jinaMarkdown, "text/markdown; charset=utf-8");
      }
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await webFetchTool.execute({ url, max_chars: 4000 });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("TechCrunch covers artificial intelligence");
    expect(result.metadata).toMatchObject({
      url,
      strategy: "jina",
      recoveredFrom: "native_fetch_error",
    });
  });

  it("Jina 返回验证页但本机直连正常时应回退保存本机正文", async () => {
    const url = "https://example.com/article";
    const nativeHtml = `
      <html>
        <body>
          <article>
            <h1>正常文章标题</h1>
            <p>这是一段来自本机直连 HTML 的有效正文。</p>
            <p>当 Jina 返回验证页时，工具应该使用这份正文。</p>
          </article>
        </body>
      </html>
    `;
    const verificationMarkdown = `
      Title: Weixin Official Accounts Platform
      Warning: This page maybe requiring CAPTCHA.

      ## 环境异常
      当前环境异常，完成验证后即可继续访问。
      [去验证](https://example.com/article)
    `.repeat(4);
    const fetchMock = vi.fn(async (fetchUrl: string | URL | Request) => {
      const requested = String(fetchUrl);
      if (requested.startsWith("https://r.jina.ai/")) {
        return response(verificationMarkdown, "text/markdown; charset=utf-8");
      }
      return response(nativeHtml);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { workDir, sendFile, context } = await makeContext();
    const result = await webFetchTool.execute(
      { url, save_as: "article.md", auto_send: true },
      context,
    );

    expect(result.isError).toBe(false);
    expect(result.metadata?.strategy).toBe("native");
    expect(sendFile).toHaveBeenCalledWith(join(workDir, "article.md"), "article.md");

    const saved = await readFile(join(workDir, "article.md"), "utf-8");
    expect(saved).toContain("正常文章标题");
    expect(saved).toContain("本机直连 HTML 的有效正文");
    expect(saved).not.toContain("当前环境异常");
  });

  it("抓取 X article URL 时应规范化为 status URL，避免保存 X 错误页", async () => {
    const articleUrl = "https://x.com/HiTw93/article/2034627967926825175";
    const statusUrl = "https://x.com/HiTw93/status/2034627967926825175";
    const xErrorPage = `
      Title: X. It’s what’s happening
      Something went wrong. Try reloading.
      Join today.
      Create account
      Sign in
    `;
    const articleMarkdown = `
      Title: Tw93 on X: "你不知道的 Agent：原理、架构与工程实践" / X
      URL Source: ${statusUrl}

      在写完「你不知道的 Claude Code：架构、治理与工程实践」之后，整理成了这篇文章。
      这篇文章主要讲 Agent 架构里几块最影响工程效果的内容。
    `;
    const fetchMock = vi.fn(async (fetchUrl: string | URL | Request) => {
      const requested = String(fetchUrl);
      if (requested === `https://r.jina.ai/${statusUrl}`) {
        return response(articleMarkdown, "text/markdown; charset=utf-8");
      }
      if (requested.startsWith("https://r.jina.ai/")) {
        return response(xErrorPage, "text/markdown; charset=utf-8");
      }
      return response(`<html><body>${xErrorPage}</body></html>`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { workDir, sendFile, context } = await makeContext();
    const result = await webFetchTool.execute(
      { url: articleUrl, save_as: "x-article.md", auto_send: true },
      context,
    );

    expect(result.isError).toBe(false);
    expect(result.metadata?.normalizedUrl).toBe(statusUrl);
    expect(sendFile).toHaveBeenCalledWith(join(workDir, "x-article.md"), "x-article.md");

    const saved = await readFile(join(workDir, "x-article.md"), "utf-8");
    expect(saved).toContain("你不知道的 Claude Code");
    expect(saved).not.toContain("Something went wrong");
    expect(saved).not.toContain("Join today");
  });

  it("最终内容是 X 错误登录页时不应保存或自动发送文件", async () => {
    const url = "https://x.com/HiTw93/status/2034627967926825175";
    const xErrorPage = `
      Title: X. It’s what’s happening
      Something went wrong. Try reloading.
      Happening now
      Join today.
      Create account
      Sign in
    `;
    const fetchMock = vi.fn(async () => response(xErrorPage, "text/markdown; charset=utf-8"));
    vi.stubGlobal("fetch", fetchMock);

    const { workDir, sendFile, context } = await makeContext();
    const result = await webFetchTool.execute(
      { url, save_as: "bad-x.md", auto_send: true },
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("需要验证或登录态");
    expect(sendFile).not.toHaveBeenCalled();
    await expect(readFile(join(workDir, "bad-x.md"), "utf-8")).rejects.toThrow();
  });

  it("抓取飞书文档时应跳过 Jina 并使用 Playwright 虚拟正文", async () => {
    const url = "https://presence.feishu.cn/wiki/wikcnva5WrD0F3HDh6U6EdW91OL";
    const nativeShell = `
      <html>
        <body>
          <main>
            <h1>👋十年创业者 万字长文分享 我是怎么招人的</h1>
            <p>rangeDom</p>
          </main>
          ${"<script>window.__app = true</script>".repeat(200)}
        </body>
      </html>
    `;
    const playwrightText = `
      # 👋十年创业者 万字长文分享 我是怎么招人的

      S级人才 心里有火，眼里有光，找方向、带队伍、闯出一片天。

      不用告诉他干啥，他来告诉你该干啥。

      群名片（登录后可查看）

      怎么样能变成和我一样人见人爱，人见人帮的吸贵人体质呢？
    `.repeat(8);
    childProcessMock.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, { stdout: playwrightText, stderr: "" });
      return {} as never;
    });
    const fetchMock = vi.fn(async (fetchUrl: string | URL | Request) => {
      const requested = String(fetchUrl);
      if (requested.startsWith("https://r.jina.ai/")) {
        return response("rangeDom\n目录\n不用告诉他干啥", "text/markdown; charset=utf-8");
      }
      return response(nativeShell);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { workDir, sendFile, context } = await makeContext();
    const result = await webFetchTool.execute(
      { url, save_as: "feishu.md", auto_send: true },
      context,
    );

    expect(result.isError).toBe(false);
    expect(
      fetchMock.mock.calls.some(([requested]) =>
        String(requested).startsWith("https://r.jina.ai/"),
      ),
    ).toBe(false);
    expect(result.metadata?.strategy).toBe("playwright");
    expect(sendFile).toHaveBeenCalledWith(join(workDir, "feishu.md"), "feishu.md");

    const saved = await readFile(join(workDir, "feishu.md"), "utf-8");
    expect(saved).toContain("不用告诉他干啥");
    expect(saved).toContain("群名片（登录后可查看）");
    expect(saved).toContain("怎么样能变成和我一样人见人爱");
    expect(saved).not.toContain("rangeDom");
  });
});
