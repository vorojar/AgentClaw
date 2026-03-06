import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

const execFileAsync = promisify(execFile);

/** Combine stdout and stderr with labeled sections */
function combineOutput(stdout?: string, stderr?: string): string {
  let result = stdout || "";
  if (stderr) result += (result ? "\n[stderr]\n" : "[stderr]\n") + stderr;
  return result || "(no output)";
}

/** Truncate output to a maximum character length, keeping head and tail */
function truncateOutput(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return (
    text.slice(0, half) +
    `\n\n... (${text.length} chars total, truncated) ...\n\n` +
    text.slice(-half)
  );
}

const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_IMAGE = "node:22-slim";

/**
 * Check if Docker daemon is available.
 * Caches the result for 60s to avoid repeated checks.
 */
let dockerAvailable: boolean | null = null;
let dockerCheckedAt = 0;

async function isDockerAvailable(): Promise<boolean> {
  if (dockerAvailable !== null && Date.now() - dockerCheckedAt < 60_000) {
    return dockerAvailable;
  }
  try {
    await execFileAsync("docker", ["info"], {
      timeout: 5000,
      windowsHide: true,
    });
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
  dockerCheckedAt = Date.now();
  return dockerAvailable;
}

export const sandboxTool: Tool = {
  name: "sandbox",
  category: "builtin",
  description:
    "Execute a command inside a Docker container for safe, isolated execution. " +
    "Use this for potentially dangerous operations, untrusted code, or tasks that " +
    "might affect the host system. Default image: node:22-slim.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to execute inside the container",
      },
      image: {
        type: "string",
        description: `Docker image to use (default: ${DEFAULT_IMAGE})`,
      },
      workdir: {
        type: "string",
        description:
          "Host directory to mount into the container at /workspace (default: current directory)",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 120000)",
      },
      readonly: {
        type: "string",
        description:
          'Mount workdir as read-only (default: false). Set to "true" for safe read operations.',
      },
    },
    required: ["command"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const command = input.command as string;
    const image = (input.image as string) || DEFAULT_IMAGE;
    const workdir =
      (input.workdir as string) || context?.workDir || process.cwd();
    let timeout = (input.timeout as number) ?? DEFAULT_TIMEOUT;
    const readonly = (input.readonly as string) === "true";

    // Auto-correct sub-second timeouts (likely passed in seconds)
    if (timeout > 0 && timeout < 1000) {
      timeout *= 1000;
    }

    // Check Docker availability
    if (!(await isDockerAvailable())) {
      return {
        content:
          "Docker is not available. Please install Docker and ensure the daemon is running.\n" +
          "Install: https://docs.docker.com/get-docker/",
        isError: true,
      };
    }

    // Convert Windows paths to forward slashes for Docker volume mounts
    const workdirUnix = workdir.replace(/\\/g, "/");
    const mountFlag = readonly ? "ro" : "rw";

    const args = [
      "run",
      "--rm",
      "--network=host",
      "-v",
      `${workdirUnix}:/workspace:${mountFlag}`,
      "-w",
      "/workspace",
      "--memory=512m",
      "--cpus=1",
      image,
      "sh",
      "-c",
      command,
    ];

    const MAX_CONTENT = 50_000;

    try {
      const { stdout, stderr } = await execFileAsync("docker", args, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf-8",
      });

      return {
        content: truncateOutput(combineOutput(stdout, stderr), MAX_CONTENT),
        isError: false,
        metadata: { exitCode: 0, image },
      };
    } catch (err: unknown) {
      const error = err as {
        code?: string | number;
        killed?: boolean;
        stdout?: string;
        stderr?: string;
        message?: string;
      };

      if (error.killed) {
        return {
          content: `Command timed out after ${timeout / 1000}s.\nThe container has been removed.`,
          isError: true,
          metadata: { exitCode: null, timedOut: true, image },
        };
      }

      const combined = combineOutput(error.stdout, error.stderr);
      const output = combined === "(no output)"
        ? (error.message || "Unknown error")
        : combined;

      const exitCode =
        typeof error.code === "number"
          ? error.code
          : typeof error.code === "string"
            ? Number.parseInt(error.code, 10) || 1
            : 1;

      return {
        content: `Exit code: ${exitCode}\n${truncateOutput(output, MAX_CONTENT)}`,
        isError: exitCode !== 0,
        metadata: { exitCode, image },
      };
    }
  },
};
