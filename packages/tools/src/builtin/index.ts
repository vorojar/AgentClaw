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

/** Create all built-in tools */
export function createBuiltinTools(): Tool[] {
  return [
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
  ];
}
