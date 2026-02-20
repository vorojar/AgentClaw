import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const sendFileTool: Tool = {
  name: "send_file",
  description:
    "Send a file from the server to the user. Use this when the user asks for a file or when you've created a file they need.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file to send",
      },
      caption: {
        type: "string",
        description: "Optional caption/description for the file",
      },
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
