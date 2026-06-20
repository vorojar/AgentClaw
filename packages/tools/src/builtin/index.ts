import type { Tool } from "@agentclaw/types";
import { bunTool } from "./bun.js";
import { shellTool } from "./shell.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { fileEditTool } from "./file-edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { askUserTool } from "./ask-user.js";
import { sendFileTool } from "./send-file.js";
import { scheduleTool } from "./schedule.js";
import { rememberTool } from "./remember.js";
import { recallTool } from "./recall.js";
import { useSkillTool } from "./use-skill.js";
import { skillManageTool } from "./skill-manage.js";
import { skillCuratorTool } from "./skill-curator.js";
import { claudeCodeTool } from "./claude-code.js";
import { updateTodoTool } from "./update-todo.js";
import { sandboxTool } from "./sandbox.js";
import { subagentTool } from "./subagent.js";
import { browserCdpTool } from "./browser-cdp.js";
import { handoffTool } from "./handoff.js";
import { webFetchTool } from "./web-fetch.js";
import { webSearchTool } from "./web-search.js";
import { observationReadTool } from "./observation-read.js";
import { rssTopTool } from "./rss-top.js";
import { sessionSearchTool } from "./session-search.js";

// Re-exports consumed by @agentclaw/tools index.ts or other packages
export { shellTool, shellInfo } from "./shell.js";
export { fileReadTool } from "./file-read.js";
export { fileWriteTool } from "./file-write.js";
export { fileEditTool } from "./file-edit.js";
export { globTool } from "./glob.js";
export { grepTool } from "./grep.js";
export { askUserTool } from "./ask-user.js";
export { sendFileTool } from "./send-file.js";
export { scheduleTool } from "./schedule.js";
export { rememberTool } from "./remember.js";
export { recallTool } from "./recall.js";
export { skillManageTool } from "./skill-manage.js";
export { skillCuratorTool } from "./skill-curator.js";
export { observationReadTool } from "./observation-read.js";
export { rssTopTool } from "./rss-top.js";
export { sessionSearchTool } from "./session-search.js";

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
  /** 启用 browser_cdp 工具（需要 Chrome/Chromium 运行时） */
  browserCdp?: boolean;
  /** Enable observation_read tool (requires observation callbacks) */
  observationRead?: boolean;
  /** Enable rss_top tool for Reddit/RSS report workflows */
  rss?: boolean;
}

/** Create built-in tools with tiered loading */
export function createBuiltinTools(options?: BuiltinToolsOptions): Tool[] {
  // Core tools — always loaded
  const tools: Tool[] = [
    bunTool,
    shellTool,
    fileReadTool,
    fileWriteTool,
    fileEditTool,
    globTool,
    grepTool,
    askUserTool,
    webFetchTool,
    webSearchTool,
  ];

  // Conditional tools — loaded based on configuration
  if (options?.gateway) {
    tools.push(
      sendFileTool,
      scheduleTool,
      updateTodoTool,
      sandboxTool,
      subagentTool,
      handoffTool,
      sessionSearchTool,
    );
  }
  if (options?.browserCdp) {
    tools.push(browserCdpTool);
  }
  if (options?.memory) {
    tools.push(rememberTool, recallTool);
  }
  if (options?.skills) {
    tools.push(useSkillTool, skillManageTool, skillCuratorTool);
  }
  if (options?.claudeCode) {
    tools.push(claudeCodeTool);
  }
  if (options?.observationRead) {
    tools.push(observationReadTool);
  }
  if (options?.rss) {
    tools.push(rssTopTool);
  }

  return tools;
}
