import type {
  ToolHooks,
  ToolPolicy,
  ToolResult,
  OnIterationHook,
  BeforeReturnHook,
} from "@agentclaw/types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  evaluateRisk,
  formatGuardianWarning,
  type GuardianVerdict,
} from "./guardian.js";

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
  private onIterationHooks: OnIterationHook[] = [];
  private beforeReturnHooks: BeforeReturnHook[] = [];

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

  /** Register preset hooks (Guardian security audit, Biome lint on file_write, bash exit code warning) */
  registerPresetHooks(): void {
    // Guardian: global before hook — block high-risk tool calls
    this.addGlobalHook({
      before: async (call) => {
        const verdict = evaluateRisk(call.name, call.input);
        if (!verdict.allow) {
          // Block the call — return null to abort execution
          return null;
        }
        return call;
      },
    });

    // Guardian: global after hook — append warnings for medium-risk calls
    this.addGlobalHook({
      after: async (call, result) => {
        if (result.isError) return result;
        const verdict = evaluateRisk(call.name, call.input);
        const warning = formatGuardianWarning(verdict);
        if (warning) {
          return { ...result, content: `${result.content}${warning}` };
        }
        return result;
      },
    });

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

    // file_write: validate JSON syntax
    this.addToolHook("file_write", {
      after: async (call, result) => {
        const filePath = call.input.path as string | undefined;
        if (!filePath || result.isError) return result;
        if (!/\.json$/i.test(filePath)) return result;
        const content = call.input.content;
        if (!content || typeof content !== "string") return result;
        try {
          JSON.parse(content);
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            ...result,
            content: `${result.content}\n⚠️ [hook] JSON syntax error: ${msg}. The file was written but contains invalid JSON.`,
          };
        }
      },
    });

    // file_write: validate Python syntax via py_compile
    this.addToolHook("file_write", {
      after: async (call, result) => {
        const filePath = call.input.path as string | undefined;
        if (!filePath || result.isError) return result;
        if (!/\.py$/i.test(filePath)) return result;
        try {
          const pythonBin = process.platform === "win32" ? "python" : "python3";
          await execFileAsync(pythonBin, ["-m", "py_compile", filePath], {
            timeout: 10000,
          });
          return result;
        } catch (err: unknown) {
          const stderr = (err as { stderr?: string }).stderr || String(err);
          return {
            ...result,
            content: `${result.content}\n⚠️ [hook] Python syntax error:\n${stderr.slice(0, 500)}`,
          };
        }
      },
    });

    // file_edit: auto-run Biome lint on .ts/.js files
    this.addToolHook("file_edit", {
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
          return result;
        }
      },
    });

    // file_edit: validate JSON syntax (read file after edit)
    this.addToolHook("file_edit", {
      after: async (call, result) => {
        const filePath = call.input.path as string | undefined;
        if (!filePath || result.isError) return result;
        if (!/\.json$/i.test(filePath)) return result;
        try {
          const { readFile } = await import("node:fs/promises");
          const content = await readFile(filePath, "utf-8");
          JSON.parse(content);
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            ...result,
            content: `${result.content}\n⚠️ [hook] JSON syntax error after edit: ${msg}`,
          };
        }
      },
    });

    // file_edit: validate Python syntax via py_compile
    this.addToolHook("file_edit", {
      after: async (call, result) => {
        const filePath = call.input.path as string | undefined;
        if (!filePath || result.isError) return result;
        if (!/\.py$/i.test(filePath)) return result;
        try {
          const pythonBin = process.platform === "win32" ? "python" : "python3";
          await execFileAsync(pythonBin, ["-m", "py_compile", filePath], {
            timeout: 10000,
          });
          return result;
        } catch (err: unknown) {
          const stderr = (err as { stderr?: string }).stderr || String(err);
          return {
            ...result,
            content: `${result.content}\n⚠️ [hook] Python syntax error after edit:\n${stderr.slice(0, 500)}`,
          };
        }
      },
    });

    // bash: warn on non-zero exit code
    this.addToolHook("bash", {
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

  addOnIterationHook(hook: OnIterationHook): void {
    this.onIterationHooks.push(hook);
  }

  addBeforeReturnHook(hook: BeforeReturnHook): void {
    this.beforeReturnHooks.push(hook);
  }

  async runOnIterationHooks(ctx: {
    iteration: number;
    runtimeHints: string[];
  }): Promise<void> {
    for (const hook of this.onIterationHooks) {
      await hook(ctx);
    }
  }

  async runBeforeReturnHooks(ctx: {
    response: string;
    runtimeHints: string[];
    todoItems: Array<{ text: string; done: boolean }>;
  }): Promise<{ action: "return" } | { action: "continue"; hint: string }> {
    for (const hook of this.beforeReturnHooks) {
      const result = await hook(ctx);
      if (result.action === "continue") return result;
    }
    return { action: "return" };
  }
}
