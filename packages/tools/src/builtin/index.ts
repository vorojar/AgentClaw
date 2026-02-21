import type { Tool } from "@agentclaw/types";
import { shellTool } from "./shell.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { askUserTool } from "./ask-user.js";
import { webFetchTool } from "./web-fetch.js";
import { webSearchTool } from "./web-search.js";
import { rememberTool } from "./remember.js";
import { setReminderTool } from "./set-reminder.js";
import { scheduleTool } from "./schedule.js";
import { sendFileTool } from "./send-file.js";
import { pythonTool } from "./python.js";
import { httpRequestTool } from "./http-request.js";
import { browserTool } from "./browser.js";
import { comfyuiGenerateTool } from "./comfyui.js";
import { planTaskTool } from "./plan-task.js";
import { createSkillTool } from "./create-skill.js";
import { googleCalendarTool } from "./google-calendar.js";
import { googleTasksTool } from "./google-tasks.js";
import { isGoogleConfigured } from "./google-auth.js";

export { shellTool, shellInfo } from "./shell.js";
export { fileReadTool } from "./file-read.js";
export { fileWriteTool } from "./file-write.js";
export { askUserTool } from "./ask-user.js";
export { webFetchTool } from "./web-fetch.js";
export { webSearchTool } from "./web-search.js";
export { rememberTool } from "./remember.js";
export { setReminderTool } from "./set-reminder.js";
export { scheduleTool } from "./schedule.js";
export { sendFileTool } from "./send-file.js";
export { pythonTool } from "./python.js";
export { httpRequestTool } from "./http-request.js";
export { browserTool } from "./browser.js";
export { comfyuiGenerateTool } from "./comfyui.js";
export { planTaskTool } from "./plan-task.js";
export { createSkillTool } from "./create-skill.js";
export { googleCalendarTool } from "./google-calendar.js";
export { googleTasksTool } from "./google-tasks.js";
export { isGoogleConfigured } from "./google-auth.js";

/** Create all built-in tools */
export function createBuiltinTools(): Tool[] {
  const tools: Tool[] = [
    shellTool,
    fileReadTool,
    fileWriteTool,
    askUserTool,
    webFetchTool,
    webSearchTool,
    rememberTool,
    setReminderTool,
    scheduleTool,
    sendFileTool,
    pythonTool,
    httpRequestTool,
    browserTool,
    comfyuiGenerateTool,
    planTaskTool,
    createSkillTool,
  ];

  // Google tools — only register when credentials are configured
  if (isGoogleConfigured()) {
    tools.push(googleCalendarTool, googleTasksTool);
  }

  return tools;
}
