import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool, ToolResult } from "@agentclaw/types";

export const fileWriteTool: Tool = {
  name: "file_write",
  description:
    "Write content to a file at the given path, creating parent directories if needed",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file to write",
      },
      content: {
        type: "string",
        description: "Content to write to the file",
      },
    },
    required: ["path", "content"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input.path as string;
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
