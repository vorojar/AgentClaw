import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

const DEFAULT_TIMEOUT = 120_000;

/**
 * Find Git Bash on Windows.
 *
 * IMPORTANT: Simply running `bash` on Windows may resolve to WSL's
 * `/bin/bash` (via C:\Windows\System32\bash.exe), which does NOT have
 * access to Windows-installed tools like ffmpeg. We must explicitly
 * locate Git Bash's `bash.exe` instead.
 */
function findGitBash(): string | null {
  // 1. Check common Git installation paths
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      return p;
    }
  }

  // 2. Try to locate via `where git` and derive bash path
  try {
    const gitPath = execFileSync("where", ["git"], {
      timeout: 3000,
      encoding: "utf8",
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)[0]
      .trim();
    // git.exe is typically at ...\Git\cmd\git.exe
    // bash.exe is at ...\Git\bin\bash.exe
    const gitRoot = gitPath
      .replace(/\\cmd\\git\.exe$/i, "")
      .replace(/\\bin\\git\.exe$/i, "");
    const bashPath = gitRoot + "\\bin\\bash.exe";
    if (existsSync(bashPath)) {
      return bashPath;
    }
  } catch {
    // git not found
  }

  return null;
}

/**
 * Detect the best available shell on this system.
 * Priority: Git Bash on Windows > PowerShell > /bin/sh
 *
 * bash is preferred because LLMs generate bash commands far more reliably
 * than PowerShell, and Git Bash is present on most Windows dev machines.
 */
function detectShell(): {
  shell: string;
  args: (cmd: string) => string[];
  name: string;
} {
  if (process.platform !== "win32") {
    return {
      shell: "/bin/sh",
      args: (cmd) => ["-c", cmd],
      name: "bash",
    };
  }

  // Windows: find Git Bash explicitly (NOT WSL bash)
  const gitBash = findGitBash();
  if (gitBash) {
    return {
      shell: gitBash,
      args: (cmd) => ["--login", "-c", cmd],
      name: "bash",
    };
  }

  return {
    shell: "powershell.exe",
    args: (cmd) => [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " + cmd,
    ],
    name: "powershell",
  };
}

/** Cached shell config — detected once at startup */
const detectedShell = detectShell();

/** PowerShell config for Windows — used when shell parameter is "powershell" */
const powershellConfig = {
  shell: "powershell.exe",
  args: (cmd: string) => [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " + cmd,
  ],
  name: "powershell" as const,
};

/**
 * Decode raw bytes from child process output.
 * Try UTF-8 first; if it contains invalid sequences (common when Windows
 * native programs output GBK/CP936), fall back to GBK decoding.
 */
function decodeOutput(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // GBK / GB18030 fallback for Chinese Windows
    return new TextDecoder("gbk").decode(buf);
  }
}

/** Exported so bootstrap.ts can read the detected shell name */
export const shellInfo = {
  name: detectedShell.name,
  shell: detectedShell.shell,
};

/** Detect file paths pointing to data/tmp (including subdirectories) */
const FILE_PATH_RE =
  /(?:[A-Za-z]:)?(?:[/\\][^\s/\\:*?"<>|]+)*[/\\]?data[/\\]tmp(?:[/\\][^\s/\\:*?"<>|]+)+\.[a-z0-9]+(?:\.[a-z0-9]+)?/gi;

/** Script/temp file extensions — never auto-send to user */
const SCRIPT_EXTS = new Set([
  ".py",
  ".sh",
  ".js",
  ".ts",
  ".rb",
  ".bat",
  ".cmd",
  ".ps1",
  ".pl",
]);

function detectFilePaths(text: string): string[] {
  const matches = text.match(FILE_PATH_RE) || [];
  // Normalize backslashes, deduplicate, filter out script files
  return [
    ...new Set(matches.map((p) => p.replace(/\\/g, "/"))),
  ].filter((p) => {
    const ext = p.slice(p.lastIndexOf(".")).toLowerCase();
    return !SCRIPT_EXTS.has(ext);
  });
}

/**
 * Shell sandbox — block irreversibly destructive commands.
 * Returns an error message if blocked, or null if allowed.
 * Disable entirely with SHELL_SANDBOX=false.
 */
function validateCommand(command: string): string | null {
  if (process.env.SHELL_SANDBOX === "false") return null;

  const cmd = command.trim();

  // Dangerous patterns: each entry is [regex, description]
  const BLOCKED: [RegExp, string][] = [
    // rm -rf targeting root or system dirs
    [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-[a-zA-Z]*f[a-zA-Z]*r))\s+\/(?:\s|$)/, "rm -rf /（根目录递归删除）"],
    [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-[a-zA-Z]*f[a-zA-Z]*r))\s+\/(?:boot|etc|usr|var|bin|sbin|lib|proc|sys)\b/, "rm -rf 系统目录"],
    // Windows destructive: del /s targeting system root, format, mkfs
    [/\bdel\s+\/[sS]\s+\/[qQ]\s+[A-Za-z]:\\\s*$/, "del /s /q 驱动器根目录"],
    [/\bformat\s+[A-Za-z]:/i, "format 磁盘"],
    [/\bmkfs\b/, "mkfs 格式化文件系统"],
    // System control
    [/\bshutdown\b/, "shutdown 关机"],
    [/\breboot\b/, "reboot 重启"],
    [/\bhalt\b/, "halt 停机"],
    [/\binit\s+0\b/, "init 0 关机"],
    // Fork bomb
    [/:\(\)\s*\{/, "fork bomb"],
    [/\.\s*\/dev\/urandom\s*\|/, "fork/资源滥用"],
    // dd to block devices
    [/\bdd\b.*\bof=\/dev\/[sh]d[a-z]/, "dd 写入磁盘设备"],
    // fdisk
    [/\bfdisk\s+\/dev\//, "fdisk 磁盘分区"],
    // Windows registry delete on system hives
    [/\breg\s+delete\s+HK(LM|CR|U\\)/i, "reg delete 系统注册表"],
    // Writing to critical Windows system paths
    [/[>|]\s*["']?C:\\Windows\\System32/i, "写入 System32"],
  ];

  for (const [re, desc] of BLOCKED) {
    if (re.test(cmd)) {
      return `🛡️ 沙箱拦截：${desc}\n命令被阻止执行。如需禁用沙箱，请设置环境变量 SHELL_SANDBOX=false`;
    }
  }

  return null;
}

/** Execute the shell command and return a ToolResult */
function runShell(
  command: string,
  timeout: number,
  shellChoice?: string,
): Promise<ToolResult> {
  const useShell =
    shellChoice === "powershell" && process.platform === "win32"
      ? powershellConfig
      : detectedShell;
  const { shell, args } = useShell;

  return new Promise<ToolResult>((resolve) => {
    execFile(
      shell,
      args(command),
      {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "buffer",
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      },
      (error, stdout, stderr) => {
        const stdoutStr = stdout ? decodeOutput(stdout) : "";
        const stderrStr = stderr ? decodeOutput(stderr) : "";
        const output = [stdoutStr, stderrStr].filter(Boolean).join("\n");

        // 截断过长输出，节省 token
        const MAX_OUTPUT_CHARS = 20_000;
        const truncatedOutput =
          output.length > MAX_OUTPUT_CHARS
            ? output.slice(0, MAX_OUTPUT_CHARS) +
              `\n... [truncated, ${output.length - MAX_OUTPUT_CHARS} chars omitted]`
            : output;

        if (error) {
          if (error.killed) {
            resolve({
              content: `Command timed out after ${timeout}ms\n${truncatedOutput}`,
              isError: true,
              metadata: { exitCode: null, timedOut: true },
            });
            return;
          }

          const hasOutput = stdoutStr.trim().length > 0;
          resolve({
            content: truncatedOutput || error.message,
            isError: !hasOutput,
            metadata: { exitCode: error.code ?? 1 },
          });
          return;
        }

        resolve({
          content: truncatedOutput,
          isError: false,
          metadata: { exitCode: 0 },
        });
      },
    );
  });
}

export const shellTool: Tool = {
  name: "bash",
  description: `Execute a ${detectedShell.name} command.${process.platform === "win32" && detectedShell.name === "bash" ? ' Use shell="powershell" for Windows-specific tasks.' : ""} Set auto_send=true to automatically deliver output files to the user.`,
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout: { type: "number", default: DEFAULT_TIMEOUT },
      auto_send: {
        type: "boolean",
        description:
          "Automatically send output files to user. Skips the need for a separate send_file call.",
      },
      ...(process.platform === "win32" && detectedShell.name === "bash"
        ? {
            shell: {
              type: "string",
              enum: ["bash", "powershell"],
            },
          }
        : {}),
    },
    required: ["command"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const command = input.command as string;
    let timeout = (input.timeout as number) ?? DEFAULT_TIMEOUT;
    const shellChoice = input.shell as string | undefined;

    if (timeout > 0 && timeout < 1000) {
      console.log(
        `[shell] Auto-corrected timeout: ${timeout}ms → ${timeout * 1000}ms`,
      );
      timeout *= 1000;
    }
    const autoSend = input.auto_send as boolean | undefined;

    // Shell sandbox: block destructive commands
    const blocked = validateCommand(command);
    if (blocked) {
      return { content: blocked, isError: true };
    }

    // Auto-detect PowerShell commands on Windows and route to powershell executor
    // Prevents $var interpolation issues when running PowerShell through Git Bash
    const effectiveShell =
      shellChoice ??
      (process.platform === "win32" &&
      detectedShell.name === "bash" &&
      /^\s*powershell\b/i.test(command)
        ? "powershell"
        : undefined);

    // When auto-routing to powershell, strip the leading "powershell -Command" wrapper
    // since powershellConfig already handles that
    let effectiveCommand = command;
    if (
      effectiveShell === "powershell" &&
      !shellChoice &&
      /^\s*powershell\s+(-\w+\s+)*-Command\s+/i.test(command)
    ) {
      effectiveCommand = command.replace(
        /^\s*powershell\s+(-\w+\s+)*-Command\s+/i,
        "",
      );
      // Remove outer quotes if present
      if (
        (effectiveCommand.startsWith('"') && effectiveCommand.endsWith('"')) ||
        (effectiveCommand.startsWith("'") && effectiveCommand.endsWith("'"))
      ) {
        effectiveCommand = effectiveCommand.slice(1, -1);
      }
    }

    const result = await runShell(effectiveCommand, timeout, effectiveShell);

    const MAX_CONTENT = 8000;
    if (result.content.length > MAX_CONTENT) {
      const total = result.content.length;
      result.content =
        result.content.slice(0, 3000) +
        `\n...(truncated ${total} chars, showing first 3000 and last 3000)...\n` +
        result.content.slice(-3000);
    }

    // Detect output files and send to frontend for inline display.
    // auto_send=true: scan stdout for file paths (e.g. ffmpeg progress output)
    // auto_send unset: only scan the command itself (avoid sending files listed by ls/find)
    if (!result.isError && context?.sendFile) {
      let paths: string[];
      if (autoSend) {
        paths = detectFilePaths(result.content);
        if (paths.length === 0) {
          paths = detectFilePaths(command);
        }
      } else {
        paths = detectFilePaths(command);
      }
      let sentCount = 0;
      for (const filePath of paths) {
        if (existsSync(filePath)) {
          try {
            await context.sendFile(filePath, basename(filePath));
            sentCount++;
          } catch {
            // send failed — continue
          }
        }
      }
      if (autoSend && sentCount > 0) {
        result.autoComplete = true;
      }
    }

    return result;
  },
};
