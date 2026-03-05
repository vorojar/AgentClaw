import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const globTool: Tool = {
  name: "glob",
  description:
    "Find files by name pattern. Returns matching file paths. Use this instead of shell('find ...') — structured parameters, no escaping issues.",
  category: "builtin",
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
      // Dynamic import to avoid top-level ESM issues
      const fg = await import("fast-glob");
      const files = await fg.default(pattern, {
        cwd,
        onlyFiles: true,
        dot: false,
        ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
        followSymbolicLinks: false,
      });

      const limited = files.slice(0, maxResults);
      const result = limited.join("\n") || "(no matches)";
      const suffix =
        files.length > maxResults
          ? `\n\n(showing ${maxResults} of ${files.length} total matches)`
          : "";

      return {
        content: result + suffix,
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
