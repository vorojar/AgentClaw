import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

const DEFAULT_TIMEOUT = 30_000;

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

/** Detect file paths pointing to data/tmp in a string */
const FILE_PATH_RE =
  /(?:[A-Za-z]:)?(?:\/[\w.@+-]+)*\/data\/tmp\/[\w.@+-]+\.(?:png|jpe?g|gif|webp|svg|bmp|mp4|mp3|wav|pdf|zip)/gi;

function detectFilePaths(text: string): string[] {
  const matches = text.match(FILE_PATH_RE) || [];
  return [...new Set(matches)];
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

    const result = await runShell(command, timeout, shellChoice);

    const MAX_CONTENT = 8000;
    if (result.content.length > MAX_CONTENT) {
      const total = result.content.length;
      result.content =
        result.content.slice(0, 3000) +
        `\n...(truncated ${total} chars, showing first 3000 and last 3000)...\n` +
        result.content.slice(-3000);
    }

    // Auto-send: detect output files, send them, signal auto-complete
    // Prefer paths from output (generated results); fallback to command (e.g. screenshot)
    if (autoSend && !result.isError && context?.sendFile) {
      let paths = detectFilePaths(result.content);
      if (paths.length === 0) {
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
      if (sentCount > 0) {
        result.autoComplete = true;
      }
    }

    return result;
  },
};
