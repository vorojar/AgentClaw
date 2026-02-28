import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Tool, ToolResult } from "@agentclaw/types";

/**
 * On Windows, Git Bash maps /tmp/ to the OS temp dir (e.g. C:/Users/.../Temp),
 * but Node.js resolves /tmp/ to drive-root (e.g. D:\tmp). Fix the mismatch.
 */
function resolveFilePath(filePath: string): string {
  if (
    process.platform === "win32" &&
    (filePath.startsWith("/tmp/") || filePath === "/tmp")
  ) {
    return filePath.replace(/^\/tmp/, tmpdir());
  }
  return filePath;
}

export const fileReadTool: Tool = {
  name: "file_read",
  description: "Read a file.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
    required: ["path"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = resolveFilePath(input.path as string);

    try {
      const content = await readFile(filePath, "utf-8");
      return {
        content,
        isError: false,
        metadata: { path: filePath },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Failed to read file: ${message}`,
        isError: true,
        metadata: { path: filePath },
      };
    }
  },
};
