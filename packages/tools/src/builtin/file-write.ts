import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

/** On Windows, Git Bash /tmp/ ≠ Node.js /tmp/. Map to OS temp dir. */
function resolveFilePath(filePath: string, workDir?: string): string {
  if (
    process.platform === "win32" &&
    (filePath.startsWith("/tmp/") || filePath === "/tmp")
  ) {
    return filePath.replace(/^\/tmp/, tmpdir());
  }
  // Relative paths → resolve to per-trace workDir (data/tmp/{traceId}/)
  if (workDir && !isAbsolute(filePath)) {
    return resolve(workDir, filePath);
  }
  return filePath;
}

export const fileWriteTool: Tool = {
  name: "file_write",
  description: "Write content to a file.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const filePath = resolveFilePath(input.path as string, context?.workDir);
    const content = input.content as string;

    try {
      // Ensure parent directory exists
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf-8");

      return {
        content: `Successfully wrote to ${filePath}`,
        isError: false,
        metadata: {
          path: filePath,
          bytesWritten: Buffer.byteLength(content, "utf-8"),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Failed to write file: ${message}`,
        isError: true,
        metadata: { path: filePath },
      };
    }
  },
};
