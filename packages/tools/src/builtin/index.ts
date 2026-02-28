import type { Tool } from "@agentclaw/types";
import { shellTool } from "./shell.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { askUserTool } from "./ask-user.js";
import { sendFileTool } from "./send-file.js";
import { scheduleTool } from "./schedule.js";
import { rememberTool } from "./remember.js";
import { useSkillTool } from "./use-skill.js";
import { claudeCodeTool } from "./claude-code.js";
import { updateTodoTool } from "./update-todo.js";

// Re-exports for backwards compatibility (other packages may import these)
export { shellTool, shellInfo } from "./shell.js";
export { fileReadTool } from "./file-read.js";
export { fileWriteTool } from "./file-write.js";
export { askUserTool } from "./ask-user.js";
export { sendFileTool } from "./send-file.js";
export { scheduleTool } from "./schedule.js";
export { rememberTool } from "./remember.js";
export { useSkillTool } from "./use-skill.js";
export { claudeCodeTool } from "./claude-code.js";
export { updateTodoTool } from "./update-todo.js";

/** Options for configuring which conditional tools to include */
export interface BuiltinToolsOptions {
  /** Enable send_file, schedule (gateway mode) */
  gateway?: boolean;
  /** Enable remember tool (requires memoryStore) */
  memory?: boolean;
  /** Enable use_skill tool (requires skillRegistry) */
  skills?: boolean;
  /** Enable claude_code tool (Claude Code CLI integration) */
  claudeCode?: boolean;
}

/** Create built-in tools with tiered loading */
export function createBuiltinTools(options?: BuiltinToolsOptions): Tool[] {
  // Core tools — always loaded
  const tools: Tool[] = [shellTool, fileReadTool, fileWriteTool, askUserTool];

  // Conditional tools — loaded based on configuration
  if (options?.gateway) {
    tools.push(sendFileTool, scheduleTool, updateTodoTool);
  }
  if (options?.memory) {
    tools.push(rememberTool);
  }
  if (options?.skills) {
    tools.push(useSkillTool);
  }
  if (options?.claudeCode) {
    tools.push(claudeCodeTool);
  }

  return tools;
}
