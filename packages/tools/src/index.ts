// @agentclaw/tools — Tool system (built-in + external + MCP)

export { ToolRegistryImpl } from "./registry.js";
export {
  createBuiltinTools,
  shellTool,
  shellInfo,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  globTool,
  grepTool,
  askUserTool,
  sendFileTool,
  scheduleTool,
  rememberTool,
  recallTool,
  skillManageTool,
  skillCuratorTool,
  observationReadTool,
  rssTopTool,
  sessionSearchTool,
} from "./builtin/index.js";
export type { BuiltinToolsOptions } from "./builtin/index.js";
export {
  createHttpApiTool,
  createKnowledgeSourceTools,
} from "./builtin/http-api-tool.js";
export {
  createFileRagTool,
  createFileRagTools,
  chunkText,
  ingestFile,
  type KnowledgeChunkStore,
  type EmbedFn as RagEmbedFn,
} from "./builtin/file-rag-tool.js";
export { setSearchEngines } from "./builtin/web-search.js";
export {
  cleanMarkdown,
  htmlFragmentToMarkdown,
  htmlToMarkdown,
  type HtmlToMarkdownOptions,
} from "./html-to-markdown.js";
export {
  buildIgnoreCheck,
  buildIgnoreCheckSync,
  loadIgnorePatterns,
} from "./ignore.js";
export { MCPClient, MCPManager } from "./mcp/index.js";
