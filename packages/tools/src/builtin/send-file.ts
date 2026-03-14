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

    // Check file exists — try workDir, original path, then resolved absolute path
    const { existsSync } = await import("node:fs");
    const { resolve, isAbsolute } = await import("node:path");
    // Relative paths → resolve to per-trace workDir first
    const workDirPath =
      context.workDir && !isAbsolute(filePath)
        ? resolve(context.workDir, filePath)
        : null;
    const resolvedPath = resolve(filePath);
    let effectivePath =
      workDirPath && existsSync(workDirPath)
        ? workDirPath
        : existsSync(filePath)
          ? filePath
          : existsSync(resolvedPath)
            ? resolvedPath
            : null;
    if (!effectivePath) {
      return {
        content: `File not found: ${filePath}`,
        isError: true,
      };
    }

    // Auto-relocate: if file is outside workDir, copy it into workDir
    // so it's accessible via /files/{sessionId}/ and associated with the session
    if (context.workDir && effectivePath !== workDirPath) {
      const { basename, join } = await import("node:path");
      const { copyFileSync, mkdirSync } = await import("node:fs");
      const dest = join(context.workDir, basename(effectivePath));
      try {
        mkdirSync(context.workDir, { recursive: true });
        copyFileSync(effectivePath, dest);
        effectivePath = dest;
      } catch {
        // best-effort — send from original location if copy fails
      }
    }

    try {
      await context.sendFile(effectivePath, caption);
      return {
        content: `File sent: ${effectivePath}`,
        isError: false,
        autoComplete: true,
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
