import type { ToolHooks, ToolPolicy, ToolResult } from "@agentclaw/types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Manages tool execution hooks (before/after) and access policies.
 *
 * Hooks run in registration order: global hooks first, then per-tool hooks.
 * A before hook returning `null` blocks execution immediately.
 */
export class ToolHookManager {
  private globalHooks: ToolHooks[] = [];
  private perToolHooks = new Map<string, ToolHooks[]>();
  private policy: ToolPolicy = {};

  /** Register a global hook (applies to all tools) */
  addGlobalHook(hook: ToolHooks): void {
    this.globalHooks.push(hook);
  }

  /** Register a hook for a specific tool */
  addToolHook(toolName: string, hook: ToolHooks): void {
    const hooks = this.perToolHooks.get(toolName) ?? [];
    hooks.push(hook);
    this.perToolHooks.set(toolName, hooks);
  }

  /** Set tool access policy */
  setPolicy(policy: ToolPolicy): void {
    this.policy = policy;
  }

  /** Get current policy */
  getPolicy(): ToolPolicy {
    return this.policy;
  }

  /** Check if a tool is allowed by policy */
  isAllowed(toolName: string): boolean {
    if (this.policy.deny?.includes(toolName)) return false;
    if (this.policy.allow && !this.policy.allow.includes(toolName))
      return false;
    return true;
  }

  /** Run all before hooks for a tool call. Returns modified call or null to block. */
  async runBeforeHooks(call: {
    name: string;
    input: Record<string, unknown>;
  }): Promise<{ name: string; input: Record<string, unknown> } | null> {
    let current = call;

    // Run global hooks first
    for (const hook of this.globalHooks) {
      if (hook.before) {
        const result = await hook.before(current);
        if (result === null) return null;
        current = result;
      }
    }

    // Then per-tool hooks (keyed by original call name)
    const toolHooks = this.perToolHooks.get(call.name) ?? [];
    for (const hook of toolHooks) {
      if (hook.before) {
        const result = await hook.before(current);
        if (result === null) return null;
        current = result;
      }
    }

    return current;
  }

  /** Register preset hooks (Biome lint on file_write, shell exit code warning) */
  registerPresetHooks(): void {
    // file_write: auto-run Biome lint on .ts/.js files
    this.addToolHook("file_write", {
      after: async (call, result) => {
        const filePath = call.input.path as string | undefined;
        if (!filePath || result.isError) return result;
        if (!/\.(ts|js|tsx|jsx)$/i.test(filePath)) return result;
        try {
          await execFileAsync("npx", ["biome", "check", "--write", filePath], {
            timeout: 15000,
          });
          return {
            ...result,
            content: `${result.content}\n[hook] Biome lint applied to ${filePath}`,
          };
        } catch {
          // Biome not available or lint failed — don't block
          return result;
        }
      },
    });

    // shell: warn on non-zero exit code
    this.addToolHook("shell", {
      after: async (_call, result) => {
        const exitCode = result.metadata?.exitCode as number | undefined;
        if (exitCode !== undefined && exitCode !== 0) {
          return {
            ...result,
            content: `⚠️ [hook] Command exited with code ${exitCode}\n${result.content}`,
          };
        }
        return result;
      },
    });
  }

  /** Run all after hooks for a tool result */
  async runAfterHooks(
    call: { name: string; input: Record<string, unknown> },
    result: ToolResult,
  ): Promise<ToolResult> {
    let current = result;

    // Run global hooks first
    for (const hook of this.globalHooks) {
      if (hook.after) {
        current = await hook.after(call, current);
      }
    }

    // Then per-tool hooks
    const toolHooks = this.perToolHooks.get(call.name) ?? [];
    for (const hook of toolHooks) {
      if (hook.after) {
        current = await hook.after(call, current);
      }
    }

    return current;
  }
}
