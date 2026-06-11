import { readFile } from "node:fs/promises";
import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";
import { resolveFilePath } from "./resolve-path.js";

const OVERFLOW_PREVIEW_CHARS = 1_500;
const OVERFLOW_RANGE_MAX_CHARS = 4_000;

function asNonNegativeInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

function asPositiveInteger(value: unknown): number | undefined {
  const n = asNonNegativeInteger(value);
  if (n === undefined || n < 1) return undefined;
  return n;
}

export const fileReadTool: Tool = {
  name: "file_read",
  description: "Read a file.",
  category: "builtin",
  pure: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: {
        type: "number",
        description:
          "Optional character offset for bounded reads. Use this for large overflow files.",
      },
      length: {
        type: "number",
        description:
          "Optional maximum characters to read from offset. Overflow files are capped.",
      },
      line: {
        type: "number",
        description:
          "Optional 1-based line number for reading context around a grep match.",
      },
      context_lines: {
        type: "number",
        description:
          "Optional number of lines before and after line. Defaults to 20 when line is set.",
      },
    },
    required: ["path"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const filePath = resolveFilePath(input.path as string);

    // Check .agentclawignore + hardcoded blocked patterns
    if (context?.ignoreCheck?.(filePath)) {
      const basename =
        filePath.replace(/\\/g, "/").split("/").pop() || filePath;
      return {
        content: `Access denied: ${basename} matches .agentclawignore or is a sensitive file.`,
        isError: true,
      };
    }

    // Fallback: hardcoded blocked patterns (when no context.ignoreCheck)
    const BLOCKED_PATTERNS = [
      /\.env(\.[a-z]+)?$/i,
      /credentials\.json$/i,
      /secrets?\.json$/i,
      /\.pem$/i,
      /\.key$/i,
      /id_rsa/i,
      /id_ed25519/i,
      /\.ssh\/config$/i,
    ];
    const BLOCKED_PATH_PREFIXES = ["/proc/", "/sys/", "/dev/"];
    const normalizedPath = filePath.replace(/\\/g, "/");
    const basename = normalizedPath.split("/").pop() || "";
    if (
      !context?.ignoreCheck &&
      (BLOCKED_PATTERNS.some(
        (p) => p.test(basename) || p.test(normalizedPath),
      ) ||
        BLOCKED_PATH_PREFIXES.some((prefix) =>
          normalizedPath.startsWith(prefix),
        ))
    ) {
      return {
        content: `Access denied: ${basename} is a sensitive file and cannot be read.`,
        isError: true,
      };
    }

    try {
      const content = await readFile(filePath, "utf-8");
      const offset = asNonNegativeInteger(input.offset) ?? 0;
      const requestedLength = asNonNegativeInteger(input.length);
      const line = asPositiveInteger(input.line);
      const contextLines = Math.min(
        asNonNegativeInteger(input.context_lines) ?? 20,
        100,
      );
      const isOverflowFile = /^overflow_.*\.txt$/i.test(basename);

      if (input.line !== undefined) {
        if (line === undefined) {
          return {
            content: "Invalid line: expected a 1-based positive integer.",
            isError: true,
            metadata: { path: filePath },
          };
        }
        const lines = content.split(/\r?\n/);
        const targetIndex = Math.min(line - 1, lines.length - 1);
        const start = Math.max(0, targetIndex - contextLines);
        const end = Math.min(lines.length - 1, targetIndex + contextLines);
        const width = String(end + 1).length;
        const snippet = lines
          .slice(start, end + 1)
          .map((text, index) => {
            const lineNo = start + index + 1;
            const prefix = lineNo === line ? ">" : " ";
            return `${prefix} ${String(lineNo).padStart(width, " ")} | ${text}`;
          })
          .join("\n");
        return {
          content: snippet,
          isError: false,
          metadata: {
            path: filePath,
            line,
            contextLines,
            totalLines: lines.length,
          },
        };
      }

      if (isOverflowFile) {
        if (input.offset !== undefined || input.length !== undefined) {
          const length = Math.min(
            requestedLength ?? OVERFLOW_RANGE_MAX_CHARS,
            OVERFLOW_RANGE_MAX_CHARS,
          );
          const slice = content.slice(offset, offset + length);
          return {
            content:
              `[overflow file range: offset=${offset}, length=${length}, originalLength=${content.length}]\n` +
              slice,
            isError: false,
            metadata: {
              path: filePath,
              overflowRange: true,
              originalLength: content.length,
              offset,
              length,
            },
          };
        }

        const preview = content.slice(0, OVERFLOW_PREVIEW_CHARS);
        return {
          content:
            `[overflow file preview: originalLength=${content.length}. Use grep or file_read with offset/length for targeted access.]\n` +
            preview,
          isError: false,
          metadata: {
            path: filePath,
            overflowPreview: true,
            originalLength: content.length,
          },
        };
      }

      if (input.offset !== undefined || input.length !== undefined) {
        const length = requestedLength ?? content.length - offset;
        return {
          content: content.slice(offset, offset + length),
          isError: false,
          metadata: { path: filePath, offset, length },
        };
      }

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
