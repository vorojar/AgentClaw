import { readFile } from "node:fs/promises";
import type { Tool, ToolResult } from "@agentclaw/types";

export const fileReadTool: Tool = {
  name: "file_read",
  description: "Read the contents of a file at the given path",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file to read",
      },
    },
    required: ["path"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input.path as string;

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
