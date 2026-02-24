import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

const DEFAULT_TIMEOUT = 600_000; // 10 minutes — coding tasks are long

/**
 * Spawn `claude` CLI in print mode with stream-json output.
 * Parses each JSON line and forwards text/tool events to the user via notifyUser.
 */
async function runClaudeCode(
  prompt: string,
  cwd: string | undefined,
  timeout: number,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const args = [
    "-p",
    "--dangerously-skip-permissions",
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  return new Promise<ToolResult>((resolve) => {
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
      cwd: cwd || process.cwd(),
      env: { ...process.env },
      shell: process.platform === "win32",
    });

    const chunks: string[] = [];
    let lastNotify = 0;
    const NOTIFY_INTERVAL = 2000; // throttle notifications to 2s

    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const evt = JSON.parse(line);
        // stream-json emits: {type:"assistant", message:{content:[{type:"text",text:"..."}]}}
        //                    {type:"result", result:"...", cost:..., duration_ms:...}
        if (evt.type === "assistant" && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === "text" && block.text) {
              chunks.push(block.text);
              // Throttled live notification to user
              const now = Date.now();
              if (context?.notifyUser && now - lastNotify > NOTIFY_INTERVAL) {
                lastNotify = now;
                context
                  .notifyUser(`[Claude Code] ${block.text.slice(0, 200)}`)
                  .catch(() => {});
              }
            }
          }
        } else if (evt.type === "result") {
          if (evt.result) chunks.push(evt.result);
        }
      } catch {
        // non-JSON line — ignore
      }
    });

    let stderrBuf = "";
    child.stderr?.on("data", (data: Buffer) => {
      stderrBuf += data.toString();
    });

    // Write prompt to stdin and close
    child.stdin!.write(prompt);
    child.stdin!.end();

    child.on("close", (code) => {
      const output = chunks.join("") || stderrBuf || "(no output)";

      // Truncate to save tokens
      const MAX = 15_000;
      const content =
        output.length > MAX
          ? output.slice(0, 6000) +
            `\n...(truncated ${output.length} chars)...\n` +
            output.slice(-6000)
          : output;

      if (code !== 0 && code !== null) {
        resolve({
          content: stderrBuf ? `Exit code ${code}\n${content}` : content,
          isError: chunks.length === 0,
          metadata: { exitCode: code },
        });
      } else {
        resolve({
          content,
          isError: false,
          metadata: { exitCode: 0 },
        });
      }
    });

    child.on("error", (err) => {
      resolve({
        content: `Failed to spawn claude CLI: ${err.message}\nMake sure 'claude' is installed globally: npm install -g @anthropic-ai/claude-code`,
        isError: true,
      });
    });
  });
}

export const claudeCodeTool: Tool = {
  name: "claude_code",
  description:
    "Delegate a coding task to Claude Code CLI. It can read/write files, run shell commands, and make complex code changes autonomously. Use for: code generation, bug fixing, refactoring, project scaffolding, and any task that benefits from full codebase access.",
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
    if (timeout > 0 && timeout < 1000) timeout *= 1000;

    if (context?.notifyUser) {
      await context.notifyUser("[Claude Code] Starting...").catch(() => {});
    }

    return runClaudeCode(prompt, cwd, timeout, context);
  },
};
