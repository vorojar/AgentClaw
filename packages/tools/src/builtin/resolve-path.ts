import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";

/**
 * Resolve file paths with platform-specific fixes:
 * - Windows Git Bash maps /tmp/ to OS temp dir
 * - Relative paths resolve to per-session workDir
 */
export function resolveFilePath(filePath: string, workDir?: string): string {
  if (
    process.platform === "win32" &&
    (filePath.startsWith("/tmp/") || filePath === "/tmp")
  ) {
    return filePath.replace(/^\/tmp/, tmpdir());
  }
  if (workDir && !isAbsolute(filePath)) {
    return resolve(workDir, filePath);
  }
  return filePath;
}
