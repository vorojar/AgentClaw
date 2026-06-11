/**
 * Guardian — rule-based security audit for tool calls.
 *
 * Classifies tool calls into risk levels and blocks/warns accordingly.
 * v1: pure rule-based (no LLM call), fast and zero-cost.
 */

export type RiskLevel = "low" | "medium" | "high";

export interface GuardianVerdict {
  risk: RiskLevel;
  allow: boolean;
  reason?: string;
}

// High-risk shell patterns: destructive or irreversible
const HIGH_RISK_SHELL = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/i, // rm -rf
  /\brm\s+(-[a-zA-Z]*r)\b/i, // rm -r (recursive delete)
  /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|push\s+.*--force|checkout\s+--\s)/i,
  /\b(format|mkfs|fdisk|dd)\b/i,
  /\b(chmod|chown)\s+777\b/i,
  /\bshutdown\b|\breboot\b/i,
  /\b(curl|wget)\s+.*\|\s*(sh|bash|zsh)\b/i, // pipe to shell
  />\s*\/dev\/sd[a-z]/i, // write to disk device
  /\bdel\s+\/[sfq]\s/i, // Windows recursive delete
  /\brmdir\s+\/s\s/i,
];

// Medium-risk shell patterns: installs, network, privilege changes
const MEDIUM_RISK_SHELL = [
  /\b(npm|yarn|pnpm)\s+(install|add|publish)\b/i,
  /\b(pip|pip3)\s+install\b/i,
  /\bcurl\b|\bwget\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\bsudo\b/i,
  /\bdocker\s+(run|exec|push)\b/i,
  /\bgit\s+push\b/i,
  /\bnpx\b/i,
];

// Paths that should never be written to
const PROTECTED_PATHS = [
  /\/(etc|usr|bin|sbin|lib|sys|proc|dev)\//i,
  /\.ssh\//i,
  /\.gnupg\//i,
  /\.aws\//i,
  /\.azure\//i,
  /\.gcloud\//i,
  /\/node_modules\//i, // writing into node_modules is suspicious
];

// Config files that warrant a warning on write
const SENSITIVE_CONFIG = [
  /package\.json$/i,
  /tsconfig\.json$/i,
  /\.eslintrc/i,
  /\.prettierrc/i,
  /vite\.config/i,
  /webpack\.config/i,
  /Cargo\.toml$/i,
  /go\.mod$/i,
];

/**
 * Evaluate the risk level of a tool call.
 */
export function evaluateRisk(
  toolName: string,
  input: Record<string, unknown>,
): GuardianVerdict {
  // Shell command evaluation
  if (toolName === "bash") {
    const cmd = String(input.command || input.cmd || "");
    for (const pattern of HIGH_RISK_SHELL) {
      if (pattern.test(cmd)) {
        return {
          risk: "high",
          allow: false,
          reason: `Blocked: high-risk command matches ${pattern.source}`,
        };
      }
    }
    for (const pattern of MEDIUM_RISK_SHELL) {
      if (pattern.test(cmd)) {
        return {
          risk: "medium",
          allow: true,
          reason: `Warning: command may have side effects — ${pattern.source}`,
        };
      }
    }
    return { risk: "low", allow: true };
  }

  // File write/edit evaluation
  if (toolName === "file_write" || toolName === "file_edit") {
    const filePath = String(input.path || "").replace(/\\/g, "/");

    // Check protected paths
    for (const pattern of PROTECTED_PATHS) {
      if (pattern.test(filePath)) {
        return {
          risk: "high",
          allow: false,
          reason: `Blocked: cannot write to protected path ${filePath}`,
        };
      }
    }

    // Check sensitive config files
    for (const pattern of SENSITIVE_CONFIG) {
      if (pattern.test(filePath)) {
        return {
          risk: "medium",
          allow: true,
          reason: `Warning: modifying config file ${filePath.split("/").pop()}`,
        };
      }
    }

    return { risk: "low", allow: true };
  }

  // File deletion
  if (toolName === "file_delete") {
    return {
      risk: "medium",
      allow: true,
      reason: "Warning: file deletion is irreversible",
    };
  }

  // All other tools: low risk
  return { risk: "low", allow: true };
}

/**
 * Format a guardian warning message for appending to tool result.
 */
export function formatGuardianWarning(verdict: GuardianVerdict): string {
  if (verdict.risk === "low" || !verdict.reason) return "";
  const icon = verdict.risk === "high" ? "🛡️" : "⚠️";
  return `\n${icon} [Guardian] ${verdict.reason}`;
}
