import { execFile } from "node:child_process";
import type {
  Tool,
  ToolEffect,
  ToolExecutionContext,
  ToolResult,
} from "@agentclaw/types";

const DEFAULT_TIMEOUT = 30_000;
const MAX_CONTENT = 12_000;

// biome-ignore lint/complexity/useRegexLiterals: ANSI control characters trip noControlCharactersInRegex in literal form.
const ANSI_RE = new RegExp(
  "[\\u001b\\u009b][\\[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]",
  "g",
);

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function decodeOutput(buf: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("gbk").decode(buf);
  }
  return stripAnsi(text);
}

function normalizeCode(code: string): string {
  return code.replace(/\\/g, "/");
}

function validateBunCode(code: string): ToolResult | null {
  if (process.env.BUN_SANDBOX === "false") return null;

  const normalized = normalizeCode(code);
  const blocked: [RegExp, string][] = [
    [
      /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-[a-zA-Z]*f[a-zA-Z]*r))\s+\/(?:[\s`'";]|$)/,
      "rm -rf /（根目录递归删除）",
    ],
    [
      /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-[a-zA-Z]*f[a-zA-Z]*r))\s+\/(?:boot|etc|usr|var|bin|sbin|lib|proc|sys)\b/,
      "rm -rf 系统目录",
    ],
    [/\bgit\s+reset\s+--hard\b/i, "git reset --hard"],
    [/\bgit\s+clean\s+-[^\n]*f/i, "git clean -f"],
    [/\bRemove-Item\b[\s\S]*\b-Recurse\b/i, "Remove-Item -Recurse"],
    [/\bdel\s+\/[sS]\s+\/[qQ]\s+[A-Za-z]:\//i, "del /s /q 驱动器根目录"],
    [/\bformat\s+[A-Za-z]:/i, "format 磁盘"],
    [/\bshutdown\b/i, "shutdown"],
    [/\breboot\b/i, "reboot"],
    [/\bmkfs\b/i, "mkfs"],
    [/\bdd\b.*\bof=\/dev\/[sh]d[a-z]/i, "dd 写入磁盘设备"],
    [/\breg\s+delete\s+HK(LM|CR|U\/)/i, "reg delete 系统注册表"],
    [/[>|]\s*["']?C:\/Windows\/System32/i, "写入 System32"],
    [/\bprintenv\b/, "printenv 泄露环境变量"],
    [/\bcat\s+[^\n]*\/proc\//, "读取 /proc 系统文件"],
    [/\b(?:curl|wget)\b[^\n]*169\.254/, "访问云元数据服务"],
  ];

  for (const [pattern, description] of blocked) {
    if (pattern.test(normalized)) {
      return {
        content: `沙箱拦截：${description}\nBun 代码被阻止执行。`,
        isError: true,
        effect: {
          kind: "delete",
          reversible: false,
          verified: true,
        },
      };
    }
  }

  return null;
}

function classifyBunEffect(code: string, verified: boolean): ToolEffect {
  const normalized = normalizeCode(code);
  if (
    /\b(?:unlink|rm|rmdir|remove|deleteFile)\s*\(/i.test(normalized) ||
    /\bBun\.file\s*\([^)]*\)\.delete\s*\(/i.test(normalized)
  ) {
    return { kind: "delete", reversible: false, verified };
  }
  if (
    /\bBun\.write\s*\(/i.test(normalized) ||
    /\b(?:writeFile|appendFile|mkdir|copyFile|rename)\s*\(/i.test(normalized) ||
    /\$\s*`[^`]*(?:^|[\s;&|])(?:mkdir|touch|cp|copy|mv|move)\b/i.test(
      normalized,
    ) ||
    /\$\s*`[^`]*>>?[^>`]*`/i.test(normalized)
  ) {
    return { kind: "write", reversible: false, verified };
  }
  if (
    /\b(?:fetch|Bun\.spawn|spawn|exec|execFile)\s*\(/i.test(normalized) ||
    /\bfrom\s+["']node:child_process["']/i.test(normalized) ||
    /\bfrom\s+["']bun["']/i.test(normalized)
  ) {
    return { kind: "external", reversible: false, verified };
  }
  return { kind: "read", reversible: false, verified };
}

function truncateContent(content: string): string {
  if (content.length <= MAX_CONTENT) return content;
  const half = 5000;
  return (
    content.slice(0, half) +
    `\n\n... (${content.length} chars total, showing first and last ${half}) ...\n\n` +
    content.slice(-half)
  );
}

function runBun(
  code: string,
  args: string[],
  timeout: number,
  workDir?: string,
  abortSignal?: AbortSignal,
): Promise<ToolResult> {
  return new Promise<ToolResult>((resolve) => {
    let aborted = false;
    const bunArgs = ["--eval", code];
    if (args.length > 0) bunArgs.push("--", ...args);

    const child = execFile(
      "bun",
      bunArgs,
      {
        cwd: workDir,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "buffer",
        windowsHide: true,
        shell: false,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      },
      (error, stdout, stderr) => {
        if (aborted) {
          resolve({
            content: "Bun execution aborted by user.",
            isError: true,
            metadata: { exitCode: null, aborted: true },
          });
          return;
        }

        const stdoutStr = stdout ? decodeOutput(stdout) : "";
        const stderrStr = stderr ? decodeOutput(stderr) : "";
        const output = [stdoutStr, stderrStr].filter(Boolean).join("\n");

        if (error) {
          const execError = error as NodeJS.ErrnoException & {
            killed?: boolean;
          };
          if (execError.code === "ENOENT") {
            resolve({
              content:
                "Bun runtime not found. Install bun or use bash/pnpm for this task.",
              isError: true,
              metadata: { exitCode: 127 },
            });
            return;
          }
          if (execError.killed) {
            resolve({
              content: `Bun execution timed out after ${timeout}ms\n${output}`,
              isError: true,
              metadata: { exitCode: null, timedOut: true },
            });
            return;
          }
          resolve({
            content: output || error.message,
            isError: true,
            metadata: {
              exitCode:
                typeof execError.code === "number"
                  ? execError.code
                  : 1,
            },
          });
          return;
        }

        resolve({
          content: output,
          isError: false,
          metadata: { exitCode: 0 },
        });
      },
    );

    if (abortSignal) {
      const abort = () => {
        aborted = true;
        child.kill();
      };
      if (abortSignal.aborted) {
        abort();
      } else {
        abortSignal.addEventListener("abort", abort, { once: true });
        child.on("close", () => abortSignal.removeEventListener("abort", abort));
      }
    }
  });
}

export const bunTool: Tool = {
  name: "bun",
  description:
    "Execute a Bun JavaScript/TypeScript snippet for cross-platform JSON, AST, and filesystem batch work. Prefer file_read/file_edit/file_write for simple file operations, and bash/pnpm for project scripts.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          "JavaScript/TypeScript code to execute with bun --eval. Keep code bounded and print structured output.",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Optional string arguments passed after --.",
      },
      timeout: { type: "number", default: DEFAULT_TIMEOUT },
    },
    required: ["code"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const code = input.code;
    if (typeof code !== "string" || code.trim() === "") {
      return {
        content: 'Missing required parameter "code".',
        isError: true,
      };
    }

    let timeout = (input.timeout as number | undefined) ?? DEFAULT_TIMEOUT;
    if (timeout > 0 && timeout < 1000) timeout *= 1000;
    const args = Array.isArray(input.args)
      ? input.args.map((arg) => String(arg))
      : [];

    const blocked = validateBunCode(code);
    if (blocked) return blocked;

    const result = await runBun(
      code,
      args,
      timeout,
      context?.workDir,
      context?.abortSignal,
    );

    result.content = truncateContent(result.content);
    result.effect ??= classifyBunEffect(code, !result.isError);
    return result;
  },
};
