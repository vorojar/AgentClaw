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

    const isWindows = process.platform === "win32";

    // On Windows, use PowerShell directly to avoid cmd.exe stripping $ signs
    // and to get native UTF-8 support.
    // On Unix, use /bin/sh as usual.
    const shell = isWindows ? "powershell.exe" : "/bin/sh";
    const args = isWindows
      ? [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          // Force UTF-8 output encoding, then run the user command
          "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
            command,
        ]
      : ["-c", command];

    // On Windows, force UTF-8 for common tools via environment variables
    const env = isWindows
      ? {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        }
      : undefined;

    return new Promise<ToolResult>((resolve) => {
      execFile(
        shell,
        args,
        { timeout, maxBuffer: 10 * 1024 * 1024, encoding: "utf8", env },
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
