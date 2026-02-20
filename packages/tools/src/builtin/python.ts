import { execFile } from "node:child_process";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Tool, ToolResult } from "@agentclaw/types";

const DEFAULT_TIMEOUT = 60_000;
const TEMP_DIR = resolve(process.cwd(), "data", "tmp");

export const pythonTool: Tool = {
  name: "python",
  description:
    "Execute Python code and return stdout. Code runs as a top-level script — do NOT use return statements. Use print() for output. Preferred over shell for complex tasks (screenshots, image processing, PDF/Excel, data analysis, etc.). Working directory is the temp folder.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "The Python code to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 60000)",
        default: DEFAULT_TIMEOUT,
      },
    },
    required: ["code"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const code = input.code as string;
    const timeout = (input.timeout as number) ?? DEFAULT_TIMEOUT;

    // Ensure temp dir exists
    try {
      mkdirSync(TEMP_DIR, { recursive: true });
    } catch {
      // may already exist
    }

    // Write code to a temp file
    const scriptPath = join(TEMP_DIR, `_script_${Date.now()}.py`);
    try {
      writeFileSync(scriptPath, code, "utf8");
    } catch (err) {
      return {
        content: `Failed to write script: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    // Detect python executable
    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    return new Promise<ToolResult>((resolve) => {
      execFile(
        pythonCmd,
        [scriptPath],
        {
          timeout,
          maxBuffer: 10 * 1024 * 1024,
          encoding: "utf8",
          cwd: TEMP_DIR,
          env: {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
            PYTHONUTF8: "1",
          },
        },
        (error, stdout, stderr) => {
          // Clean up temp script
          try {
            unlinkSync(scriptPath);
          } catch {
            // ignore cleanup errors
          }

          const output = [stdout, stderr].filter(Boolean).join("\n");

          if (error) {
            if (error.killed) {
              resolve({
                content: `Python script timed out after ${timeout}ms\n${output}`,
                isError: true,
                metadata: { exitCode: null, timedOut: true },
              });
              return;
            }

            resolve({
              content: output || error.message,
              isError: true,
              metadata: { exitCode: error.code ?? 1 },
            });
            return;
          }

          resolve({
            content: output || "(no output)",
            isError: false,
            metadata: { exitCode: 0 },
          });
        },
      );
    });
  },
};
