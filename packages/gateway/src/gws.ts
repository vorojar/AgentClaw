/**
 * gws CLI helper — runs `gws` commands and returns parsed JSON.
 */
import { execFile } from "node:child_process";

export interface GwsResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Execute a gws CLI command and return parsed JSON output.
 * @param args - Arguments to pass to `gws` (e.g. ["tasks", "tasks", "list", "--params", "..."])
 * @param timeoutMs - Timeout in milliseconds (default 30s)
 */
export function runGws(args: string[], timeoutMs = 30_000): Promise<GwsResult> {
  return new Promise((resolve) => {
    execFile(
      "gws",
      args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = stderr?.trim() || err.message;
          resolve({ ok: false, error: msg });
          return;
        }
        try {
          const data = JSON.parse(stdout);
          resolve({ ok: true, data });
        } catch {
          // Not JSON — return raw text
          resolve({ ok: true, data: stdout.trim() });
        }
      },
    );
  });
}
