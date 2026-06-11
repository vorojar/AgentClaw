import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ignore, { type Ignore } from "ignore";

const IGNORE_FILENAME = ".agentclawignore";

/**
 * Load .agentclawignore from the given directory and return a compiled Ignore instance.
 * Falls back to empty rules if the file doesn't exist.
 */
async function loadIgnoreFile(dir: string): Promise<Ignore> {
  const ig = ignore();
  try {
    const content = await readFile(join(dir, IGNORE_FILENAME), "utf-8");
    ig.add(content);
  } catch {
    // file doesn't exist — no custom ignore rules
  }
  return ig;
}

/**
 * Build a check function from .agentclawignore in the given workDir.
 * Returns a function that takes an absolute path and returns true if it should be ignored.
 * Also checks the hardcoded BLOCKED_PATTERNS from file-read for consistency.
 */
export async function buildIgnoreCheck(
  workDir: string,
): Promise<(absolutePath: string) => boolean> {
  const ig = await loadIgnoreFile(workDir);
  const resolvedWorkDir = resolve(workDir);

  // Hardcoded sensitive file patterns (same as file-read.ts BLOCKED_PATTERNS)
  const BLOCKED_PATTERNS = [
    /\.env(\.[a-z]+)?$/i,
    /credentials\.json$/i,
    /secrets?\.json$/i,
    /\.pem$/i,
    /\.key$/i,
    /id_rsa/i,
    /id_ed25519/i,
    /\.ssh\/config$/i,
  ];
  const BLOCKED_PATH_PREFIXES = ["/proc/", "/sys/", "/dev/"];

  return (absolutePath: string): boolean => {
    const normalized = absolutePath.replace(/\\/g, "/");
    const basename = normalized.split("/").pop() || "";

    // Check hardcoded blocked patterns
    if (
      BLOCKED_PATTERNS.some((p) => p.test(basename) || p.test(normalized)) ||
      BLOCKED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ) {
      return true;
    }

    // Check .agentclawignore rules using relative path
    const rel = relative(resolvedWorkDir, resolve(absolutePath))
      .split(sep)
      .join("/");
    if (rel.startsWith("..")) return false; // outside workDir, don't apply ignore
    return ig.ignores(rel);
  };
}

/**
 * Merge .agentclawignore patterns into a fast-glob ignore array.
 * Returns the combined ignore patterns as glob strings.
 */
export async function loadIgnorePatterns(workDir: string): Promise<string[]> {
  const ig = await loadIgnoreFile(workDir);
  // The ignore package doesn't export raw patterns easily,
  // so we read the file directly and convert to glob patterns
  try {
    const content = await readFile(join(workDir, IGNORE_FILENAME), "utf-8");
    const patterns: string[] = [];
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.startsWith("!")) continue; // skip negation for glob merge
      // Convert gitignore-style to glob: prefix with **/ if no path separator
      if (!trimmed.includes("/")) {
        patterns.push(`**/${trimmed}`);
      } else if (trimmed.endsWith("/")) {
        patterns.push(`**/${trimmed}**`);
      } else {
        patterns.push(trimmed);
      }
    }
    return patterns;
  } catch {
    return [];
  }
}

/**
 * Synchronous version of buildIgnoreCheck for use during context setup.
 * Uses readFileSync to load .agentclawignore once.
 */
export function buildIgnoreCheckSync(
  workDir: string,
): (absolutePath: string) => boolean {
  const ig = ignore();
  try {
    const content = readFileSync(join(workDir, IGNORE_FILENAME), "utf-8");
    ig.add(content);
  } catch {
    // file doesn't exist — no custom ignore rules
  }

  const resolvedWorkDir = resolve(workDir);

  const BLOCKED_PATTERNS = [
    /\.env(\.[a-z]+)?$/i,
    /credentials\.json$/i,
    /secrets?\.json$/i,
    /\.pem$/i,
    /\.key$/i,
    /id_rsa/i,
    /id_ed25519/i,
    /\.ssh\/config$/i,
  ];
  const BLOCKED_PATH_PREFIXES = ["/proc/", "/sys/", "/dev/"];

  return (absolutePath: string): boolean => {
    const normalized = absolutePath.replace(/\\/g, "/");
    const bn = normalized.split("/").pop() || "";

    if (
      BLOCKED_PATTERNS.some((p) => p.test(bn) || p.test(normalized)) ||
      BLOCKED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ) {
      return true;
    }

    const rel = relative(resolvedWorkDir, resolve(absolutePath))
      .split(sep)
      .join("/");
    if (rel.startsWith("..")) return false;
    return ig.ignores(rel);
  };
}
