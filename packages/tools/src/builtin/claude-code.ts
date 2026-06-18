import {
  spawn,
  execFileSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { join, dirname } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

/**
 * Resolve the absolute path to Claude Code's cli.js entry point.
 * On Windows, parses claude.cmd to find the cli.js path, then spawns
 * via process.execPath (Node itself) — no bash/cmd.exe dependency.
 * Returns undefined on non-Windows or if resolution fails.
 */
function findClaudeCliJs(): string | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    // Locate claude.cmd via the cached fast CLI probe.
    const cmdPath = findExecutable("claude");
    if (cmdPath && !cmdPath.endsWith(".cmd")) return undefined;
    if (!cmdPath) return undefined;

    // Parse cli.js path from claude.cmd content
    const content = readFileSync(cmdPath, "utf8");
    const match = content.match(
      /node_modules[\\/]@anthropic-ai[\\/]claude-code[\\/]cli\.js/,
    );
    if (!match) return undefined;

    const cliJs = join(dirname(cmdPath), match[0]).replace(/\\/g, "/");
    return existsSync(cliJs) ? cliJs : undefined;
  } catch {
    return undefined;
  }
}

function findClaudeNativeExe(): string | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    const cmdPath = findExecutable("claude");
    if (!cmdPath) return undefined;
    if (cmdPath.toLowerCase().endsWith(".exe")) return cmdPath;
    if (!cmdPath.toLowerCase().endsWith(".cmd")) return undefined;

    const content = readFileSync(cmdPath, "utf8");
    const dp0Match = content.match(
      /"%dp0%\\([^"]*node_modules\\@anthropic-ai\\claude-code\\bin\\claude\.exe)"/i,
    );
    if (dp0Match) {
      const exePath = join(dirname(cmdPath), dp0Match[1]);
      return existsSync(exePath) ? resolveWindowsRealPath(exePath) : undefined;
    }

    const absoluteMatch = content.match(
      /"([A-Z]:\\[^"]*node_modules\\@anthropic-ai\\claude-code\\bin\\claude\.exe)"/i,
    );
    if (absoluteMatch) {
      return existsSync(absoluteMatch[1])
        ? resolveWindowsRealPath(absoluteMatch[1])
        : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function findCodexCliJs(): string | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    const cmdPath = execFileSync("where", ["codex"], {
      timeout: CLI_CHECK_TIMEOUT,
      encoding: "utf8",
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)
      .find((line) => line.endsWith(".cmd"));
    if (!cmdPath) return undefined;

    const content = readFileSync(cmdPath, "utf8");
    const match = content.match(
      /node_modules[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.js/,
    );
    if (!match) return undefined;

    const cliJs = join(dirname(cmdPath), match[0]).replace(/\\/g, "/");
    return existsSync(cliJs) ? cliJs : undefined;
  } catch {
    return undefined;
  }
}

const CLI_CHECK_TIMEOUT = 1_500;

const cliPathCache = new Map<string, string | null>();

function findExecutable(command: string): string | undefined {
  if (cliPathCache.has(command)) {
    return cliPathCache.get(command) ?? undefined;
  }

  try {
    const locator = process.platform === "win32" ? "where" : "which";
    const candidates = execFileSync(locator, [command], {
      timeout: CLI_CHECK_TIMEOUT,
      encoding: "utf8",
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    const resolved = candidates
      .map((candidate) => resolveExecutablePath(candidate))
      .filter((candidate): candidate is string => !!candidate);
    const found =
      (process.platform === "win32"
        ? resolved.find((candidate) => candidate.toLowerCase().endsWith(".exe"))
        : undefined) ??
      resolved[0] ??
      "";
    cliPathCache.set(command, found || null);
    return found || undefined;
  } catch {
    cliPathCache.set(command, null);
    return undefined;
  }
}

function resolveExecutablePath(candidate: string): string | undefined {
  if (process.platform !== "win32") {
    return candidate;
  }
  const resolvedCandidate = resolveWindowsRealPath(candidate);
  if (/\.(cmd|exe|bat)$/i.test(candidate)) {
    return resolvedCandidate;
  }
  for (const ext of [".exe", ".cmd", ".bat"]) {
    const withExt = `${candidate}${ext}`;
    if (existsSync(withExt)) return resolveWindowsRealPath(withExt);
  }
  if (existsSync(candidate) && candidate.toLowerCase().endsWith(".exe")) {
    return resolvedCandidate;
  }
  return undefined;
}

function resolveWindowsRealPath(candidate: string): string {
  try {
    return realpathSync.native(candidate);
  } catch {
    return candidate;
  }
}

function findNodeForCliJs(): string {
  const currentNode =
    process.platform === "win32"
      ? resolveWindowsRealPath(process.execPath)
      : process.execPath;
  if (existsSync(currentNode)) {
    return currentNode.replace(/\\/g, "/");
  }

  const nodeFromPath = findExecutable("node");
  if (nodeFromPath) {
    return nodeFromPath.replace(/\\/g, "/");
  }

  return process.execPath.replace(/\\/g, "/");
}

function isCliUnavailableResult(result: ToolResult): boolean {
  if (!result.isError) return false;
  if (result.metadata?.unavailable === true) return true;
  return /ENOENT|not found|could not find|cannot find|无法启动|无法找到/i.test(
    result.content,
  );
}

function unavailableResult(toolName: string, reason: string): ToolResult {
  return {
    content: `${toolName} 不可用：${reason}`,
    isError: true,
    metadata: { unavailable: true, transport: toolName.toLowerCase() },
  };
}

function externalAgentsUnavailable(
  claudeResult: ToolResult,
  codexResult: ToolResult,
): ToolResult {
  return {
    content:
      "外部委托工具不可用：Claude Code 与 Codex 都无法启动。\n" +
      `- Claude Code: ${claudeResult.content}\n` +
      `- Codex: ${codexResult.content}\n` +
      "请安装并登录至少一个 CLI 后重试；本轮任务已停止，避免继续空转。",
    isError: true,
    metadata: {
      terminal: true,
      reason: "delegate_unavailable",
      claudeError: claudeResult.content,
      codexError: codexResult.content,
    },
  };
}

const DEFAULT_TIMEOUT = 600_000; // 10 minutes
const DEFAULT_OUTPUT_DIR = join(process.cwd(), "data", "tmp").replace(
  /\\/g,
  "/",
);

// ─── Session pool for SDK mode ─────────────────────────────────────
// Maps AgentClaw sessionId → Claude Code sessionId for context continuity.
// Idle sessions auto-expire after 10 minutes.

const SESSION_IDLE_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 5;
const sessionPool = new Map<
  string,
  { claudeSessionId: string; lastUsed: number }
>();

function getPooledSession(key: string): string | undefined {
  const entry = sessionPool.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.lastUsed > SESSION_IDLE_MS) {
    sessionPool.delete(key);
    return undefined;
  }
  entry.lastUsed = Date.now();
  return entry.claudeSessionId;
}

function setPooledSession(key: string, claudeSessionId: string): void {
  // Evict oldest if at capacity
  if (sessionPool.size >= MAX_SESSIONS && !sessionPool.has(key)) {
    let oldestKey = "";
    let oldestTime = Infinity;
    for (const [k, v] of sessionPool) {
      if (v.lastUsed < oldestTime) {
        oldestTime = v.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey) sessionPool.delete(oldestKey);
  }
  sessionPool.set(key, { claudeSessionId, lastUsed: Date.now() });
}

// ─── SDK mode (preferred) ──────────────────────────────────────────

let sdkAvailable: boolean | null = null; // null = not checked yet

async function runClaudeSDK(
  prompt: string,
  cwd: string | undefined,
  timeout: number,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  // Dynamic import — only loaded when actually used
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const outputDir = (context?.workDir ?? DEFAULT_OUTPUT_DIR).replace(
    /\\/g,
    "/",
  );
  const fullPrompt = `${prompt}\n\nIMPORTANT: All generated output files MUST be saved to ${outputDir}/ directory. Never save files to the project root or other locations.`;

  const abortController = new AbortController();
  let aborted = false;

  // Wire abort signal
  if (context?.abortSignal) {
    const onAbort = () => {
      aborted = true;
      abortController.abort();
    };
    if (context.abortSignal.aborted) {
      onAbort();
    } else {
      context.abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  // Timeout
  const timer = setTimeout(() => abortController.abort(), timeout);

  // Session continuity: resume if same AgentClaw session
  const sessionKey = context?.workDir || "default";
  const resumeId = getPooledSession(sessionKey);

  const notify = context?.notifyUser;
  let resultSummary = "";
  let toolCallCount = 0;
  const filesChanged: string[] = [];
  let claudeSessionId = "";

  try {
    const q = query({
      prompt: fullPrompt,
      options: {
        cwd: cwd || process.cwd(),
        abortController,
        ...(resumeId ? { resume: resumeId } : {}),
        allowedTools: [
          "Bash",
          "Read",
          "Write",
          "Edit",
          "Glob",
          "Grep",
          "NotebookEdit",
          "Agent",
        ],
        maxTurns: 50,
      },
    });

    for await (const evt of q) {
      if (aborted) break;

      if (evt.type === "assistant" && evt.message?.content) {
        claudeSessionId = evt.session_id;
        for (const block of evt.message.content) {
          if (block.type === "tool_use") {
            toolCallCount++;
            const name = block.name as string;
            if (
              name === "Edit" ||
              name === "Write" ||
              name === "NotebookEdit"
            ) {
              const path =
                (block.input as Record<string, string>)?.file_path ||
                (block.input as Record<string, string>)?.notebook_path ||
                "";
              if (path && !filesChanged.includes(path)) filesChanged.push(path);
              notify?.(`✏️ ${name}: ${path}`).catch(() => {});
            } else if (name === "Read") {
              notify?.(
                `📖 Read: ${(block.input as Record<string, string>)?.file_path ?? ""}`,
              ).catch(() => {});
            } else if (name === "Bash") {
              const cmd = String(
                (block.input as Record<string, string>)?.command ?? "",
              ).slice(0, 80);
              notify?.(`🔧 Bash: ${cmd}`).catch(() => {});
            } else if (name === "Grep" || name === "Glob") {
              notify?.(
                `🔍 ${name}: ${(block.input as Record<string, string>)?.pattern ?? ""}`,
              ).catch(() => {});
            } else {
              notify?.(`⚙️ ${name}`).catch(() => {});
            }
          } else if (block.type === "text" && block.text) {
            const firstLine = block.text.split("\n")[0].slice(0, 120);
            if (firstLine) notify?.(`💭 ${firstLine}`).catch(() => {});
          }
        }
      } else if (evt.type === "result") {
        const r = evt as { result?: string };
        resultSummary = r.result || "";
      }
    }
  } catch (err) {
    if (aborted) {
      return {
        content: "Claude Code task aborted by user.",
        isError: true,
        metadata: { aborted: true },
      };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  // Save session for continuity
  if (claudeSessionId) {
    setPooledSession(sessionKey, claudeSessionId);
  }

  // Auto-send output files
  const sendFile = context?.sendFile;
  if (sendFile && filesChanged.length > 0) {
    const outputRe = /[/\\]data[/\\]tmp[/\\]/i;
    for (const f of filesChanged) {
      if (outputRe.test(f)) {
        try {
          await sendFile(f);
        } catch {
          /* ignore */
        }
      }
    }
  }

  const parts = [`Claude Code completed (${toolCallCount} tool calls).`];
  if (filesChanged.length > 0)
    parts.push(`Files changed: ${filesChanged.join(", ")}`);
  if (resultSummary) {
    parts.push(
      resultSummary.length > 500
        ? `${resultSummary.slice(0, 500)}...`
        : resultSummary,
    );
  }

  return {
    content: parts.join("\n"),
    isError: false,
    metadata: { exitCode: 0, toolCallCount, transport: "sdk" },
  };
}

// ─── CLI mode (fallback) ───────────────────────────────────────────

async function runClaudeCLI(
  prompt: string,
  cwd: string | undefined,
  timeout: number,
  context?: ToolExecutionContext,
  maxResultChars = 500,
): Promise<ToolResult> {
  const outputDir = (context?.workDir ?? DEFAULT_OUTPUT_DIR).replace(
    /\\/g,
    "/",
  );
  const args = [
    "-p",
    "--dangerously-skip-permissions",
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  // On Windows, spawn Node directly with cli.js — no bash/cmd.exe dependency.
  // Both bash and cmd.exe are intermittently unreachable from Start-Process contexts.
  // process.execPath (the running Node binary) is always available.
  // CRITICAL: process.execPath returns backslash path on Windows which can
  // ENOENT in spawn(). Must normalize to forward slashes.
  const cliJs = findClaudeCliJs();
  const nativeExe = cliJs ? undefined : findClaudeNativeExe();
  const spawnCmd = cliJs
    ? findNodeForCliJs()
    : (nativeExe ?? findExecutable("claude") ?? "claude");
  const spawnArgs = cliJs ? [cliJs, ...args] : args;

  return new Promise<ToolResult>((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(spawnCmd, spawnArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout,
        cwd: cwd || process.cwd(),
        env: { ...process.env, CLAUDECODE: undefined },
        windowsHide: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resolve({
        content: `Failed to spawn claude CLI: ${msg}`,
        isError: true,
        metadata: { unavailable: true, transport: "claude-cli" },
      });
      return;
    }

    let resultSummary = "";
    let toolCallCount = 0;
    const filesChanged: string[] = [];
    let aborted = false;

    if (context?.abortSignal) {
      const killChild = () => {
        aborted = true;
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
            windowsHide: true,
            stdio: "ignore",
          });
        } else {
          child.kill();
        }
      };
      if (context.abortSignal.aborted) {
        killChild();
      } else {
        context.abortSignal.addEventListener("abort", killChild, {
          once: true,
        });
        child.on("close", () =>
          context.abortSignal!.removeEventListener("abort", killChild),
        );
      }
    }

    const notify = context?.notifyUser;
    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const evt = JSON.parse(line);
        if (evt.type === "assistant" && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === "tool_use") {
              toolCallCount++;
              const name = block.name as string;
              if (
                name === "Edit" ||
                name === "Write" ||
                name === "NotebookEdit"
              ) {
                const path =
                  block.input?.file_path || block.input?.notebook_path || "";
                if (path && !filesChanged.includes(path))
                  filesChanged.push(path);
                notify?.(`✏️ ${name}: ${path}`).catch(() => {});
              } else if (name === "Read") {
                notify?.(`📖 Read: ${block.input?.file_path ?? ""}`).catch(
                  () => {},
                );
              } else if (name === "Bash") {
                notify?.(
                  `🔧 Bash: ${String(block.input?.command ?? "").slice(0, 80)}`,
                ).catch(() => {});
              } else if (name === "Grep" || name === "Glob") {
                notify?.(`🔍 ${name}: ${block.input?.pattern ?? ""}`).catch(
                  () => {},
                );
              } else {
                notify?.(`⚙️ ${name}`).catch(() => {});
              }
            } else if (block.type === "text" && block.text) {
              const firstLine = block.text.split("\n")[0].slice(0, 120);
              if (firstLine) notify?.(`💭 ${firstLine}`).catch(() => {});
            }
          }
        } else if (evt.type === "result") {
          resultSummary = evt.result || "";
        }
      } catch {
        /* non-JSON */
      }
    });

    const MAX_STDERR = 64 * 1024; // 64KB cap to prevent OOM
    let stderrBuf = "";
    child.stderr?.on("data", (data: Buffer) => {
      if (stderrBuf.length >= MAX_STDERR) return;
      const chunk = data.toString();
      const remaining = MAX_STDERR - stderrBuf.length;
      if (chunk.length > remaining) {
        stderrBuf += chunk.slice(0, remaining) + "\n...(truncated)";
      } else {
        stderrBuf += chunk;
      }
    });

    child.stdin!.write(
      `${prompt}\n\nIMPORTANT: All generated output files MUST be saved to ${outputDir}/ directory. Never save files to the project root or other locations.`,
    );
    child.stdin!.end();

    child.on("close", async (code) => {
      if (aborted) {
        resolve({
          content: "Claude Code task aborted by user.",
          isError: true,
          metadata: { aborted: true },
        });
        return;
      }
      if (code !== 0 && code !== null && !resultSummary) {
        resolve({
          content: stderrBuf || `Claude Code exited with code ${code}`,
          isError: true,
          metadata: { exitCode: code },
        });
        return;
      }
      const sendFile = context?.sendFile;
      if (sendFile && filesChanged.length > 0) {
        const outputRe = /[/\\]data[/\\]tmp[/\\]/i;
        for (const f of filesChanged) {
          if (outputRe.test(f)) {
            try {
              await sendFile(f);
            } catch {
              /* ignore */
            }
          }
        }
      }
      const parts = [`Claude Code completed (${toolCallCount} tool calls).`];
      if (filesChanged.length > 0)
        parts.push(`Files changed: ${filesChanged.join(", ")}`);
      if (resultSummary)
        parts.push(
          maxResultChars > 0 && resultSummary.length > maxResultChars
            ? `${resultSummary.slice(0, maxResultChars)}...`
            : resultSummary,
        );
      resolve({
        content: parts.join("\n"),
        isError: false,
        metadata: { exitCode: 0, toolCallCount, transport: "cli" },
      });
    });

    child.on("error", (err) => {
      resolve({
        content: `Failed to spawn claude CLI: ${err.message}\nClaude Code is temporarily unavailable. Tell the user that claude_code failed to start and they may need to retry. Do NOT attempt to find or run scripts as a workaround.`,
        isError: true,
        metadata: { unavailable: true, transport: "claude-cli" },
      });
    });
  });
}

async function runCodexCLI(
  prompt: string,
  cwd: string | undefined,
  timeout: number,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const codexCliJs = findCodexCliJs();
  const codexPath = codexCliJs ? findNodeForCliJs() : findExecutable("codex");
  if (!codexPath) {
    return unavailableResult("Codex", "未找到 codex CLI");
  }

  const workingDir = cwd || process.cwd();
  const outputDir = (context?.workDir ?? DEFAULT_OUTPUT_DIR).replace(
    /\\/g,
    "/",
  );
  const args = [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
    "-C",
    workingDir,
    "-",
  ];
  const spawnArgs = codexCliJs ? [codexCliJs, ...args] : args;
  const fullPrompt =
    `${prompt}\n\nIMPORTANT: All generated output files MUST be saved to ${outputDir}/ directory. ` +
    "Never save files to the project root or other locations.";

  return new Promise<ToolResult>((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(codexPath, spawnArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout,
        cwd: workingDir,
        env: { ...process.env },
        windowsHide: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resolve({
        content: `Failed to spawn Codex CLI: ${msg}`,
        isError: true,
        metadata: { unavailable: true, transport: "codex" },
      });
      return;
    }

    let stdoutBuf = "";
    let stderrBuf = "";
    let lastMessage = "";
    let aborted = false;

    if (context?.abortSignal) {
      const killChild = () => {
        aborted = true;
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
            windowsHide: true,
            stdio: "ignore",
          });
        } else {
          child.kill();
        }
      };
      if (context.abortSignal.aborted) {
        killChild();
      } else {
        context.abortSignal.addEventListener("abort", killChild, {
          once: true,
        });
        child.on("close", () =>
          context.abortSignal!.removeEventListener("abort", killChild),
        );
      }
    }

    const notify = context?.notifyUser;
    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      stdoutBuf += `${line}\n`;
      try {
        const evt = JSON.parse(line) as Record<string, unknown>;
        const text = extractCodexMessage(evt);
        if (text) {
          lastMessage = text;
          notify?.(`Codex: ${text.split("\n")[0].slice(0, 120)}`).catch(
            () => {},
          );
        }
      } catch {
        lastMessage = line;
      }
    });

    const MAX_STDERR = 64 * 1024;
    child.stderr?.on("data", (data: Buffer) => {
      if (stderrBuf.length >= MAX_STDERR) return;
      const chunk = data.toString();
      const remaining = MAX_STDERR - stderrBuf.length;
      stderrBuf += chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
    });

    child.stdin!.write(fullPrompt);
    child.stdin!.end();

    child.on("close", (code) => {
      if (aborted) {
        resolve({
          content: "Codex task aborted by user.",
          isError: true,
          metadata: { aborted: true, transport: "codex" },
        });
        return;
      }
      if (code !== 0 && code !== null) {
        resolve({
          content: stderrBuf || `Codex exited with code ${code}`,
          isError: true,
          metadata: { exitCode: code, transport: "codex" },
        });
        return;
      }
      const summary = lastMessage || stdoutBuf.trim() || "Codex completed.";
      resolve({
        content: `Codex completed.\n${
          summary.length > 2_000 ? `${summary.slice(0, 2_000)}...` : summary
        }`,
        isError: false,
        metadata: { exitCode: 0, transport: "codex" },
      });
    });

    child.on("error", (err) => {
      resolve({
        content: `Failed to spawn Codex CLI: ${err.message}`,
        isError: true,
        metadata: { unavailable: true, transport: "codex" },
      });
    });
  });
}

function extractCodexMessage(evt: Record<string, unknown>): string {
  if (typeof evt.message === "string") return evt.message;
  if (typeof evt.text === "string") return evt.text;
  const item = evt.item as Record<string, unknown> | undefined;
  if (item && typeof item.text === "string") return item.text;
  if (item && Array.isArray(item.content)) {
    const texts = item.content
      .map((part) => {
        if (
          part &&
          typeof part === "object" &&
          typeof (part as Record<string, unknown>).text === "string"
        ) {
          return (part as Record<string, string>).text;
        }
        return "";
      })
      .filter(Boolean);
    if (texts.length > 0) return texts.join("\n");
  }
  return "";
}

// ─── Tool definition ───────────────────────────────────────────────

export const claudeCodeTool: Tool = {
  name: "claude_code",
  description:
    "Delegate a coding task to Claude Code. It can read/write files, run shell commands, and make complex code changes autonomously. Use for: code generation, bug fixing, refactoring, project scaffolding, and any task that benefits from full codebase access. Supports session continuity — multiple calls within the same conversation share context.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The coding task or question for Claude Code.",
      },
      cwd: {
        type: "string",
        description:
          "Working directory for Claude Code. Defaults to current project root.",
      },
      timeout: {
        type: "number",
        description: `Timeout in ms. Default ${DEFAULT_TIMEOUT / 1000}s.`,
        default: DEFAULT_TIMEOUT,
      },
      max_result_chars: {
        type: "number",
        description:
          "Maximum final text chars returned from Claude Code CLI. Default 500; use a larger value when the caller needs the full report inline.",
        default: 500,
      },
    },
    required: ["prompt"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const prompt = input.prompt as string;
    const cwd = input.cwd as string | undefined;
    let timeout = (input.timeout as number) ?? DEFAULT_TIMEOUT;
    const maxResultChars = (input.max_result_chars as number | undefined) ?? 500;
    if (timeout > 0 && timeout < 1000) timeout *= 1000;

    const claudeAvailable = !!findClaudeCliJs() || !!findExecutable("claude");
    let claudeFailure: ToolResult | undefined;

    if (claudeAvailable && sdkAvailable === true) {
      try {
        const result = await runClaudeSDK(prompt, cwd, timeout, context);
        sdkAvailable = true;
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        claudeFailure = unavailableResult("Claude Code SDK", msg);
        console.log(
          `[claude_code] SDK mode failed: ${msg}, falling back to CLI`,
        );
        if (
          msg.includes("Cannot find module") ||
          msg.includes("ERR_MODULE_NOT_FOUND")
        ) {
          sdkAvailable = false;
        }
      }
    } else if (!claudeAvailable) {
      claudeFailure = unavailableResult("Claude Code", "未找到 claude CLI");
    }

    if (claudeAvailable) {
      const result = await runClaudeCLI(
        prompt,
        cwd,
        timeout,
        context,
        maxResultChars,
      );
      if (!result.isError) {
        return result;
      }
      claudeFailure = result;
      if (!isCliUnavailableResult(result)) {
        return result;
      }
    }

    const codexResult = await runCodexCLI(prompt, cwd, timeout, context);
    if (!codexResult.isError) {
      return codexResult;
    }
    if (!isCliUnavailableResult(codexResult)) {
      return codexResult;
    }

    return externalAgentsUnavailable(
      claudeFailure ?? unavailableResult("Claude Code", "不可用"),
      codexResult,
    );
  },
};
