import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

function resolveFilePath(filePath: string, workDir?: string): string {
  if (
    process.platform === "win32" &&
    (filePath.startsWith("/tmp/") || filePath === "/tmp")
  ) {
    return filePath.replace(/^\/tmp/, tmpdir());
  }
  if (workDir && !isAbsolute(filePath)) {
    return resolve(workDir, filePath);
  }
  return filePath;
}

export const fileEditTool: Tool = {
  name: "file_edit",
  description:
    "Edit a file by replacing an exact string match. Much more precise than file_write — only changes the matched part, leaving everything else untouched. Use this instead of file_write when modifying existing files.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to edit" },
      old_string: {
        type: "string",
        description:
          "The exact string to find in the file. Must be unique — if it matches multiple locations, provide more surrounding context to make it unique.",
      },
      new_string: {
        type: "string",
        description: "The replacement string. Use empty string to delete.",
      },
      replace_all: {
        type: "string",
        description:
          'Set to "true" to replace all occurrences. Default: only replace the first unique match.',
        enum: ["true", "false"],
        default: "false",
      },
    },
    required: ["path", "old_string", "new_string"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const filePath = resolveFilePath(input.path as string, context?.workDir);
    const oldStr = input.old_string as string;
    const newStr = input.new_string as string;
    const replaceAll = input.replace_all === "true";

    if (!oldStr) {
      return {
        content: "old_string must not be empty.",
        isError: true,
        metadata: { path: filePath },
      };
    }

    if (oldStr === newStr) {
      return {
        content: "old_string and new_string are identical — nothing to do.",
        isError: true,
        metadata: { path: filePath },
      };
    }

    try {
      const content = await readFile(filePath, "utf-8");

      // Count occurrences
      let count = 0;
      let idx = -1;
      while (true) {
        idx = content.indexOf(oldStr, idx + 1);
        if (idx === -1) break;
        count++;
      }

      if (count === 0) {
        return {
          content: `old_string not found in ${filePath}. Make sure the string matches exactly (including whitespace and line breaks).`,
          isError: true,
          metadata: { path: filePath },
        };
      }

      if (count > 1 && !replaceAll) {
        return {
          content: `old_string found ${count} times in ${filePath}. Provide more surrounding context to make it unique, or set replace_all to "true".`,
          isError: true,
          metadata: { path: filePath, matchCount: count },
        };
      }

      // Perform replacement
      let result: string;
      if (replaceAll) {
        result = content.split(oldStr).join(newStr);
      } else {
        // Replace only the first (unique) occurrence
        const pos = content.indexOf(oldStr);
        result =
          content.slice(0, pos) + newStr + content.slice(pos + oldStr.length);
      }

      await writeFile(filePath, result, "utf-8");

      const replacedCount = replaceAll ? count : 1;
      return {
        content: `Edited ${filePath}: replaced ${replacedCount} occurrence${replacedCount > 1 ? "s" : ""}.`,
        isError: false,
        metadata: { path: filePath, replacedCount },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Failed to edit file: ${message}`,
        isError: true,
        metadata: { path: filePath },
      };
    }
  },
};
