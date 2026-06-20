import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type {
  Tool,
  ToolEffect,
  ToolResult,
  ToolExecutionContext,
} from "@agentclaw/types";

const DEFAULT_TIMEOUT = 120_000;

function classifyShellEffect(command: string, verified: boolean): ToolEffect {
  const normalized = command.replace(/\\/g, "/");
  if (
    /\b(?:rm\s+-rf|remove-item\b[\s\S]*\b-recurse\b|del\s+\/[fsq]|rd\s+\/s|git\s+clean\s+-f|git\s+reset\s+--hard)\b/i.test(
      normalized,
    )
  ) {
    return { kind: "delete", reversible: false, verified };
  }
  if (
    /(?:^|[;&|]\s*)(?:mkdir|touch|cp|copy|move|mv|new-item|set-content|add-content)\b|(?:^|[^>])>>?[^>]/i.test(
      normalized,
    )
  ) {
    return { kind: "write", reversible: false, verified };
  }
  return { kind: "read", reversible: false, verified };
}

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
    const bashPath = `${gitRoot}\\bin\\bash.exe`;
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
      `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${cmd}`,
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
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${cmd}`,
  ],
  name: "powershell" as const,
};

/**
 * Strip ANSI escape sequences (colors, cursor control, etc.) from text.
 * These are pure noise for LLMs and waste tokens.
 */
const ANSI_RE = new RegExp(
  "[\\u001b\\u009b][\\[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]",
  "g",
);
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/**
 * Decode raw bytes from child process output.
 * Try UTF-8 first; if it contains invalid sequences (common when Windows
 * native programs output GBK/CP936), fall back to GBK decoding.
 * Also strips ANSI escape sequences — they waste LLM tokens.
 */
function decodeOutput(buf: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // GBK / GB18030 fallback for Chinese Windows
    text = new TextDecoder("gbk").decode(buf);
  }
  return stripAnsi(text);
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
  return [...new Set(matches.map((p) => p.replace(/\\/g, "/")))].filter((p) => {
    const ext = p.slice(p.lastIndexOf(".")).toLowerCase();
    return !SCRIPT_EXTS.has(ext);
  });
}

const POWERSHELL_DIALECT_RE =
  /(?:^|\s)(?:Get-ChildItem|Get-Content|Set-Content|Add-Content|New-Item|Remove-Item|Copy-Item|Move-Item|Select-String|Where-Object|ForEach-Object|Out-String|Start-Process)\b|\$env:|\b-LiteralPath\b/i;

const WINDOWS_SYSTEM_POWERSHELL_RE =
  /\b(?:Get-ItemProperty|Get-CimInstance|Get-WmiObject|Get-Service|Set-Service|Restart-Service|Start-Service|Stop-Service)\b|\b(?:HKLM:|HKCU:|HKCR:|HKU:)|\b(?:reg|sc|netsh)\.exe\b/i;

function stripPowerShellWrapper(command: string): string {
  return command
    .replace(/^\s*(?:pwsh|powershell)(?:\.exe)?\s+/i, "")
    .replace(/^(?:-[A-Za-z]+\s+)*/i, "")
    .replace(/^-Command\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function validateCrossPlatformShell(command: string): string | null {
  const cmd = command.trim();
  const isWrappedPowerShell = /^\s*(?:pwsh|powershell)(?:\.exe)?\b/i.test(cmd);
  const body = isWrappedPowerShell ? stripPowerShellWrapper(cmd) : cmd;

  if (!isWrappedPowerShell && !POWERSHELL_DIALECT_RE.test(body)) return null;
  if (WINDOWS_SYSTEM_POWERSHELL_RE.test(body)) return null;

  return [
    "跨平台 shell 策略拦截：普通文件、搜索、构建和项目操作必须使用 Linux/macOS/Windows 通用命令或专用工具。",
    "建议：列目录用 `ls`，搜索用 `grep`/`rg`，读文件用 `file_read`，写文件用 `file_write`/`file_edit`，构建测试直接用 `pnpm`/`npm`/`git` 等通用 CLI。",
    "PowerShell 仅用于注册表、WMI/CIM、Windows 服务等系统专项操作。",
  ].join("\n");
}

/**
 * Shell sandbox — block irreversibly destructive commands.
 * Returns an error message if blocked, or null if allowed.
 * Disable entirely with SHELL_SANDBOX=false.
 */
function validateCommand(command: string): string | null {
  if (process.env.SHELL_SANDBOX === "false") return null;

  const cmd = command.trim();
  const crossPlatformError = validateCrossPlatformShell(cmd);
  if (crossPlatformError) return crossPlatformError;

  // Dangerous patterns: each entry is [regex, description]
  const BLOCKED: [RegExp, string][] = [
    // rm -rf targeting root or system dirs
    [
      /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-[a-zA-Z]*f[a-zA-Z]*r))\s+\/(?:\s|$)/,
      "rm -rf /（根目录递归删除）",
    ],
    [
      /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-[a-zA-Z]*f[a-zA-Z]*r))\s+\/(?:boot|etc|usr|var|bin|sbin|lib|proc|sys)\b/,
      "rm -rf 系统目录",
    ],
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
    // Dump all environment variables (may contain secrets)
    [/\bprintenv\b/, "printenv 泄露环境变量"],
    // Read sensitive /proc entries
    [/\bcat\s+[^\n]*\/proc\//, "读取 /proc 系统文件"],
    // Cloud metadata service (AWS/GCP/Azure instance metadata)
    [/\bcurl\b[^\n]*169\.254/, "curl 访问云元数据服务"],
    [/\bwget\b[^\n]*169\.254/, "wget 访问云元数据服务"],
  ];

  for (const [re, desc] of BLOCKED) {
    if (re.test(cmd)) {
      return `🛡️ 沙箱拦截：${desc}\n命令被阻止执行。`;
    }
  }

  return null;
}

/**
 * Progress line detection patterns.
 * Each pattern extracts a human-readable summary from long-running commands.
 */
const PROGRESS_PATTERNS: {
  test: RegExp;
  extract: (line: string) => string | null;
}[] = [
  // yt-dlp: [download]  45.3% of 150.00MiB at 12.5MiB/s ETA 00:08
  {
    test: /\[download\]\s+[\d.]+%/,
    extract: (line) => {
      const m = line.match(
        /\[download\]\s+([\d.]+%)\s+of\s+~?([\d.]+\S+)(?:\s+at\s+([\d.]+\S+))?(?:\s+ETA\s+(\S+))?/,
      );
      if (!m) return null;
      const parts = [`下载中: ${m[1]} / ${m[2]}`];
      if (m[3]) parts.push(m[3]);
      if (m[4]) parts.push(`ETA ${m[4]}`);
      return parts.join(" | ");
    },
  },
  // yt-dlp: [download] Destination: filename
  {
    test: /\[download\]\s+Destination:/,
    extract: (line) => {
      const name = line.replace(/.*Destination:\s*/, "").trim();
      const short = name.length > 50 ? `...${name.slice(-47)}` : name;
      return `开始下载: ${short}`;
    },
  },
  // yt-dlp: [Merger] Merging formats into ...
  {
    test: /\[Merger\]/,
    extract: () => "合并音视频中...",
  },
  // ffmpeg: frame=  123 fps= 30 ... time=00:00:04.10
  {
    test: /frame=\s*\d+.*time=/,
    extract: (line) => {
      const t = line.match(/time=(\S+)/);
      const s = line.match(/speed=\s*(\S+)/);
      const parts = ["编码中"];
      if (t) parts.push(t[1]);
      if (s) parts.push(`${s[1]}x`);
      return parts.join(" | ");
    },
  },
];

/** Try to extract a progress message from a raw output line */
function extractProgress(line: string): string | null {
  for (const p of PROGRESS_PATTERNS) {
    if (p.test.test(line)) return p.extract(line);
  }
  return null;
}

/** Execute the shell command and return a ToolResult */
function runShell(
  command: string,
  timeout: number,
  shellChoice?: string,
  abortSignal?: AbortSignal,
  extraEnv?: Record<string, string>,
  onProgress?: (message: string) => void,
  onStart?: (pid: number) => void,
): Promise<ToolResult> {
  const useShell =
    shellChoice === "powershell" && process.platform === "win32"
      ? powershellConfig
      : detectedShell;
  const { shell, args } = useShell;

  // ── Streaming mode (with progress callback) ──
  if (onProgress) {
    return new Promise<ToolResult>((resolve) => {
      let aborted = false;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let lastProgressAt = 0;
      const THROTTLE_MS = 3000;
      let timedOut = false;

      const child = spawn(shell, args(command), {
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
          ...extraEnv,
        },
      });
      if (child.pid) onStart?.(child.pid);

      // Timeout handling
      const timer = setTimeout(() => {
        timedOut = true;
        if (process.platform === "win32" && child.pid) {
          execFile(
            "taskkill",
            ["/F", "/T", "/PID", String(child.pid)],
            { windowsHide: true },
            () => {},
          );
        } else {
          child.kill();
        }
      }, timeout);

      const handleData = (chunk: Buffer, isStderr: boolean) => {
        if (isStderr) stderrChunks.push(chunk);
        else stdoutChunks.push(chunk);

        // Try to extract progress from the latest chunk
        const now = Date.now();
        if (now - lastProgressAt < THROTTLE_MS) return;

        const text = decodeOutput(chunk);
        // Split by \r or \n to get the latest "line"
        const lines = text.split(/[\r\n]+/).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          const msg = extractProgress(lines[i]);
          if (msg) {
            lastProgressAt = now;
            onProgress(msg);
            return;
          }
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => handleData(chunk, false));
      child.stderr?.on("data", (chunk: Buffer) => handleData(chunk, true));

      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (aborted) {
          resolve({
            content: "Command aborted by user.",
            isError: true,
            metadata: { exitCode: null, aborted: true },
          });
          return;
        }
        const stdoutStr = stdoutChunks.length
          ? decodeOutput(Buffer.concat(stdoutChunks))
          : "";
        const stderrStr = stderrChunks.length
          ? decodeOutput(Buffer.concat(stderrChunks))
          : "";
        const output = [stdoutStr, stderrStr].filter(Boolean).join("\n");

        if (timedOut) {
          resolve({
            content: `Command timed out after ${timeout}ms\n${output}`,
            isError: true,
            metadata: { exitCode: null, timedOut: true },
          });
          return;
        }

        const exitCode = code ?? (signal ? 1 : 0);
        resolve({
          content: output,
          isError: exitCode !== 0,
          metadata: { exitCode },
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          content: err.message,
          isError: true,
          metadata: { exitCode: 1 },
        });
      });

      // Abort signal
      if (abortSignal) {
        const killChild = () => {
          aborted = true;
          clearTimeout(timer);
          if (process.platform === "win32" && child.pid) {
            execFile(
              "taskkill",
              ["/F", "/T", "/PID", String(child.pid)],
              { windowsHide: true },
              () => {},
            );
          } else {
            child.kill();
          }
        };
        if (abortSignal.aborted) {
          killChild();
        } else {
          abortSignal.addEventListener("abort", killChild, { once: true });
          child.on("close", () =>
            abortSignal.removeEventListener("abort", killChild),
          );
        }
      }
    });
  }

  // ── Buffered mode (original behavior, no progress) ──
  return new Promise<ToolResult>((resolve) => {
    let aborted = false;
    const child = execFile(
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
          ...extraEnv,
        },
      },
      (error, stdout, stderr) => {
        if (aborted) {
          resolve({
            content: "Command aborted by user.",
            isError: true,
            metadata: { exitCode: null, aborted: true },
          });
          return;
        }
        const stdoutStr = stdout ? decodeOutput(stdout) : "";
        const stderrStr = stderr ? decodeOutput(stderr) : "";
        const output = [stdoutStr, stderrStr].filter(Boolean).join("\n");

        if (error) {
          if (error.killed) {
            resolve({
              content: `Command timed out after ${timeout}ms\n${output}`,
              isError: true,
              metadata: { exitCode: null, timedOut: true },
            });
            return;
          }

          resolve({
            content: output || error.message,
            isError: true,
            metadata: {
              exitCode: typeof error.code === "number" ? error.code : 1,
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
    if (child.pid) onStart?.(child.pid);

    // Abort signal: kill child process when user stops the agent
    if (abortSignal) {
      const killChild = () => {
        aborted = true;
        if (process.platform === "win32" && child.pid) {
          execFile(
            "taskkill",
            ["/F", "/T", "/PID", String(child.pid)],
            { windowsHide: true },
            () => {},
          );
        } else {
          child.kill();
        }
      };
      if (abortSignal.aborted) {
        killChild();
      } else {
        abortSignal.addEventListener("abort", killChild, { once: true });
        child.on("close", () =>
          abortSignal.removeEventListener("abort", killChild),
        );
      }
    }
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
      background: {
        type: "boolean",
        description:
          "Run command in background. Returns immediately with a task ID; you'll be notified when it completes. Use for long-running commands (build, test, install) so you can continue other work.",
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
    // Normalize: LLMs send boolean, "true", "True", "false", "False" etc.
    const autoSend =
      input.auto_send === true ||
      String(input.auto_send).toLowerCase() === "true";
    const background = input.background as boolean | undefined;

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

    const extraEnv: Record<string, string> = {};
    if (context?.workDir) extraEnv.WORKDIR = context.workDir;

    // ── Background mode: fire-and-forget, agent continues working ──
    if (background) {
      const bgId = `bg_${Date.now().toString(36)}`;
      const shortCmd =
        command.length > 60 ? `${command.slice(0, 60)}...` : command;
      const startedAt = new Date();
      let pid: number | undefined;
      // Initialize queue if needed
      if (context && !context.backgroundQueue) context.backgroundQueue = [];
      const task = runShell(
        effectiveCommand,
        timeout,
        effectiveShell,
        context?.abortSignal,
        extraEnv,
        undefined,
        (childPid) => {
          pid = childPid;
        },
      );
      await context?.recordBackgroundJob?.({
        id: bgId,
        command,
        status: "running",
        pid,
        conversationId: context?.conversationId,
        traceId: context?.traceId,
        agentId: context?.agentId,
        startedAt,
      });
      // Fire and forget — push result to queue when done
      task.then(
        (r) => {
          context?.backgroundQueue?.push({
            id: bgId,
            command: shortCmd,
            content: r.content,
            isError: !!r.isError,
            completedAt: new Date(),
          });
          const exitCode =
            typeof r.metadata?.exitCode === "number"
              ? r.metadata.exitCode
              : r.metadata?.exitCode === null
                ? null
                : undefined;
          const status = r.isError ? "failed" : "completed";
          context?.updateBackgroundJob?.(bgId, {
            status,
            exitCode,
            output: r.content,
            error: r.isError ? r.content : null,
            completedAt: new Date(),
          });
          context
            ?.notifyUser?.(`Background task ${bgId} ${status}: ${shortCmd}`)
            .catch(() => {});
        },
        (err) => {
          const content = `Background task failed: ${err instanceof Error ? err.message : String(err)}`;
          context?.backgroundQueue?.push({
            id: bgId,
            command: shortCmd,
            content,
            isError: true,
            completedAt: new Date(),
          });
          context?.updateBackgroundJob?.(bgId, {
            status: "failed",
            exitCode: undefined,
            output: content,
            error: content,
            completedAt: new Date(),
          });
          context
            ?.notifyUser?.(`Background task ${bgId} failed: ${shortCmd}`)
            .catch(() => {});
        },
      );
      return {
        content: `Background task started (${bgId}${pid ? `, pid ${pid}` : ""}): \`${shortCmd}\`\nYou'll be notified when it completes. Continue with other work.`,
        isError: false,
        metadata: { backgroundId: bgId, pid },
        effect: {
          kind: "external",
          target: bgId,
          reversible: false,
          cleanupId: bgId,
          verified: true,
        },
      };
    }

    // Enable streaming progress for long-running commands (yt-dlp, ffmpeg, etc.)
    const progressFn =
      context?.notifyUser &&
      /\b(yt-dlp|youtube-dl|ffmpeg|ffprobe)\b/.test(effectiveCommand)
        ? (msg: string) => {
            context.notifyUser!(msg).catch(() => {});
          }
        : undefined;

    const result = await runShell(
      effectiveCommand,
      timeout,
      effectiveShell,
      context?.abortSignal,
      extraEnv,
      progressFn,
    );

    const MAX_CONTENT = 12_000;
    if (result.content.length > MAX_CONTENT) {
      const half = 5000;
      const total = result.content.length;
      result.content =
        result.content.slice(0, half) +
        `\n\n... (${total} chars total, showing first and last ${half}) ...\n\n` +
        result.content.slice(-half);
    }

    // Detect output files and send to frontend for inline display only when the
    // caller explicitly requests that side effect.
    if (!result.isError && context?.sendFile && autoSend) {
      let paths: string[];
      paths = detectFilePaths(result.content);
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
        result.effect = {
          kind: "send",
          target: paths.filter((filePath) => existsSync(filePath)).join(","),
          reversible: false,
          deliverable: true,
          verified: true,
        };
      }
    }

    result.effect ??= classifyShellEffect(effectiveCommand, !result.isError);
    return result;
  },
};
