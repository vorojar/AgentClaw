import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

const DEFAULT_TIMEOUT = 600_000; // 10 minutes — coding tasks are long
const DEFAULT_OUTPUT_DIR = join(process.cwd(), "data", "tmp").replace(
  /\\/g,
  "/",
);

/**
 * Spawn `claude` CLI in print mode with stream-json output.
 * Collects results silently during execution, returns a concise summary
 * so the outer LLM can compose a proper response (and persist it).
 */
async function runClaudeCode(
  prompt: string,
  cwd: string | undefined,
  timeout: number,
  context?: ToolExecutionContext,
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

  return new Promise<ToolResult>((resolve) => {
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
      cwd: cwd || process.cwd(),
      env: { ...process.env, CLAUDECODE: undefined },
      shell: process.platform === "win32",
      windowsHide: true,
    });

    let resultSummary = "";
    let toolCallCount = 0;
    const filesChanged: string[] = [];

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
                if (path && !filesChanged.includes(path)) {
                  filesChanged.push(path);
                }
                notify?.(`✏️ ${name}: ${path}`).catch(() => {});
              } else if (name === "Read") {
                notify?.(`📖 Read: ${block.input?.file_path ?? ""}`).catch(
                  () => {},
                );
              } else if (name === "Bash") {
                const cmd = String(block.input?.command ?? "").slice(0, 80);
                notify?.(`🔧 Bash: ${cmd}`).catch(() => {});
              } else if (name === "Grep" || name === "Glob") {
                notify?.(`🔍 ${name}: ${block.input?.pattern ?? ""}`).catch(
                  () => {},
                );
              } else {
                notify?.(`⚙️ ${name}`).catch(() => {});
              }
            } else if (block.type === "text" && block.text) {
              // Forward first line of assistant thinking as progress
              const firstLine = block.text.split("\n")[0].slice(0, 120);
              if (firstLine) notify?.(`💭 ${firstLine}`).catch(() => {});
            }
          }
        } else if (evt.type === "result") {
          resultSummary = evt.result || "";
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
      `${prompt}\n\nIMPORTANT: All generated output files MUST be saved to ${outputDir}/ directory. Never save files to the project root or other locations.`,
    );
    child.stdin!.end();

    child.on("close", async (code) => {
      if (code !== 0 && code !== null && !resultSummary) {
        resolve({
          content: stderrBuf || `Claude Code exited with code ${code}`,
          isError: true,
          metadata: { exitCode: code },
        });
        return;
      }

      // Auto-send output files in data/tmp/ to the user
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

      // Concise result for the outer LLM to compose a proper response
      const parts = [`Claude Code completed (${toolCallCount} tool calls).`];
      if (filesChanged.length > 0) {
        parts.push(`Files changed: ${filesChanged.join(", ")}`);
      }
      if (resultSummary) {
        parts.push(
          resultSummary.length > 500
            ? resultSummary.slice(0, 500) + "..."
            : resultSummary,
        );
      }

      resolve({
        content: parts.join("\n"),
        isError: false,
        metadata: { exitCode: 0, toolCallCount },
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

    return runClaudeCode(prompt, cwd, timeout, context);
  },
};
