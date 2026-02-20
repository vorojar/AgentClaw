import type { Tool } from "@agentclaw/types";
import { shellTool } from "./shell.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { askUserTool } from "./ask-user.js";
import { webFetchTool } from "./web-fetch.js";
import { webSearchTool } from "./web-search.js";

export { shellTool } from "./shell.js";
export { fileReadTool } from "./file-read.js";
export { fileWriteTool } from "./file-write.js";
export { askUserTool } from "./ask-user.js";
export { webFetchTool } from "./web-fetch.js";
export { webSearchTool } from "./web-search.js";

/** Create all built-in tools */
export function createBuiltinTools(): Tool[] {
  return [
    shellTool,
    fileReadTool,
    fileWriteTool,
    askUserTool,
    webFetchTool,
    webSearchTool,
  ];
}
