import { execFile } from "node:child_process";
import type { Tool, ToolResult } from "@agentclaw/types";

const DEFAULT_TIMEOUT = 30_000;

export const shellTool: Tool = {
  name: "shell",
  description: "Execute a shell command and return its output",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
        default: DEFAULT_TIMEOUT,
      },
    },
    required: ["command"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = (input.timeout as number) ?? DEFAULT_TIMEOUT;

    // Determine the shell and flag based on platform
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd.exe" : "/bin/sh";
    const flag = isWindows ? "/c" : "-c";
    // On Windows, prepend chcp 65001 to switch to UTF-8 codepage
    const fullCommand = isWindows ? `chcp 65001 >nul && ${command}` : command;

    return new Promise<ToolResult>((resolve) => {
      execFile(
        shell,
        [flag, fullCommand],
        { timeout, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
        (error, stdout, stderr) => {
          const output = [stdout, stderr].filter(Boolean).join("\n");

          if (error) {
            // Check for timeout
            if (error.killed) {
              resolve({
                content: `Command timed out after ${timeout}ms\n${output}`,
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
            content: output,
            isError: false,
            metadata: { exitCode: 0 },
          });
        },
      );
    });
  },
};
