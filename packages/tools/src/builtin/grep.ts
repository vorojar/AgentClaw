import { readFile, stat } from "node:fs/promises";
import { dirname, basename } from "node:path";
import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";
import { loadIgnorePatterns } from "../ignore.js";

export const grepTool: Tool = {
  name: "grep",
  description:
    "Search file contents by regex pattern. Returns matching lines with file paths and line numbers. Use this instead of shell('grep ...') — structured parameters, cross-platform, no escaping issues.",
  category: "builtin",
  pure: true,
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          "Regex pattern to search for, e.g. 'function\\s+\\w+', 'TODO', 'import.*from'.",
      },
      path: {
        type: "string",
        description:
          "File or directory to search in. Defaults to current working directory.",
      },
      file_pattern: {
        type: "string",
        description:
          'Glob pattern to filter files, e.g. "*.ts", "*.{ts,tsx}". Default: all text files.',
        default: "**/*",
      },
      context_lines: {
        type: "string",
        description:
          "Number of lines to show before and after each match. Default: 0.",
        default: "0",
      },
      max_results: {
        type: "string",
        description: "Maximum number of matching lines to return. Default: 50.",
        default: "50",
      },
      ignore_case: {
        type: "string",
        description:
          'Case insensitive search. "true" or "false". Default: "false".',
        enum: ["true", "false"],
        default: "false",
      },
      exclude_dir: {
        type: "string",
        description:
          'Comma-separated directory names to exclude, e.g. "test,fixtures". Merged with defaults (node_modules, dist, .git, target, etc.).',
        default: "",
      },
    },
    required: ["pattern"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath =
      (input.path as string) || context?.workDir || process.cwd();
    const filePattern = (input.file_pattern as string) || "**/*";
    const contextLines = Math.min(
      Number.parseInt(String(input.context_lines || "0"), 10) || 0,
      10,
    );
    const maxResults = Math.min(
      Number.parseInt(String(input.max_results || "50"), 10) || 50,
      200,
    );
    const ignoreCase = input.ignore_case === "true";

    // Parse user-specified exclude dirs and merge with defaults
    const defaultExcludes = [
      "node_modules",
      "dist",
      ".git",
      "target",
      "binaries",
      "build",
      "coverage",
      ".next",
      ".nuxt",
      ".cache",
    ];
    const userExcludes = ((input.exclude_dir as string) || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const excludeDirs = [...new Set([...defaultExcludes, ...userExcludes])];
    const ignorePatterns = excludeDirs.map((d) => `**/${d}/**`);

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, ignoreCase ? "i" : "");
    } catch {
      return {
        content: `Invalid regex pattern: ${pattern}`,
        isError: true,
        metadata: { pattern },
      };
    }

    try {
      // If searchPath is a file, search just that file
      const pathStat = await stat(searchPath).catch(() => null);
      if (pathStat?.isFile()) {
        const content = await readFile(searchPath, "utf-8");
        const lines = content.split("\n");
        const matches: string[] = [];
        let totalMatches = 0;
        const displayPath = searchPath.replace(/\\/g, "/");

        for (let i = 0; i < lines.length; i++) {
          if (totalMatches >= maxResults) break;
          if (!regex.test(lines[i])) continue;
          totalMatches++;
          if (contextLines > 0) {
            const start = Math.max(0, i - contextLines);
            const end = Math.min(lines.length - 1, i + contextLines);
            matches.push(`${displayPath}:${i + 1}:`);
            for (let j = start; j <= end; j++) {
              const prefix = j === i ? ">" : " ";
              matches.push(`${prefix} ${j + 1} | ${lines[j]}`);
            }
            matches.push("");
          } else {
            matches.push(`${displayPath}:${i + 1}: ${lines[i]}`);
          }
        }

        if (matches.length === 0) {
          return {
            content: `0 matches for /${pattern}/${ignoreCase ? "i" : ""} in ${displayPath}`,
            isError: false,
            metadata: { matchCount: 0, filesSearched: 1 },
          };
        }
        return {
          content: `matches[${totalMatches}]:\n${matches.join("\n")}\n\nhint: use file_read with {"path": "...", "line": <match line>} to see context around a match`,
          isError: false,
          metadata: { matchCount: totalMatches, filesSearched: 1 },
        };
      }

      // Merge .agentclawignore patterns
      const extraIgnores = context?.workDir
        ? await loadIgnorePatterns(context.workDir)
        : [];

      const fg = await import("fast-glob");
      const files = await fg.default(filePattern, {
        cwd: searchPath,
        onlyFiles: true,
        dot: false,
        ignore: [
          ...ignorePatterns,
          ...extraIgnores,
          "**/*.png",
          "**/*.jpg",
          "**/*.png",
          "**/*.jpg",
          "**/*.gif",
          "**/*.ico",
          "**/*.woff*",
          "**/*.ttf",
          "**/*.eot",
          "**/*.mp3",
          "**/*.mp4",
          "**/*.zip",
          "**/*.tar*",
          "**/*.gz",
          "**/pnpm-lock.yaml",
          "**/package-lock.json",
        ],
        followSymbolicLinks: false,
        absolute: true,
      });

      const matches: string[] = [];
      let totalMatches = 0;

      for (const file of files) {
        if (totalMatches >= maxResults) break;

        let content: string;
        try {
          content = await readFile(file, "utf-8");
        } catch {
          continue; // Skip unreadable files (binary, permission, etc.)
        }

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (totalMatches >= maxResults) break;
          if (!regex.test(lines[i])) continue;

          totalMatches++;
          // Normalize path for display
          const displayPath = file.replace(/\\/g, "/");

          if (contextLines > 0) {
            const start = Math.max(0, i - contextLines);
            const end = Math.min(lines.length - 1, i + contextLines);
            matches.push(`${displayPath}:${i + 1}:`);
            for (let j = start; j <= end; j++) {
              const prefix = j === i ? ">" : " ";
              matches.push(`${prefix} ${j + 1} | ${lines[j]}`);
            }
            matches.push("");
          } else {
            matches.push(`${displayPath}:${i + 1}: ${lines[i]}`);
          }
        }
      }

      if (matches.length === 0) {
        return {
          content: `0 matches for /${pattern}/${ignoreCase ? "i" : ""} in ${searchPath} (searched ${files.length} files)`,
          isError: false,
          metadata: { matchCount: 0, filesSearched: files.length },
        };
      }

      const suffix =
        totalMatches >= maxResults
          ? `\n(showing first ${maxResults} of ${totalMatches}+ matches)`
          : "";

      return {
        content: `matches[${totalMatches}]:\n${matches.join("\n")}${suffix}\n\nhint: use file_read with {"path": "...", "line": <match line>} to see context around a match`,
        isError: false,
        metadata: {
          matchCount: totalMatches,
          filesSearched: files.length,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Grep failed: ${message}`,
        isError: true,
        metadata: { pattern, path: searchPath },
      };
    }
  },
};
