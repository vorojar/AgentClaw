import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";
import { loadIgnorePatterns } from "../ignore.js";

export const globTool: Tool = {
  name: "glob",
  description:
    "Find files by name pattern. Returns matching file paths. Use this instead of shell('find ...') — structured parameters, no escaping issues.",
  category: "builtin",
  pure: true,
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          'Glob pattern, e.g. "**/*.ts", "src/**/*.tsx", "*.json". Supports *, **, ?, [abc].',
      },
      cwd: {
        type: "string",
        description:
          "Directory to search in. Defaults to current working directory.",
      },
      max_results: {
        type: "string",
        description: "Maximum number of results to return. Default: 100.",
        default: "100",
      },
    },
    required: ["pattern"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const cwd = (input.cwd as string) || context?.workDir || process.cwd();
    const maxResults = Math.min(
      Number.parseInt(String(input.max_results || "100"), 10) || 100,
      500,
    );

    try {
      // Merge .agentclawignore patterns
      const extraIgnores = context?.workDir
        ? await loadIgnorePatterns(context.workDir)
        : [];

      // Dynamic import to avoid top-level ESM issues
      const fg = await import("fast-glob");
      const files = await fg.default(pattern, {
        cwd,
        onlyFiles: true,
        dot: false,
        ignore: [
          "**/node_modules/**",
          "**/dist/**",
          "**/.git/**",
          ...extraIgnores,
        ],
        followSymbolicLinks: false,
      });

      const limited = files.slice(0, maxResults);
      if (limited.length === 0) {
        return {
          content: `0 files matching "${pattern}" in ${cwd}`,
          isError: false,
          metadata: { matchCount: 0, shown: 0, cwd },
        };
      }
      const suffix =
        files.length > maxResults
          ? `\n(showing ${maxResults} of ${files.length} total)`
          : "";

      return {
        content: `files[${files.length}]:\n${limited.join("\n")}${suffix}\n\nhint: use file_read(path) to read file content`,
        isError: false,
        metadata: { matchCount: files.length, shown: limited.length, cwd },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Glob failed: ${message}`,
        isError: true,
        metadata: { pattern, cwd },
      };
    }
  },
};
