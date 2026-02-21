import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const sendFileTool: Tool = {
  name: "send_file",
  description: "Send a file to the user.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      caption: { type: "string" },
    },
    required: ["path"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const filePath = input.path as string;
    const caption = input.caption as string | undefined;

    if (!context?.sendFile) {
      return {
        content: "File sending is not available in this context.",
        isError: true,
      };
    }

    // Check file exists
    const { existsSync } = await import("node:fs");
    if (!existsSync(filePath)) {
      return {
        content: `File not found: ${filePath}`,
        isError: true,
      };
    }

    try {
      await context.sendFile(filePath, caption);
      return {
        content: `File sent: ${filePath}`,
        isError: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Failed to send file: ${message}`,
        isError: true,
      };
    }
  },
};
