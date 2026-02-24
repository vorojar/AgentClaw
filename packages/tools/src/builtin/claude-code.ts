import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

const DEFAULT_TIMEOUT = 600_000; // 10 minutes — coding tasks are long
const OUTPUT_DIR = join(process.cwd(), "data", "tmp").replace(/\\/g, "/");

/**
 * Spawn `claude` CLI in print mode with stream-json output.
 * Text is streamed directly to the user's chat via context.streamText.
 * Returns a compact summary to the outer LLM (saves tokens).
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

  const stream = context?.streamText;

  return new Promise<ToolResult>((resolve) => {
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
      cwd: cwd || process.cwd(),
      env: { ...process.env },
      shell: process.platform === "win32",
    });

    let totalChars = 0;
    let resultSummary = "";
    let toolCallCount = 0;
    const filesChanged: string[] = [];

    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const evt = JSON.parse(line);

        if (evt.type === "assistant" && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === "text" && block.text) {
              totalChars += block.text.length;
              // Stream text directly to user's chat bubble
              if (stream) stream(block.text);
            }
            if (block.type === "tool_use") {
              toolCallCount++;
              // Track file changes for summary
              if (
                block.name === "Edit" ||
                block.name === "Write" ||
                block.name === "NotebookEdit"
              ) {
                const path =
                  block.input?.file_path || block.input?.notebook_path || "";
                if (path && !filesChanged.includes(path)) {
                  filesChanged.push(path);
                }
              }
            }
          }
        } else if (evt.type === "result") {
          resultSummary = evt.result || "";
          // Stream the final result text too
          if (stream && evt.result) stream("\n\n" + evt.result);
        }
      } catch {
        // non-JSON line — ignore
      }
    });

    let stderrBuf = "";
    child.stderr?.on("data", (data: Buffer) => {
      stderrBuf += data.toString();
    });

    // Inject output directory constraint + write prompt to stdin
    child.stdin!.write(
      `${prompt}\n\nIMPORTANT: All generated output files MUST be saved to ${OUTPUT_DIR}/ directory. Never save files to the project root or other locations.`,
    );
    child.stdin!.end();

    child.on("close", async (code) => {
      if (code !== 0 && code !== null && totalChars === 0) {
        resolve({
          content: stderrBuf || `Claude Code exited with code ${code}`,
          isError: true,
          metadata: { exitCode: code },
        });
        return;
      }

      // Auto-send output files in data/tmp or data/temp to the user
      const sendFile = context?.sendFile;
      if (sendFile && filesChanged.length > 0) {
        const outputRe = /[/\\]data[/\\]te?mp[/\\]/i;
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

      // Return compact summary to outer LLM — the user already saw the full text
      const parts = [`Claude Code completed (${toolCallCount} tool calls).`];
      if (filesChanged.length > 0) {
        parts.push(`Files changed: ${filesChanged.join(", ")}`);
      }
      if (resultSummary) {
        // Keep result summary short
        parts.push(
          resultSummary.length > 500
            ? resultSummary.slice(0, 500) + "..."
            : resultSummary,
        );
      }

      resolve({
        content: parts.join("\n"),
        isError: false,
        autoComplete: true, // skip outer LLM — user already has the streamed output
        metadata: { exitCode: 0, totalChars, toolCallCount },
      });
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
    "Delegate a coding task to Claude Code CLI. It can read/write files, run shell commands, and make complex code changes autonomously. Use for: code generation, bug fixing, refactoring, project scaffolding, and any task that benefits from full codebase access. Output is streamed directly to the user in real-time.",
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

    return runClaudeCode(prompt, cwd, timeout, context);
  },
};
