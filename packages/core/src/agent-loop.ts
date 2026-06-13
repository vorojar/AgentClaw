import type {
  AgentLoop,
  AgentState,
  AgentConfig,
  AgentEvent,
  AgentEventListener,
  AgentEventType,
  Message,
  ContentBlock,
  ImageContent,
  ToolUseContent,
  ToolResultContent,
  ToolResult,
  ToolExecutionContext,
  ToolEffect,
  LLMProvider,
  ContextManager,
  MemoryStore,
  ConversationTurn,
  Trace,
  TraceStep,
  ObservationInput,
} from "@agentclaw/types";
import type { ToolRegistryImpl } from "@agentclaw/tools";
import { generateId } from "@agentclaw/providers";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import {
  buildObfuscationMap,
  obfuscateString,
  obfuscateMessages,
  restoreString,
  type ObfuscationMap,
} from "./env-obfuscator.js";
import { join, basename, isAbsolute, relative, resolve } from "node:path";
import {
  evaluateBashToolPolicy,
  evaluateUserInputPolicy,
} from "./ability/policy-engine.js";
import {
  buildTaskToolProfile,
  filterToolDefinitionsForTask,
  type TaskToolProfile,
} from "./ability/task-router.js";
import {
  buildTaskRuntimeHints,
  classifyRuntimeTask,
} from "./ability/task-runtime-hints.js";
import {
  buildWechatPublishCommand,
  isAnchoredWechatPublishCommand,
  projectRootForWechatPublish,
  WECHAT_PUBLISH_SCRIPT,
} from "./ability/wechat-publish-contract.js";
import {
  hardenPdfBashInput,
  isPdfExtractionTask,
  recoverPdfTextFromSessionPdf,
} from "./ability/pdf-guard.js";
import {
  buildSynthesisFallbackResponse,
  evaluateCompletionPolicies,
  extractFallbackLines,
} from "./completion-policies/index.js";
import { ensureNewsBriefFinalQuality } from "./completion-policies/news-brief.js";

const execFileAsync = promisify(execFile);

/**
 * Shared iteration budget between parent and child agents.
 * When a sub-agent consumes iterations, they count against the parent's total.
 */
export class IterationBudget {
  private used = 0;

  constructor(public readonly max: number) {}

  get remaining(): number {
    return Math.max(0, this.max - this.used);
  }

  consume(n = 1): void {
    this.used += n;
  }

  unconsume(n = 1): void {
    this.used = Math.max(0, this.used - n);
  }

  get exhausted(): boolean {
    return this.used >= this.max;
  }
}

const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 15,
  systemPrompt: "",
  streaming: false,
  temperature: 0.5,
  maxTokens: 8192,
};

/** Tools that are safe to retry on failure (network-dependent tools) */
const RETRYABLE_TOOLS = new Set([
  "comfyui",
  "http_request",
  "web_search",
  "web_fetch",
]);

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY = 2000; // ms
const INVALID_TOOL_MARKUP_RE =
  /<\/?tool_call\b|<function=|<\/function>|<parameter=/i;
const RESPONSE_STREAM_GUARD_CHARS = 64;

function normalizeComparablePath(filePath: string, baseDir?: string): string {
  const trimmed = filePath.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  const resolved = isAbsolute(trimmed)
    ? resolve(trimmed)
    : resolve(baseDir ?? process.cwd(), trimmed);
  const normalized = resolved.replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isPathInside(candidate: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function extractVerifiedPptxPaths(content: string): string[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    if (parsed.ok !== true || typeof parsed.pptx !== "string") return [];
    return [parsed.pptx];
  } catch {
    return [];
  }
}

function extractPptxPathMentions(content: string): string[] {
  const paths = new Set<string>();
  const re = /(?:[A-Za-z]:)?[^\s"'<>|]+\.pptx/gi;
  for (const match of content.matchAll(re)) {
    const value = match[0].replace(/[),.;:]+$/g, "");
    if (value) paths.add(value);
  }
  return Array.from(paths);
}

function resolveBundledPptxVerifierPath(skillsDir?: string): string {
  const projectVerifierPath = join(
    process.cwd(),
    "skills",
    "pptx",
    "scripts",
    "verify_pptx.py",
  );
  if (existsSync(projectVerifierPath)) return projectVerifierPath;

  const configuredVerifierPath = join(
    resolve(skillsDir ?? "skills"),
    "pptx",
    "scripts",
    "verify_pptx.py",
  );
  return configuredVerifierPath;
}

async function verifyPptxForDelivery(input: {
  pptxPath: string;
  workDir: string;
  skillsDir?: string;
}): Promise<{ ok: boolean; content: string; verifiedPaths: string[] }> {
  const verifierPath = resolveBundledPptxVerifierPath(input.skillsDir);
  const outDir = join(input.workDir, "previews");
  try {
    const { stdout, stderr } = await execFileAsync(
      "python",
      [
        verifierPath,
        input.pptxPath,
        "--out-dir",
        outDir,
        "--require-text",
        "--json",
      ],
      {
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      },
    );
    const content = [stdout, stderr].filter(Boolean).join("\n").trim();
    return {
      ok: extractVerifiedPptxPaths(content).length > 0,
      content,
      verifiedPaths: extractVerifiedPptxPaths(content),
    };
  } catch (error) {
    const err = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const content = [
      err.stdout ? String(err.stdout) : "",
      err.stderr ? String(err.stderr) : "",
      err.message ?? "",
    ]
      .filter(Boolean)
      .join("\n")
      .trim();
    return { ok: false, content, verifiedPaths: [] };
  }
}

function createSafeResponseStreamBuffer(): {
  append: (text: string) => string | null;
  remainingFor: (finalText: string) => string;
  readonly blocked: boolean;
} {
  let pending = "";
  let emitted = "";
  let blocked = false;

  return {
    append(text: string): string | null {
      if (blocked || !text) return null;

      pending += text;
      if (INVALID_TOOL_MARKUP_RE.test(pending)) {
        blocked = true;
        pending = "";
        return null;
      }

      if (pending.length <= RESPONSE_STREAM_GUARD_CHARS) return null;

      const safeText = pending.slice(0, -RESPONSE_STREAM_GUARD_CHARS);
      pending = pending.slice(-RESPONSE_STREAM_GUARD_CHARS);
      emitted += safeText;
      return safeText;
    },

    remainingFor(finalText: string): string {
      if (!emitted) return finalText;
      if (finalText.startsWith(emitted)) {
        return finalText.slice(emitted.length);
      }
      return finalText;
    },

    get blocked(): boolean {
      return blocked;
    },
  };
}

import { sanitizeString } from "./utils.js";
/**
 * Prune system prompt to avoid mentioning tools that are not available.
 * 1. In the rules/instructions area (before memory section), remove lines that
 *    reference tool-like names (snake_case identifiers in backticks or bare)
 *    not in the agent's available tool set.
 * 2. Append an explicit tool boundary declaration so the LLM knows its limits.
 *
 * Memory entries and skill catalog are left untouched (factual, not instructional).
 *
 * @param allToolNames - full set of tool names from the unfiltered registry,
 *   used to detect whether a whitelist is active and to identify tool references.
 */
/**
 * Prune system prompt: remove rules referencing unavailable tools, append boundary.
 * @param unavailableTools - pre-computed set of tool names not available to this agent
 * @param toolBoundary - pre-computed boundary declaration string, or null if no pruning needed
 */
function pruneSystemPromptForTools(
  prompt: string,
  unavailableTools: Set<string>,
  toolBoundary: string | null,
): string {
  if (!toolBoundary) return prompt;

  // Split prompt into rules section (before memory) and rest (memory + skills)
  const memorySplit =
    prompt.indexOf("\n你的长期记忆：") !== -1
      ? prompt.indexOf("\n你的长期记忆：")
      : prompt.indexOf("\nYour long-term memory:");
  const rulesSection =
    memorySplit !== -1 ? prompt.slice(0, memorySplit) : prompt;
  const restSection = memorySplit !== -1 ? prompt.slice(memorySplit) : "";

  const pruned = rulesSection
    .split("\n")
    .filter((line) => {
      for (const name of unavailableTools) {
        if (line.includes(name)) return false;
      }
      return true;
    })
    .join("\n");

  return pruned + restSection + toolBoundary;
}

/**
 * Micro-compact: silently truncate old tool_result content to save context space.
 * Keeps the most recent KEEP_RECENT tool-result turns intact; older ones with
 * content exceeding COMPACT_THRESHOLD get truncated to COMPACT_PREVIEW chars
 * plus a length marker. Runs every iteration, no LLM involved.
 */
const MICRO_COMPACT_KEEP_RECENT = 3;
const MICRO_COMPACT_THRESHOLD = 800;
const MICRO_COMPACT_PREVIEW = 200;
/** Tool names whose input arguments should be truncated after execution */
const TRUNCATE_ARG_TOOLS = new Set(["file_write", "file_edit", "bash"]);
const TRUNCATE_ARG_KEYS = new Set(["content", "new_string", "code", "command"]);
const TRUNCATE_ARG_PREVIEW = 50;

function microCompact(messages: Message[]): void {
  // Find all tool-role messages (contain tool_result blocks)
  const toolMsgIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "tool") toolMsgIndices.push(i);
  }
  // Only compact if there are enough tool messages
  if (toolMsgIndices.length <= MICRO_COMPACT_KEEP_RECENT) return;

  const toCompact = toolMsgIndices.slice(
    0,
    toolMsgIndices.length - MICRO_COMPACT_KEEP_RECENT,
  );

  let truncatedCount = 0;
  let savedChars = 0;

  /** Truncate a single tool_result content string if over threshold */
  const truncateContent = (content: string): string | null => {
    if (content.length <= MICRO_COMPACT_THRESHOLD) return null;
    const originalLength = content.length;
    truncatedCount++;
    savedChars += originalLength - MICRO_COMPACT_PREVIEW;
    return (
      content.slice(0, MICRO_COMPACT_PREVIEW) +
      `\n\n[... truncated from ${originalLength} chars]`
    );
  };

  for (const idx of toCompact) {
    const msg = messages[idx];
    if (typeof msg.content === "string") {
      try {
        const blocks = JSON.parse(msg.content) as ContentBlock[];
        let changed = false;
        for (const block of blocks) {
          if (
            block.type === "tool_result" &&
            typeof (block as ToolResultContent).content === "string"
          ) {
            const result = truncateContent(
              (block as ToolResultContent).content,
            );
            if (result !== null) {
              (block as ToolResultContent).content = result;
              changed = true;
            }
          }
        }
        if (changed) msg.content = JSON.stringify(blocks);
      } catch {
        const result = truncateContent(msg.content);
        if (result !== null) {
          msg.content = result;
        }
      }
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (
          block.type === "tool_result" &&
          typeof (block as ToolResultContent).content === "string"
        ) {
          const result = truncateContent((block as ToolResultContent).content);
          if (result !== null) {
            (block as ToolResultContent).content = result;
          }
        }
      }
    }

    // ── Tool Argument Truncation ──
    // Also truncate the corresponding assistant message's tool_call input args
    // (file_write content, file_edit new_string, and bash commands can be huge after execution)
    if (idx > 0 && messages[idx - 1]?.role === "assistant") {
      const assistantMsg = messages[idx - 1];
      if (Array.isArray(assistantMsg.content)) {
        for (const block of assistantMsg.content) {
          if (
            block.type === "tool_use" &&
            TRUNCATE_ARG_TOOLS.has((block as ToolUseContent).name)
          ) {
            const input = (block as ToolUseContent).input as Record<
              string,
              unknown
            >;
            if (input) {
              for (const key of TRUNCATE_ARG_KEYS) {
                if (
                  typeof input[key] === "string" &&
                  (input[key] as string).length > TRUNCATE_ARG_PREVIEW
                ) {
                  input[key] =
                    (input[key] as string).slice(0, TRUNCATE_ARG_PREVIEW) +
                    "...(truncated)";
                }
              }
            }
          }
        }
      }
    }
  }

  if (truncatedCount > 0) {
    console.log(
      `[microCompact] truncated ${truncatedCount} tool_result(s), saved ${savedChars} chars`,
    );
  }
}

/** Stop the loop if this many consecutive iterations produce only errors */
const MAX_CONSECUTIVE_ERRORS = 3;
const MAX_CONSECUTIVE_MAX_TOKEN_NO_TOOL = 2;

/**
 * Overflow threshold (chars). Tool outputs exceeding this are saved to a temp
 * file so the LLM receives a concise preview + file reference instead of the
 * full content.  The LLM can then use file_read / grep to explore at will.
 */
const OVERFLOW_THRESHOLD = 8_000;
/** How many chars of the original output to keep as an inline preview */
const OVERFLOW_PREVIEW_CHARS = 1_500;

interface ToolOffloadInfo {
  toolName: string;
  resultRef: string;
  nodeId: string;
  taskId: string;
  rawPath: string;
  rawChars: number;
  promptChars: number;
  savedChars: number;
  replaceabilityScore: number;
}

function buildActiveToolOffloadHint(info: ToolOffloadInfo): string {
  return (
    `<active_tool_offload nodeId=${info.nodeId} resultRef=${info.resultRef} replaceabilityScore=${info.replaceabilityScore}/10 tool=${info.toolName}>` +
    `Large ${info.toolName} output is offloaded for the current task. Use the preview already in context; call observation_read on ${info.resultRef} only when an exact missing detail is required. rawChars=${info.rawChars}; savedChars=${info.savedChars}; rawPath=${info.rawPath}` +
    "</active_tool_offload>"
  );
}

function wantsFullFetchedText(inputText: string): boolean {
  return /全文|完整原文|完整内容|不要截断|别截断|不截断|full\s*(text|article|content)/i.test(
    inputText,
  );
}

function wantsFileDelivery(inputText: string): boolean {
  return (
    wantsFullFetchedText(inputText) ||
    /发送|发我|发给我|给我|send(?:_file)?|deliver|Markdown\s*文件|md\s*文件/i.test(
      inputText,
    )
  );
}

function wantsMarkdownFile(inputText: string): boolean {
  return /Markdown\s*文件|md\s*文件|\.md\b|转成\s*md|转为\s*md|转成\s*markdown|转为\s*markdown/i.test(
    inputText,
  );
}

function buildToolOffloadCanvas(infos: ToolOffloadInfo[]): string {
  const nodes = infos
    .slice(-8)
    .map((info, index) => {
      const node = `N${index + 1}`;
      const label = `${info.toolName}\\n${info.nodeId}\\n${info.resultRef}`;
      return `  ${node}["${label}"]`;
    })
    .join("\n");
  const edges = infos
    .slice(-8)
    .map((_, index) => (index === 0 ? "" : `  N${index} --> N${index + 1}`))
    .filter(Boolean)
    .join("\n");
  return `<active_tool_offload_canvas>\ngraph LR\n${nodes}${edges ? `\n${edges}` : ""}\n</active_tool_offload_canvas>`;
}

/**
 * Overflow mode: when a tool's output exceeds OVERFLOW_THRESHOLD, save the
 * full content to a temp file and replace result.content with a preview +
 * file reference.  This turns "truncation → data loss" into "deferred access".
 *
 * Returns offload metadata if overflow was applied, null otherwise.
 */
async function applyOverflow(
  result: {
    content: string;
    isError?: boolean;
    metadata?: Record<string, unknown>;
  },
  toolName: string,
  getSessionTmpDir: () => string,
  memoryStore: MemoryStore,
  traceId: string,
  stepId: string,
  toolInput?: Record<string, unknown>,
): Promise<ToolOffloadInfo | null> {
  // Don't overflow errors (usually short and important) or short outputs
  if (result.isError || result.content.length <= OVERFLOW_THRESHOLD)
    return null;

  // Never overflow use_skill — skill content is instructions that must be
  // fully visible to the LLM, truncating defeats the purpose
  if (toolName === "use_skill") return null;

  // rss_top already returns reduced title/link lists. Overflowing it hides the
  // exact compact data the model needs to write the report.
  if (toolName === "rss_top") return null;

  // Never overflow file_read of an overflow file — prevents infinite loop
  // where LLM reads overflow → result overflows → LLM reads new overflow → ...
  if (toolName === "file_read" && typeof toolInput?.path === "string") {
    const p = (toolInput.path as string).replace(/\\/g, "/");
    if (p.includes("/overflow_") && p.endsWith(".txt")) return null;
    if (p.startsWith("observation://")) return null;
  }

  const totalChars = result.content.length;
  const totalLines = result.content.split("\n").length;
  const originalContent = result.content;
  const contentHash = createHash("sha256")
    .update(originalContent)
    .digest("hex");
  const inputHash = createHash("sha256")
    .update(JSON.stringify(toolInput ?? {}))
    .digest("hex");

  let observationId: string | undefined;
  let filePath: string | undefined;
  const existingObservation =
    await memoryStore.findObservationByHash(contentHash);
  const reusableObservation =
    existingObservation?.traceId === traceId ? existingObservation : null;

  if (existingObservation) {
    if (reusableObservation) {
      observationId = reusableObservation.id;
      filePath = reusableObservation.rawPath;
    } else {
      const ts = Date.now();
      const safeName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
      const fileName = `overflow_${safeName}_${ts}.txt`;
      filePath = join(getSessionTmpDir(), fileName).replace(/\\/g, "/");
      writeFileSync(filePath, originalContent, "utf-8");
    }
  } else {
    // Save full content to file
    const ts = Date.now();
    const safeName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileName = `overflow_${safeName}_${ts}.txt`;
    filePath = join(getSessionTmpDir(), fileName).replace(/\\/g, "/");
    writeFileSync(filePath, originalContent, "utf-8");
  }

  // Replace content with preview + reference
  const preview = originalContent.slice(0, OVERFLOW_PREVIEW_CHARS);
  // Cut at last newline to avoid mid-line break
  const lastNL = preview.lastIndexOf("\n");
  const cleanPreview =
    lastNL > OVERFLOW_PREVIEW_CHARS * 0.5 ? preview.slice(0, lastNL) : preview;

  const makeObservationRef = (id?: string) =>
    id ? `observation://${id}` : "observation://unavailable";
  const rawRef = filePath ?? "raw file unavailable";
  const nodeId = stepId;
  const taskId = traceId;
  const replaceabilityScore = 8;
  const buildSummary = (promptChars: number, resultRef: string): string => {
    const savedChars = Math.max(0, totalChars - promptChars);
    return (
      cleanPreview +
      "\n\n... [tool output stored as observation]\n" +
      `observation: ${resultRef}\n` +
      `resultRef: ${resultRef}\n` +
      `nodeId: ${nodeId}\n` +
      `taskId: ${taskId}\n` +
      `replaceabilityScore: ${replaceabilityScore}/10\n` +
      `rawPath: ${rawRef}\n` +
      `rawChars: ${totalChars}\n` +
      `promptChars: ${promptChars}\n` +
      `savedChars: ${savedChars}\n` +
      "Preview is usually enough. Use observation_read for the full observation only when a specific missing fact is required."
    );
  };
  let resultRef = makeObservationRef(observationId);
  let finalContent = buildSummary(0, resultRef);
  finalContent = buildSummary(finalContent.length, resultRef);
  let promptChars = finalContent.length;
  let savedChars = Math.max(0, totalChars - promptChars);

  if (!reusableObservation) {
    const observationInput: ObservationInput = {
      traceId,
      stepId,
      toolName,
      inputHash,
      contentHash,
      rawPath: rawRef,
      preview: cleanPreview,
      facts: [],
      metadata: {
        overflow: true,
        nodeId,
        taskId,
        replaceabilityScore,
        rawPath: rawRef,
        originalLength: totalChars,
        originalLines: totalLines,
      },
      rawChars: totalChars,
      promptChars,
      savedChars,
    };
    const observation = await memoryStore.addObservation(observationInput);
    observationId = observation.id;
  }
  resultRef = makeObservationRef(observationId);
  finalContent = buildSummary(0, resultRef);
  finalContent = buildSummary(finalContent.length, resultRef);
  promptChars = finalContent.length;
  savedChars = Math.max(0, totalChars - promptChars);

  result.content = finalContent;

  // Record overflow info in metadata
  if (!result.metadata) result.metadata = {};
  result.metadata.overflow = true;
  result.metadata.overflowPath = rawRef;
  result.metadata.rawPath = rawRef;
  result.metadata.originalLength = totalChars;
  result.metadata.originalLines = totalLines;
  result.metadata.observationId = observationId;
  result.metadata.resultRef = resultRef;
  result.metadata.nodeId = nodeId;
  result.metadata.taskId = taskId;
  result.metadata.replaceabilityScore = replaceabilityScore;
  result.metadata.contentHash = contentHash;

  return {
    toolName,
    resultRef,
    nodeId,
    taskId,
    rawPath: rawRef,
    rawChars: totalChars,
    promptChars,
    savedChars,
    replaceabilityScore,
  };
}

/**
 * Sentinel string for max-iterations fallback.
 * Frontend i18n detects this exact string and replaces it with the localized version.
 */
const MAX_ITERATIONS_MESSAGE =
  "I've reached the maximum number of iterations. Please try breaking your request into smaller steps.";

/** Build a dedup key for per-tool failure tracking */
function buildFailKey(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  // Include distinguishing parameter so a corrected call isn't blocked
  if (toolName === "bash" && typeof toolInput?.command === "string") {
    return `bash:${toolInput.command.slice(0, 200)}`;
  }

  // file_read on overflow files: normalize to just "overflow_read" so
  // repeated reads of different overflow files are treated as duplicates
  if (toolName === "file_read" && typeof toolInput?.path === "string") {
    const p = (toolInput.path as string).replace(/\\/g, "/");
    if (p.includes("/overflow_") && p.endsWith(".txt")) {
      return "file_read:overflow";
    }
  }

  // For file tools, different paths or content types are different calls
  const serialized = toolInput ? JSON.stringify(toolInput) : "";
  const sig = serialized.slice(0, 120);
  const hash = serialized
    ? createHash("sha256").update(serialized).digest("hex").slice(0, 16)
    : "empty";
  return `${toolName}:${sig}:${hash}`;
}

type ToolFactInput = {
  effectiveToolName: string;
  result: {
    content: string;
    isError?: boolean;
    metadata?: Record<string, unknown>;
  };
};

function isExplicitSubagentRequest(inputText: string): boolean {
  return /subagent|sub-agent|子代理|子agent|分代理|并行代理|多代理|spawn\s+agent/i.test(
    inputText,
  );
}

function isOfficialPptxVerifierCommand(command: string): boolean {
  return /verify_pptx\.py/i.test(command) && /(^|\s)--json(\s|$)/.test(command);
}

function markdownForSentFiles(
  files: Array<{ url: string; filename: string }>,
): string {
  return files
    .map((f) => {
      const isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f.filename);
      return isImage
        ? `![${f.filename}](${f.url})`
        : `[${f.filename}](${f.url})`;
    })
    .join("\n");
}

function pptxOnlySentFileMarkdown(
  files: Array<{ url: string; filename: string }>,
): string | undefined {
  const pptxFiles = files.filter((f) => /\.pptx$/i.test(f.filename));
  if (pptxFiles.length === 0) return undefined;
  return markdownForSentFiles(pptxFiles);
}

function newsBriefCompletedArtifactResponse(
  steps: TraceStep[],
  sentFiles: Array<{ url: string; filename: string }>,
  reason: string,
): string | null {
  const writtenFiles = steps
    .flatMap((step) => {
      const effect = (step as { effect?: ToolEffect }).effect;
      return step.type === "tool_result" &&
        effect?.kind === "write" &&
        effect.verified &&
        typeof effect.target === "string"
        ? [effect.target]
        : [];
    })
    .filter((target, index, all) => all.indexOf(target) === index);
  if (writtenFiles.length === 0 && sentFiles.length === 0) return null;

  const sentMd = sentFiles.length > 0 ? markdownForSentFiles(sentFiles) : "";
  const writtenMd = writtenFiles.map((file) => `- ${file}`).join("\n");
  return [
    "AI 新闻简报已生成。",
    sentMd ? `\n已发送文件：\n${sentMd}` : "",
    writtenMd ? `\n已生成文件：\n${writtenMd}` : "",
    "",
    `说明：${reason}；后续模型尝试了无关或不可执行的工具调用，系统已停止继续调用工具并保留已完成成果。`,
  ]
    .filter(Boolean)
    .join("\n");
}

function hardenPptxClaudeCodeInput(
  input: Record<string, unknown>,
  workDir?: string,
  skillsDir?: string,
): Record<string, unknown> {
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!prompt || prompt.includes("[PPTX dependency discipline]")) {
    return input;
  }
  const verifierPath = resolveBundledPptxVerifierPath(skillsDir).replace(
    /\\/g,
    "/",
  );
  const sanitizedPrompt = prompt
    .replace(
      /^\s*[-*]?\s*Install\s+python-pptx\s+first(?:\s+(?:if\s+needed|with))?:.*$/gim,
      "",
    )
    .replace(/`?python\s+-c\s+["'][^"']*\bimport\s+pptx\b[^"']*["']`?/gi, "")
    .replace(/fast import check/gi, "direct script execution")
    .replace(
      /`?pip\s+install\s+[^`\n]*`?/gi,
      "Use existing Python packages; do not install dependencies.",
    );
  const prefix =
    "[PPTX dependency discipline]\n" +
    "- Do not run `pip install`, `python -m pip install`, npm install, or any package installation.\n" +
    "- Do not run standalone dependency preflight checks. Write and run the deck generation script directly; if it fails with ModuleNotFoundError for pptx, report the missing package instead of installing it.\n" +
    "- Generate the deck in the requested work directory only, preferably as `output.pptx`.\n" +
    "- Do not render PDF/PNG previews or run LibreOffice manually. The parent runtime will run the official verifier next.\n" +
    `- Official verifier path for the parent runtime: ${verifierPath}\n` +
    `- Work directory: ${workDir?.replace(/\\/g, "/") ?? "{WORKDIR}"}`;
  return {
    ...input,
    prompt: `${prefix}\n\n${sanitizedPrompt.trim()}`,
  };
}

function appendSourceLinksIfMissing(
  response: string,
  steps: TraceStep[],
): string {
  const existingLinks: string[] =
    response.match(/https?:\/\/[^\s)>\]]+/g) ?? [];
  if (existingLinks.length >= 2) return response;

  const urls: string[] = [];
  for (const step of steps) {
    if (
      step.type !== "tool_result" ||
      (step.name !== "web_search" && step.name !== "web_fetch") ||
      typeof step.content !== "string"
    ) {
      continue;
    }
    for (const match of step.content.matchAll(/https?:\/\/[^\s)>\]]+/g)) {
      const url = match[0].replace(/[.,;:]+$/g, "");
      if (!urls.includes(url)) urls.push(url);
      if (urls.length >= 5) break;
    }
    if (urls.length >= 5) break;
  }

  const missingUrls = urls
    .filter((url) => !existingLinks.includes(url))
    .slice(0, 5);
  if (missingUrls.length === 0) return response;

  const sourceList = missingUrls.map((url) => `- ${url}`).join("\n");
  return `${response.trimEnd()}\n\n来源链接：\n${sourceList}`;
}

function attachTraceEffects(trace: Trace): void {
  const effects = trace.steps
    .map((step) => step.effect)
    .filter((effect): effect is ToolEffect => {
      return (
        typeof effect === "object" &&
        effect !== null &&
        "kind" in effect &&
        "reversible" in effect
      );
    });
  if (effects.length > 0) {
    trace.effects = effects;
  } else {
    delete trace.effects;
  }
}

function attachBranchRecovery(trace: Trace, userTurn: ConversationTurn): void {
  const failedToolNames = trace.steps
    .filter((step) => step.type === "tool_result" && step.isError === true)
    .map((step) => {
      const rawName = step.name ?? step.toolName;
      return typeof rawName === "string" ? rawName : undefined;
    })
    .filter((name): name is string => Boolean(name));
  const uniqueFailedToolNames = Array.from(new Set(failedToolNames));
  const hasToolError = uniqueFailedToolNames.length > 0;
  if (!trace.error && !hasToolError) return;
  if (trace.branchRecovery) return;
  if (
    !trace.error &&
    typeof trace.response === "string" &&
    trace.response.trim()
  ) {
    const hasDeliverableSuccess = trace.steps.some((step) => {
      const effect = step.effect as ToolEffect | undefined;
      return (
        effect?.kind === "send" &&
        effect.verified === true &&
        effect.deliverable === true
      );
    });
    if (hasDeliverableSuccess || !isFailureLikeResponse(trace.response)) {
      return;
    }
  }

  const reason =
    trace.error === "llm_stream_error"
      ? "llm_error"
      : hasToolError
        ? "tool_error"
        : "loop_error";
  trace.branchRecovery = {
    traceId: trace.id,
    conversationId: trace.conversationId,
    fromTurnId: userTurn.id,
    reason,
    message:
      reason === "tool_error"
        ? "这条执行路径出现工具错误，可以从本轮用户输入重新开一个分支，换一种工具链继续。"
        : "这条执行路径没有稳定完成，可以从本轮用户输入重新开一个分支继续。",
    failedToolNames:
      uniqueFailedToolNames.length > 0 ? uniqueFailedToolNames : undefined,
    createdAt: new Date(),
  };
}

function isFailureLikeResponse(response: string): boolean {
  return /失败|出错|错误|无法完成|不能完成|阻塞|failed|failure|error|blocked|unable to complete/i.test(
    response,
  );
}

/**
 * Extract high-signal facts from tool outputs and feed them back as a runtime
 * hint. This helps weaker models avoid saying "not found" when the answer is
 * already visible in a search snippet or fetched page preview.
 */
function buildToolFactHint(results: ToolFactInput[]): string | null {
  const facts: string[] = [];

  for (const item of results) {
    if (item.result.isError) continue;
    if (
      item.effectiveToolName !== "web_search" &&
      item.effectiveToolName !== "web_fetch" &&
      item.effectiveToolName !== "bash"
    ) {
      continue;
    }

    facts.push(
      ...extractWeatherFacts(item.result.content, item.result.metadata),
    );
  }

  const unique = [...new Set(facts)].slice(0, 8);
  if (unique.length === 0) return null;

  return (
    "<facts_from_tools>已从工具结果中抽取到以下可用事实。最终回答必须优先使用这些事实；" +
    "如果某个字段已在这里出现，禁止回答“未能获取/没有找到”。如事实之间冲突，请标注来源差异并给出最可信来源。\n" +
    unique.map((fact) => `- ${fact}`).join("\n") +
    "\n</facts_from_tools>"
  );
}

function extractWeatherFacts(
  content: string,
  metadata?: Record<string, unknown>,
): string[] {
  const facts: string[] = [];
  const source =
    typeof metadata?.url === "string" ? ` 来源：${metadata.url}` : "";
  const isWeatherLike = /天气|气温|温度|降水|风力|风速|湿度|weather|wttr/i.test(
    content,
  );
  if (!isWeatherLike) return facts;

  const directAnswer = content.match(/Direct answer:\s*([^\n]+)/i)?.[1]?.trim();
  if (directAnswer) {
    facts.push(`搜索直接答案：${directAnswer}${source}`);
  }

  for (const match of content.matchAll(
    /(?:^|\n)\s*([^。\n]{0,30}天气[^—\n]*)\s*—\s*([^\n]+)/g,
  )) {
    const title = match[1].trim();
    const snippet = match[2].trim();
    if (snippet) facts.push(`${title}：${snippet}`);
  }

  const cma = content.match(
    /气温,\s*([^;\n]+?)\s*;\s*降水,\s*([^;\n]+?)\s*;\s*风速,\s*([^;\n]+?)\s*;\s*风向,\s*([^;\n]+)/,
  );
  if (cma) {
    facts.push(
      `中国气象局片段：气温 ${cma[1].trim()}；降水 ${cma[2].trim()}；风速 ${cma[3].trim()}；风向 ${cma[4].trim()}${source}`,
    );
  }

  const lines = content
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);

  for (const line of lines) {
    if (
      /上海|北京|广州|深圳|杭州|成都|天气|气温|温度|降水|风力|风速|湿度/.test(
        line,
      ) &&
      /天气|气温|温度|降水|风力|风速|湿度|℃|°F|中雨|小雨|多云|晴|阴/.test(
        line,
      ) &&
      !/^hint:/i.test(line) &&
      line.length >= 12
    ) {
      facts.push(`天气相关原文：${line.slice(0, 220)}${source}`);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s*29日（今天）|29日（今天）/.test(lines[i])) {
      const condition = cleanWeatherLine(lines[i + 1]);
      const temp = cleanWeatherLine(lines[i + 2]);
      const wind = cleanWeatherLine(lines[i + 3]);
      const parts = [
        condition ? `天气 ${condition}` : "",
        temp ? `温度 ${temp}` : "",
        wind ? `风力 ${wind}` : "",
      ].filter(Boolean);
      if (parts.length > 0) {
        facts.push(`中国天气网页面 29日（今天）：${parts.join("；")}${source}`);
      }
    }
  }

  return facts;
}

function cleanWeatherLine(value: string | undefined): string {
  return (value ?? "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^_+|_+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSufficientWeatherFacts(factHint: string): boolean {
  if (!/天气|气温|温度|降水|风力|风速|湿度|weather/i.test(factHint)) {
    return false;
  }
  if (/搜索直接答案：|中国气象局片段：|中国天气网页面/.test(factHint)) {
    return true;
  }
  const hasSpecificDate =
    /\d{1,2}月\d{1,2}日|\d{1,2}日（|今天|明天|tomorrow|today/i.test(factHint);
  const hasForecastSignal = /晴|多云|阴|小雨|中雨|大雨|雪|℃|°C|°F|风/.test(
    factHint,
  );
  if (hasSpecificDate && hasForecastSignal) {
    return true;
  }
  return false;
}

export class SimpleAgentLoop implements AgentLoop {
  private _state: AgentState = "idle";
  private _config: AgentConfig;
  private provider: LLMProvider;
  private toolRegistry: ToolRegistryImpl;
  private contextManager: ContextManager;
  private memoryStore: MemoryStore;
  private listeners: Set<AgentEventListener> = new Set();
  private aborted = false;
  private abortController: AbortController | null = null;
  private iterationBudget?: IterationBudget;
  /** Full set of tool names from unfiltered registry (for system prompt pruning) */
  private allToolNames: Set<string>;
  /**
   * Optional callback for LLM stream errors — allows SmartRouter to classify
   * errors and apply model cooldowns without tight coupling.
   * Signature: (providerName, modelId, error) => { retryable: boolean }
   */
  private onLLMError?: (
    providerName: string,
    modelId: string,
    error: unknown,
  ) => { retryable: boolean };

  get state(): AgentState {
    return this._state;
  }

  get config(): AgentConfig {
    return this._config;
  }

  constructor(options: {
    provider: LLMProvider;
    toolRegistry: ToolRegistryImpl;
    contextManager: ContextManager;
    memoryStore: MemoryStore;
    config?: Partial<AgentConfig>;
    iterationBudget?: IterationBudget;
    allToolNames?: Set<string>;
    /** Report LLM errors to router for classification & cooldown */
    onLLMError?: (
      providerName: string,
      modelId: string,
      error: unknown,
    ) => { retryable: boolean };
  }) {
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
    this.contextManager = options.contextManager;
    this.memoryStore = options.memoryStore;
    this._config = { ...DEFAULT_CONFIG, ...options.config };
    this.iterationBudget = options.iterationBudget;
    this.allToolNames =
      options.allToolNames ??
      new Set(options.toolRegistry.list().map((t) => t.name));
    this.onLLMError = options.onLLMError;
  }

  async run(
    input: string | ContentBlock[],
    conversationId?: string,
    context?: ToolExecutionContext,
  ): Promise<Message> {
    let lastMessage: Message | undefined;
    for await (const event of this.runStream(input, conversationId, context)) {
      if (event.type === "response_complete") {
        lastMessage = (event.data as { message: Message }).message;
      }
    }
    return (
      lastMessage ?? {
        id: generateId(),
        role: "assistant",
        content: "No response generated.",
        createdAt: new Date(),
      }
    );
  }

  async *runStream(
    input: string | ContentBlock[],
    conversationId?: string,
    context?: ToolExecutionContext,
  ): AsyncIterable<AgentEvent> {
    this.aborted = false;
    this.abortController = new AbortController();
    if (context) {
      context.abortSignal = this.abortController.signal;
    }
    const convId = conversationId ?? generateId();
    const startTime = Date.now();

    // Build env obfuscation map once per run (reused across iterations)
    const envMap = buildObfuscationMap();

    // Accumulators across all LLM iterations
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCacheCreationTokens = 0;
    let totalCacheReadTokens = 0;
    let totalToolCalls = 0;
    let prevTokensIn = 0;
    let prevTokensOut = 0;
    let usedModel: string | undefined;
    // Accumulate files sent by tools (for persistence)
    const allSentFiles: Array<{ url: string; filename: string }> = [];

    // Trace for debugging
    const trace: Trace = {
      id: generateId(),
      conversationId: convId,
      userInput: typeof input === "string" ? input : JSON.stringify(input),
      steps: [],
      channel: context?.channel,
      agentId: context?.agentId,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
      createdAt: new Date(),
    };
    if (context) {
      context.traceId = trace.id;
      context.conversationId = convId;
    }

    const recordDirectSendEffect = (target: string, source: string): void => {
      trace.steps.push({
        type: "tool_result",
        name: source,
        content: `Auto-sent file: ${basename(target)}`,
        isError: false,
        effect: {
          kind: "send",
          target,
          reversible: false,
          deliverable: true,
          verified: true,
        },
      });
    };

    const recordDirectWriteEffect = (target: string, source: string): void => {
      trace.steps.push({
        type: "tool_result",
        name: source,
        content: `Auto-wrote file: ${basename(target)}`,
        isError: false,
        effect: {
          kind: "write",
          target,
          reversible: true,
          verified: true,
        },
      });
    };

    // Per-session temp directory: data/tmp/{conversationId}/
    // Lazy-created: directory only exists when a tool actually needs to write a file.
    // Pure text API calls never touch the filesystem.
    const sessionTmpDir = join(process.cwd(), "data", "tmp", convId).replace(
      /\\/g,
      "/",
    );
    let sessionTmpDirCreated = false;
    const ensureSessionTmpDir = () => {
      if (!sessionTmpDirCreated) {
        mkdirSync(sessionTmpDir, { recursive: true });
        sessionTmpDirCreated = true;
      }
      return sessionTmpDir;
    };

    // Expose working directory to tools (use_skill replaces {WORKDIR})
    // Tools that need to write files should call ensureSessionTmpDir() or
    // mkdirSync(context.workDir) before writing — most already do.
    if (context) context.workDir = sessionTmpDir;
    const wechatPublishRoot = projectRootForWechatPublish();

    // ── Collect all user files into session dir ──
    // 1. Images: save base64 to session dir, record path for DB storage
    const savedImagePaths: string[] = [];
    const imagePathMap = new Map<ImageContent, string>(); // block → saved file path
    // 2. Attachments (video, docs, etc.): copy from data/tmp/ root to session dir
    const relocatedFiles = new Map<string, string>(); // original path → per-session path

    if (Array.isArray(input)) {
      for (const block of input) {
        if (block.type === "image" && (block as ImageContent).data) {
          const img = block as ImageContent;
          // 优先使用上传时的原始文件名，fallback 到通用名
          const ext = img.mediaType?.includes("png") ? "png" : "jpg";
          let filename = img.filename || `user_image_${Date.now()}.${ext}`;
          ensureSessionTmpDir();
          let filePath = join(sessionTmpDir, filename).replace(/\\/g, "/");
          // Deduplicate: if file already exists from a previous turn, add timestamp suffix
          if (existsSync(filePath)) {
            const dotIdx = filename.lastIndexOf(".");
            filename =
              dotIdx > 0
                ? `${filename.slice(0, dotIdx)}_${Date.now()}${filename.slice(dotIdx)}`
                : `${filename}_${Date.now()}`;
            filePath = join(sessionTmpDir, filename).replace(/\\/g, "/");
          }
          try {
            writeFileSync(filePath, Buffer.from(img.data, "base64"));
            savedImagePaths.push(filePath);
            imagePathMap.set(img, filePath);
          } catch {
            // save failed, keep original base64
          }
        }
        // Relocate non-image attachments referenced in text blocks
        // ws.ts format: "用户上传了附件，已保存到：/abs/path\n注意：..."
        if (block.type === "text") {
          const re = /已保存到：([^\n]+)/g;
          let m;
          while ((m = re.exec(block.text)) !== null) {
            const origPath = m[1].trim();
            if (existsSync(origPath)) {
              const newPath = join(sessionTmpDir, basename(origPath)).replace(
                /\\/g,
                "/",
              );
              try {
                ensureSessionTmpDir();
                copyFileSync(origPath, newPath);
                try {
                  unlinkSync(origPath);
                } catch {
                  /* ignore */
                }
                relocatedFiles.set(origPath, newPath);
              } catch {
                /* move failed — keep original path */
              }
            }
          }
        }
      }
    }

    // Build runtime hints — injected into messages after buildContext
    // 图片路径已在 ws.ts 的 fileHints 中（格式同附件），relocate 逻辑会自动重写到 session 目录
    const runtimeHints: string[] = [
      `[工作目录：${sessionTmpDir}]（所有文件都在此目录下，输出也保存到这里）`,
    ];
    const activeToolOffloads: ToolOffloadInfo[] = [];
    let offloadCanvasHintIndex: number | null = null;
    const inputTextForHeuristics =
      typeof input === "string"
        ? (context?.originalUserText ?? input)
        : input
            .map((block) =>
              block.type === "text" && "text" in block
                ? String(block.text ?? "")
                : "",
            )
            .join("\n");
    const runtimeTask = classifyRuntimeTask(inputTextForHeuristics);
    const {
      isNewsBriefTask,
      isAiNewsTask,
      isPptxGenerationTask,
    } = runtimeTask;
    if (isPptxGenerationTask) {
      ensureSessionTmpDir();
    }
    runtimeHints.push(
      ...buildTaskRuntimeHints(inputTextForHeuristics, runtimeTask),
    );
    const taskToolProfile = buildTaskToolProfile(
      inputTextForHeuristics,
      isNewsBriefTask,
      isAiNewsTask,
      isPptxGenerationTask,
      {
        pptxVerifierPath: resolveBundledPptxVerifierPath().replace(/\\/g, "/"),
      },
    );
    if (taskToolProfile.hint) {
      runtimeHints.push(
        taskToolProfile.hint.replace("<PROJECT_ROOT>", wechatPublishRoot),
      );
    }
    let sufficientWeatherFactHint: string | null = null;
    // runtimeHints.join("\n") is computed dynamically each iteration (runtimeHints grows via push)

    // DB 存储：多模态输入存 ContentBlock[] JSON（image.data 替换为 file:// 路径，避免 DB 膨胀）
    // turnToMessage 读取时从磁盘加载 base64 还原
    let userContentForStorage: string;
    if (typeof input === "string") {
      userContentForStorage = context?.originalUserText ?? input;
    } else {
      // 替换 image block 的 base64 data 为 file:// 引用
      const storable = input.map((block) => {
        if (block.type === "image") {
          const img = block as ImageContent;
          const savedPath = imagePathMap.get(img);
          if (savedPath) {
            return {
              type: "image",
              mediaType: img.mediaType,
              filePath: savedPath,
              filename: img.filename,
            };
          }
        }
        return block;
      });
      userContentForStorage = JSON.stringify(storable);
    }

    // 存储用户消息到 DB
    const userTurn: ConversationTurn = {
      id: generateId(),
      conversationId: convId,
      parentId: context?.conversationParentTurnId,
      branchId: context?.conversationBranchId,
      role: "user",
      content: userContentForStorage,
      createdAt: new Date(),
    };
    await this.memoryStore.addTurn(convId, userTurn);

    let tracePersistedInLoop = false;
    const persistTrace = async (): Promise<void> => {
      attachTraceEffects(trace);
      attachBranchRecovery(trace, userTurn);
      await this.memoryStore.addTrace(trace);
      tracePersistedInLoop = true;
    };

    // Track per-tool failure counts across iterations to prevent retry avalanche
    const toolFailCounts = new Map<string, number>();
    const MAX_TOOL_FAILURES = 2;

    // Track per-tool call counts to detect repetitive calling (success or fail)
    const toolCallCounts = new Map<string, number>();
    const MAX_DUPLICATE_CALLS = 2; // same tool+params called >2 times → short-circuit

    // Global per-tool-name call counter — caps total calls regardless of params
    const toolNameCounts = new Map<string, number>();
    const TOOL_TOTAL_LIMITS = taskToolProfile.toolTotalLimits;

    // Global tool call counter — absolute safety net against any loop pattern
    let globalCallCount = 0;
    const MAX_TOTAL_TOOL_CALLS = 40; // no single user message needs 40+ tool calls

    const MAX_CONSECUTIVE_ROLLBACKS = 3;
    let consecutiveRollbacks = 0;

    // Skill injection is handled entirely by use_skill tool — no auto-injection.
    // This keeps the system prompt lean; LLM decides which skill to load.
    const effectiveSkillName = context?.preSelectedSkillName;

    // Agent loop: think → act → observe → repeat
    let iterations = 0;
    let useSkillRollbacks = 0;
    let consecutiveErrors = 0;
    let lastFullText = ""; // Keep last LLM text for fallback response
    let lastStreamErrorMessage: string | undefined;
    let todoItems: Array<{ text: string; done: boolean }> = [];
    let todoAutoIndex = 0; // Next item to auto-check
    let firstUseSkillCounted = false;

    // Three-strike escalation: detect when LLM is stuck producing similar outputs.
    // If 3 consecutive iterations have similar output fingerprints, inject a hint
    // to change strategy. Inspired by ClawRouter session escalation.
    const recentFingerprints: string[] = [];
    let escalated = false;
    const STRIKE_THRESHOLD = 3;

    let webResearchToolCalls = 0;
    const WEB_RESEARCH_TOOL_LIMIT = taskToolProfile.webResearchToolLimit;
    let successfulWebSearchCalls = 0;
    let successfulWebFetchCalls = 0;
    let overflowFileReadCalls = 0;
    const OVERFLOW_FILE_READ_LIMIT = 2;
    const initialWechatMarkdownPath =
      inputTextForHeuristics.match(
        /(?:Markdown\s*文件|Markdown file)[:：]\s*([^\s，,]+)/i,
      )?.[1] ??
      inputTextForHeuristics.match(/([\w:/\\.-]+\.md\b)/i)?.[1] ??
      null;
    let wechatPublishReadyToPublish = false;
    let wechatPublishCompleted = false;
    let wechatPublishHasMarkdown =
      taskToolProfile.kind === "wechat_publish" &&
      initialWechatMarkdownPath !== null;
    let wechatPublishMarkdownPath = initialWechatMarkdownPath
      ? initialWechatMarkdownPath.replace(/\\/g, "/")
      : null;
    let wechatPublishMarkdownCreatedInRun = false;
    let wechatPublishSkillLoaded = false;
    let pptxSkillLoaded = false;
    const verifiedPptxPaths = new Set<string>();
    const verifiedPptxDeliverables = new Map<string, string>();
    const unverifiedPptxCandidates = new Set<string>();
    const autoSentVerifiedPptxPaths = new Set<string>();
    let verifiedPptxAutoDelivered = false;
    let forceSynthesisOnly = false;
    let invalidFinalMarkupRetries = 0;
    let pptxMissingDeliveryRetries = 0;
    let consecutiveMaxTokensWithoutTools = 0;
    let forcedStopReason: string | undefined;
    const fallbackSnippets: string[] = [];

    const rememberVerifiedPptx = (pptxPath: string): string | undefined => {
      const normalized = normalizeComparablePath(pptxPath, context?.workDir);
      if (!normalized) return undefined;
      const absolutePath = isAbsolute(pptxPath)
        ? resolve(pptxPath)
        : resolve(context?.workDir ?? sessionTmpDir, pptxPath);
      verifiedPptxPaths.add(normalized);
      verifiedPptxDeliverables.set(normalized, absolutePath);
      unverifiedPptxCandidates.delete(normalized);
      return normalized;
    };

    const autoSendVerifiedPptx = async (pptxPath: string): Promise<void> => {
      if (!context?.sendFile) return;
      const normalized = rememberVerifiedPptx(pptxPath);
      if (!normalized || autoSentVerifiedPptxPaths.has(normalized)) return;
      const absolutePath =
        verifiedPptxDeliverables.get(normalized) ??
        (isAbsolute(pptxPath)
          ? resolve(pptxPath)
          : resolve(context?.workDir ?? sessionTmpDir, pptxPath));
      const workDir = context?.workDir ?? sessionTmpDir;
      if (!isPathInside(absolutePath, workDir)) return;
      if (!existsSync(absolutePath)) return;
      await context.sendFile(absolutePath, basename(absolutePath));
      recordDirectSendEffect(absolutePath, "auto_send_verified_pptx");
      autoSentVerifiedPptxPaths.add(normalized);
      verifiedPptxAutoDelivered = true;
      runtimeHints.push(
        `<pptx_auto_delivered>${absolutePath.replace(/\\/g, "/")}</pptx_auto_delivered>`,
      );
    };

    // Pre-compute tool pruning data (fixed for the entire loop)
    const loopToolDefs = this.toolRegistry.definitions();
    const loopAvailableTools = new Set(loopToolDefs.map((t) => t.name));
    const loopUnavailableTools = new Set<string>();
    for (const name of this.allToolNames) {
      if (!loopAvailableTools.has(name)) loopUnavailableTools.add(name);
    }
    const loopToolBoundary =
      loopAvailableTools.size < this.allToolNames.size - 2
        ? `\n[可用工具：${Array.from(loopAvailableTools).sort().join(", ")}]\n你只能使用上述工具，不要调用任何不在列表中的工具。`
        : null;

    // Wrap the entire loop in try-finally to guarantee trace persistence.
    // Without this, if the consumer (orchestrator/WS) stops pulling from the
    // generator (user abort, disconnect), the trace is never saved.
    try {
      const directPolicyDecision = evaluateUserInputPolicy(
        inputTextForHeuristics,
      );
      const directSafetyResponse =
        directPolicyDecision?.action === "direct_response"
          ? directPolicyDecision.response
          : null;
      if (directSafetyResponse) {
        const durationMs = Date.now() - startTime;
        const assistantTurn: ConversationTurn = {
          id: generateId(),
          conversationId: convId,
          role: "assistant",
          content: directSafetyResponse,
          model: usedModel,
          tokensIn: 0,
          tokensOut: 0,
          durationMs,
          toolCallCount: 0,
          traceId: trace.id,
          createdAt: new Date(),
        };
        await this.memoryStore.addTurn(convId, assistantTurn);
        trace.steps.push({
          type: "llm_call",
          iteration: 0,
          tokensIn: 0,
          tokensOut: 0,
          text: directSafetyResponse,
          stopReason: "safety_direct_response",
        } as TraceStep);
        trace.response = directSafetyResponse;
        trace.tokensIn = 0;
        trace.tokensOut = 0;
        trace.durationMs = durationMs;
        await persistTrace();
        yield this.createEvent("response_chunk", {
          text: directSafetyResponse,
        });
        this.setState("idle");
        yield this.createEvent("response_complete", {
          message: {
            id: generateId(),
            role: "assistant",
            content: directSafetyResponse,
            createdAt: new Date(),
            model: usedModel,
            tokensIn: 0,
            tokensOut: 0,
            durationMs,
            toolCallCount: 0,
          },
          agentId: context?.agentId,
        });
        return;
      }

      while (iterations < this._config.maxIterations && !this.aborted) {
        // Check shared budget (parent + children share the same IterationBudget)
        if (this.iterationBudget?.exhausted) {
          yield this.createEvent("thinking", {
            text: "Iteration budget exhausted.",
          });
          break;
        }
        iterations++;
        this.iterationBudget?.consume();

        // ── Drain background task results ──
        // Completed background tasks are injected as runtime hints so the LLM
        // sees them naturally at the start of the next iteration.
        if (context?.backgroundQueue && context.backgroundQueue.length > 0) {
          const completed = context.backgroundQueue.splice(0);
          for (const bg of completed) {
            const status = bg.isError ? "FAILED" : "OK";
            // Truncate long output — overflow mode will catch it if stored as tool result,
            // but here we inline into hints so keep it short
            const output =
              bg.content.length > 2000
                ? bg.content.slice(0, 2000) +
                  `\n... [truncated, ${bg.content.length} chars]`
                : bg.content;
            runtimeHints.push(
              `[Background task ${bg.id} completed (${status})]\n$ ${bg.command}\n${output}`,
            );
          }
        }

        // Build context (iteration 2+ reuses cached dynamic prefix for KV-cache stability)
        this.setState("thinking");
        const { systemPrompt, messages, skillMatch } =
          await this.contextManager.buildContext(convId, input, {
            preSelectedSkillName: effectiveSkillName,
            reuseContext: iterations > 1,
            memoryNamespace: context?.memoryNamespace,
            disabledSkills: context?.disabledSkills,
          });

        // Inject runtime hints + rewrite relocated file paths in the last user message.
        // DB stores original paths (UI stays clean), LLM sees per-session paths every iteration.
        if (messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          if (lastMsg.role === "user") {
            // Rewrite attachment paths from data/tmp/ root → per-session dir
            const rewrite = (text: string): string => {
              let result = text;
              for (const [orig, relocated] of relocatedFiles) {
                result = result.replaceAll(orig, relocated);
              }
              return result;
            };
            if (typeof lastMsg.content === "string") {
              lastMsg.content = `${rewrite(lastMsg.content)}\n${runtimeHints.join("\n")}`;
            } else if (Array.isArray(lastMsg.content)) {
              for (const block of lastMsg.content as ContentBlock[]) {
                if (block.type === "text") {
                  block.text = rewrite(block.text);
                }
              }
              (lastMsg.content as ContentBlock[]).push({
                type: "text",
                text: runtimeHints.join("\n"),
              });
            }
          }
        }

        // ── Micro-compact: silently shrink old tool_result content ──
        // Keep only the 3 most recent tool result turns intact; older ones get
        // their content replaced with a short placeholder. Saves tokens every
        // turn without LLM involvement.
        microCompact(messages);

        // ── Identity re-injection after compression ──
        // When context was compressed (messages start with summary), the agent
        // may lose its persona. Re-inject identity if context looks compressed.
        if (
          context?.agentId &&
          context.agentId !== "default" &&
          messages.length >= 2 &&
          messages[0]?.id === "summary"
        ) {
          const agents = context.agents || [];
          const self = agents.find((a) => a.id === context!.agentId) || {
            name: context.agentId,
          };
          const identityBlock = `<identity>You are ${(self as { name: string }).name}. Stay in character.</identity>`;
          // Inject after the summary-ack message
          if (
            messages[1]?.role === "assistant" &&
            typeof messages[1].content === "string"
          ) {
            messages[1].content += `\n${identityBlock}`;
          }
        }

        // Notify thinking
        yield this.createEvent("thinking", { iteration: iterations });

        // Stream LLM response
        let fullText = "";
        let iterReasoningContent = "";
        const pendingToolCalls: Map<
          number,
          { id: string; name: string; args: string }
        > = new Map();
        let toolIndex = 0;

        // Inject _intent field into each tool schema for Intent Tracing.
        // LLM must state its intent before calling a tool → improves explainability.
        let activeToolDefinitions = forceSynthesisOnly
          ? []
          : filterToolDefinitionsForTask(
              this.toolRegistry.definitions(),
              taskToolProfile,
            );
        if (taskToolProfile.kind === "wechat_publish" && !forceSynthesisOnly) {
          if (wechatPublishSkillLoaded) {
            activeToolDefinitions = activeToolDefinitions.filter(
              (tool) => tool.name !== "use_skill",
            );
          }
          if (
            wechatPublishReadyToPublish ||
            wechatPublishMarkdownCreatedInRun
          ) {
            activeToolDefinitions = activeToolDefinitions.filter(
              (tool) => tool.name === "bash",
            );
          } else if (!wechatPublishHasMarkdown) {
            activeToolDefinitions = activeToolDefinitions.filter(
              (tool) => tool.name !== "bash",
            );
          }
          activeToolDefinitions = activeToolDefinitions.map((tool) => {
            if (tool.name !== "bash") return tool;
            const markdownPath = wechatPublishMarkdownPath
              ? `"${wechatPublishMarkdownPath}"`
              : "{INPUT_MD}";
            const nextCommand = wechatPublishReadyToPublish
              ? buildWechatPublishCommand(
                  "publish",
                  markdownPath,
                  wechatPublishRoot,
                )
              : buildWechatPublishCommand(
                  "inspect",
                  markdownPath,
                  wechatPublishRoot,
                );
            return {
              ...tool,
              description:
                `WeChat publish task only. Run the next anchored CLI command with --json. ` +
                `Do not run cat/type/node/python snippets, preview, convert, help, or any other command. ` +
                `Next command shape: ${nextCommand}`,
            };
          });
        }
        const tools = activeToolDefinitions.map((t) => ({
          ...t,
          parameters: {
            ...t.parameters,
            properties: {
              _intent: {
                type: "string" as const,
                description: "Why you are calling this tool (1 sentence)",
              },
              ...t.parameters.properties,
            },
            required: ["_intent", ...(t.parameters.required ?? [])],
          },
        }));

        // Obfuscate sensitive env values before sending to LLM provider
        const safeMessages = obfuscateMessages(messages, envMap);
        let safeSystemPrompt = obfuscateString(systemPrompt, envMap);

        // Agent-specific system prompt pruning (uses pre-computed sets)
        safeSystemPrompt = pruneSystemPromptForTools(
          safeSystemPrompt,
          loopUnavailableTools,
          loopToolBoundary,
        );
        if (isNewsBriefTask || isAiNewsTask) {
          const memoryStart = safeSystemPrompt.search(
            /\n- \[(identity|preference|fact|entity|episodic)\]/,
          );
          if (memoryStart !== -1) {
            safeSystemPrompt =
              safeSystemPrompt.slice(0, memoryStart) +
              "\n\n[long-term memory omitted for time-sensitive news task]";
          }
        }

        // Record trace metadata on first iteration (after pruning so trace reflects actual prompt)
        if (iterations === 1) {
          trace.systemPrompt = safeSystemPrompt;
          if (skillMatch) {
            trace.skillMatch = JSON.stringify(skillMatch);
          }
        }

        const stream = this.provider.stream({
          messages: safeMessages,
          systemPrompt: safeSystemPrompt,
          tools,
          model: this._config.model,
          temperature: this._config.temperature,
          maxTokens: this._config.maxTokens,
        });

        // 流异常捕获：网络断开/API 错误时仍需保留 token 统计和 trace
        let streamError: Error | undefined;
        let llmStopReason: string | undefined;
        const responseStream = createSafeResponseStreamBuffer();
        try {
          for await (const chunk of stream) {
            if (this.aborted) break;

            switch (chunk.type) {
              case "text":
                if (chunk.text) {
                  fullText += chunk.text;
                  const safeText = responseStream.append(chunk.text);
                  if (safeText && pendingToolCalls.size === 0) {
                    yield this.createEvent("response_chunk", {
                      text: safeText,
                    });
                  }
                }
                break;
              case "tool_use_start":
                if (chunk.toolUse) {
                  pendingToolCalls.set(toolIndex, {
                    id: chunk.toolUse.id,
                    name: chunk.toolUse.name,
                    args: chunk.toolUse.input ?? "",
                  });
                  toolIndex++;
                }
                break;
              case "tool_use_delta":
                if (chunk.toolUse) {
                  // Find the most recent pending tool call to append to
                  const lastIdx = toolIndex - 1;
                  const pending = pendingToolCalls.get(lastIdx);
                  if (pending) {
                    pending.args += chunk.toolUse.input ?? "";
                  }
                }
                break;
              case "done":
                // Accumulate usage from this LLM call
                if (chunk.usage) {
                  totalTokensIn += chunk.usage.tokensIn;
                  totalTokensOut += chunk.usage.tokensOut;
                  totalCacheCreationTokens +=
                    chunk.usage.cacheCreationTokens ?? 0;
                  totalCacheReadTokens += chunk.usage.cacheReadTokens ?? 0;
                }
                if (chunk.model) {
                  usedModel = chunk.model;
                }
                if (chunk.reasoningContent) {
                  iterReasoningContent = chunk.reasoningContent;
                }
                if (chunk.stopReason === "max_tokens") {
                  console.warn(
                    `[agent-loop] LLM output truncated (max_tokens reached at ${this._config.maxTokens} tokens)`,
                  );
                }
                llmStopReason = chunk.stopReason;
                break;
            }
          }
        } catch (err) {
          // 流中断时记录错误，但不阻断后续 token 统计和 trace 保存
          streamError = err instanceof Error ? err : new Error(String(err));
          console.error(
            `[agent-loop] LLM stream error: ${streamError.message}`,
          );
          lastStreamErrorMessage = streamError.message;
          yield this.createEvent("error", { error: streamError.message });

          // Report to router for error classification & model cooldown
          if (this.onLLMError) {
            const modelId = usedModel || this._config.model || "";
            this.onLLMError(this.provider.name, modelId, streamError);
          }
        } finally {
          // 确保 LLM stream 资源释放，防止 abort/break 后 HTTP 连接悬挂
          const s = stream as AsyncIterable<unknown> & {
            abort?: () => void;
            return?: () => Promise<unknown>;
          };
          if (typeof s.abort === "function") {
            s.abort();
          } else if (typeof s.return === "function") {
            await s.return();
          }
        }

        // Compute per-iteration delta
        const iterTokensIn = totalTokensIn - prevTokensIn;
        const iterTokensOut = totalTokensOut - prevTokensOut;
        prevTokensIn = totalTokensIn;
        prevTokensOut = totalTokensOut;

        if (fullText) lastFullText = fullText;

        // Record LLM call in trace (include text if any)
        const llmStep: Record<string, unknown> = {
          type: "llm_call",
          iteration: iterations,
          tokensIn: iterTokensIn,
          tokensOut: iterTokensOut,
        };
        if (fullText) llmStep.text = fullText;
        if (streamError) llmStep.error = streamError.message;
        if (llmStopReason) llmStep.stopReason = llmStopReason;
        trace.steps.push(llmStep as TraceStep);

        // 流异常时跳过工具调用，直接结束本轮循环
        if (streamError) break;

        // Restore any obfuscated env placeholders in LLM text output
        fullText = restoreString(fullText, envMap);

        // Build tool calls from accumulated chunks
        // Extract _intent from each tool call (Intent Tracing) — strip before execution
        const toolCalls: (ToolUseContent & {
          intent?: string;
          _formatError?: boolean;
        })[] = [];
        for (const [, tc] of pendingToolCalls) {
          let parsedInput: Record<string, unknown> = {};
          let formatError = false;
          if (tc.args) {
            try {
              parsedInput = JSON.parse(tc.args);
            } catch {
              parsedInput = { _raw: tc.args };
              formatError = true;
            }
          }
          // Extract and strip _intent
          const intent =
            typeof parsedInput._intent === "string"
              ? (parsedInput._intent as string)
              : undefined;
          delete parsedInput._intent;

          // Restore obfuscated env placeholders in tool args so tools get real values
          const restoredInput = JSON.parse(
            restoreString(JSON.stringify(parsedInput), envMap),
          ) as Record<string, unknown>;

          const call: ToolUseContent & {
            intent?: string;
            _formatError?: boolean;
          } = {
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: restoredInput,
          };
          if (intent) call.intent = intent;
          if (formatError) call._formatError = true;
          toolCalls.push(call);
        }

        if (forceSynthesisOnly && toolCalls.length > 0) {
          toolCalls.length = 0;
          const completedArtifact =
            taskToolProfile.kind === "news_brief"
              ? newsBriefCompletedArtifactResponse(
                  trace.steps as TraceStep[],
                  allSentFiles,
                  "新闻简报已生成",
                )
              : null;
          if (completedArtifact) {
            fullText = completedArtifact;
          } else {
            forcedStopReason = "synthesis_only_tool_call_suppressed";
            fullText = buildSynthesisFallbackResponse(
              inputTextForHeuristics,
              messages,
              allSentFiles,
              fallbackSnippets,
              "当前阶段不再允许继续调用工具，模型仍尝试继续调用工具",
            );
          }
        }

        totalToolCalls += toolCalls.length;

        if (toolCalls.length === 0 && llmStopReason === "max_tokens") {
          consecutiveMaxTokensWithoutTools++;
          if (
            consecutiveMaxTokensWithoutTools >=
            MAX_CONSECUTIVE_MAX_TOKEN_NO_TOOL
          ) {
            forcedStopReason = "llm_max_tokens_stalled";
            fullText =
              `连续 ${consecutiveMaxTokensWithoutTools} 次输出被截断且没有产生工具调用，` +
              "系统已停止本轮任务，避免继续空转。请缩小任务范围，或先修复导致模型无法落地执行的工具/上下文问题。";
          }
        } else {
          consecutiveMaxTokensWithoutTools = 0;
        }

        if (
          toolCalls.length === 0 &&
          llmStopReason === "max_tokens" &&
          !forcedStopReason &&
          !fullText.trim()
        ) {
          forcedStopReason = "llm_max_tokens_truncated";
          fullText =
            "模型输出达到 max_tokens 上限且没有产生可执行工具调用，任务已停止。请缩小任务范围，或改用外部委托/文件写入工具完成。";
        }

        if (
          toolCalls.length === 0 &&
          taskToolProfile.kind === "news_brief" &&
          !INVALID_TOOL_MARKUP_RE.test(fullText)
        ) {
          fullText = appendSourceLinksIfMissing(
            fullText,
            trace.steps as TraceStep[],
          );
          const hasVerifiedWrittenArtifact = (trace.steps as TraceStep[]).some(
            (step) => {
              const effect = step.effect as ToolEffect | undefined;
              return (
                step.type === "tool_result" &&
                effect?.kind === "write" &&
                effect.verified
              );
            },
          );
          if (allSentFiles.length === 0 && !hasVerifiedWrittenArtifact) {
            fullText = ensureNewsBriefFinalQuality(
              fullText,
              (trace.steps as TraceStep[])
                .filter(
                  (step) =>
                    step.type === "tool_result" &&
                    typeof step.content === "string",
                )
                .map((step) => String(step.content)),
            );
          }
        }

        // When this is the final response (no tool calls), append file markdown
        // so that sent files persist in the conversation history.
        // Skip files whose filename already appears in the LLM's response text.
        let storedText = fullText;

        if (
          toolCalls.length === 0 &&
          INVALID_TOOL_MARKUP_RE.test(fullText) &&
          iterations < this._config.maxIterations
        ) {
          const completedArtifact =
            taskToolProfile.kind === "news_brief"
              ? newsBriefCompletedArtifactResponse(
                  trace.steps as TraceStep[],
                  allSentFiles,
                  "新闻简报已生成",
                )
              : null;
          if (completedArtifact) {
            fullText = completedArtifact;
            storedText = fullText;
          } else {
            invalidFinalMarkupRetries++;
            if (
              isPptxGenerationTask &&
              allSentFiles.every((f) => !/\.pptx$/i.test(f.filename)) &&
              invalidFinalMarkupRetries < 3
            ) {
              runtimeHints.push(
                "[PPTX任务继续]上一轮输出了不可执行的伪工具标记。工具仍可用；不要输出 XML/tool_call/function/parameter 文本。下一步必须用结构化工具调用：use_skill pptx（如未加载）、claude_code/bash 生成 deck、verify_pptx.py --json 验证、send_file 发送验证通过的 .pptx。",
              );
              continue;
            }
            if (
              taskToolProfile.kind === "reddit_rss" &&
              allSentFiles.length === 0 &&
              invalidFinalMarkupRetries < 3
            ) {
              runtimeHints.push(
                `[RSS任务继续]上一轮输出了不可执行的伪工具标记。工具仍可用；不要输出 XML/tool_call/function/parameter 文本。rss_top 的结果已经在上下文中，禁止再调用 rss_top 或 file_read。下一步必须用结构化工具调用：file_write 写入 ${sessionTmpDir}/reddit-tech-ai-daily.md，然后 send_file 发送该 Markdown 文件。`,
              );
              continue;
            }
            if (invalidFinalMarkupRetries >= 2) {
              forcedStopReason = "invalid_tool_markup_final";
              fullText = buildSynthesisFallbackResponse(
                inputTextForHeuristics,
                messages,
                allSentFiles,
                fallbackSnippets,
                "模型输出了不可执行的工具标记",
              );
              storedText = fullText;
            } else {
              forceSynthesisOnly = true;
              runtimeHints.push(
                "[SYSTEM] Your last output was invalid tool-call markup rendered as text. Tools are not available now. Do not output XML/tool_call/function/parameter tags. Write the final user-facing answer directly in Chinese from the facts already gathered.",
              );
              continue;
            }
          }
        }

        if (
          toolCalls.length === 0 &&
          (isPptxGenerationTask || pptxSkillLoaded) &&
          allSentFiles.every((f) => !/\.pptx$/i.test(f.filename)) &&
          !forcedStopReason &&
          iterations < this._config.maxIterations
        ) {
          pptxMissingDeliveryRetries++;
          if (pptxMissingDeliveryRetries <= 2) {
            runtimeHints.push(
              `[PPTX任务未完成]还没有发送任何 .pptx 文件。不要回复“已生成”。下一步必须在 ${sessionTmpDir} 运行 verifier：python "${resolveBundledPptxVerifierPath(context?.skillsDir).replace(/\\/g, "/")}" "${sessionTmpDir}/output.pptx" --out-dir "${sessionTmpDir}/previews" --require-text --json；只有 ok:true 后才能 send_file。`,
            );
            continue;
          }
        }

        if (toolCalls.length === 0 && allSentFiles.length > 0) {
          const newFiles = allSentFiles.filter(
            (f) => !fullText.includes(f.url),
          );
          if (newFiles.length > 0) {
            const filesMd = markdownForSentFiles(newFiles);
            storedText = storedText ? `${storedText}\n${filesMd}` : filesMd;
          }
        }

        // BeforeReturn hooks (replaces hardcoded incomplete-todo guard)
        if (
          toolCalls.length === 0 &&
          !forcedStopReason &&
          iterations < this._config.maxIterations
        ) {
          const hookResult = await context?.toolHooks?.beforeReturn?.({
            response: fullText,
            runtimeHints,
            todoItems,
          });
          if (hookResult?.action === "continue") {
            runtimeHints.push(hookResult.hint);
            todoAutoIndex = todoItems.length; // prevent infinite reminders
            continue;
          }
        }

        // ── Auto-send unsent files mentioned in response ──
        // If the LLM mentions a data/tmp/ file path but didn't call send_file,
        // automatically send it. Prevents "here's your file at D:/..." on IM channels.
        if (toolCalls.length === 0 && context?.sendFile && fullText) {
          const filePathPattern =
            /[A-Za-z]:\/[^\s"'<>|]*data\/tmp\/[^\s"'<>|]+\.[a-z]{1,5}/gi;
          const mentionedPaths = fullText.match(filePathPattern) || [];
          const sentUrls = new Set(allSentFiles.map((f) => f.url));
          for (const filePath of mentionedPaths) {
            const normalized = filePath.replace(/\\/g, "/");
            const filename = normalized.split("/").pop() || "";
            // Skip if already sent or if it's an overflow file
            if (
              sentUrls.has(`/files/${filename}`) ||
              filename.startsWith("overflow_") ||
              (isPptxGenerationTask && !/\.pptx$/i.test(filename)) ||
              (isPptxGenerationTask &&
                !verifiedPptxPaths.has(
                  normalizeComparablePath(normalized, sessionTmpDir),
                ))
            ) {
              continue;
            }
            try {
              const { existsSync } = await import("node:fs");
              if (existsSync(normalized)) {
                await context.sendFile(normalized, filename);
                recordDirectSendEffect(normalized, "auto_send_mentioned_file");
                console.log(`[agent-loop] Auto-sent unsent file: ${filename}`);
              }
            } catch {
              // Best-effort, don't block response
            }
          }
        }

        // If no tool calls, this is the final turn — store cumulative totals
        if (toolCalls.length === 0) {
          if (isPptxGenerationTask || pptxSkillLoaded) {
            storedText = pptxOnlySentFileMarkdown(allSentFiles) ?? storedText;
          }
          const durationMs = Date.now() - startTime;

          const assistantTurn: ConversationTurn = {
            id: generateId(),
            conversationId: convId,
            role: "assistant",
            content: storedText,
            model: usedModel,
            reasoningContent: iterReasoningContent || undefined,
            tokensIn: totalTokensIn,
            tokensOut: totalTokensOut,
            cacheCreationTokens: totalCacheCreationTokens || undefined,
            cacheReadTokens: totalCacheReadTokens || undefined,
            durationMs,
            toolCallCount: totalToolCalls,
            traceId: trace.id,
            createdAt: new Date(),
          };
          await this.memoryStore.addTurn(convId, assistantTurn);

          // Finalize and persist trace
          trace.response = storedText;
          trace.model = usedModel;
          trace.tokensIn = totalTokensIn;
          trace.tokensOut = totalTokensOut;
          trace.cacheCreationTokens = totalCacheCreationTokens || undefined;
          trace.cacheReadTokens = totalCacheReadTokens || undefined;
          trace.durationMs = durationMs;
          if (forcedStopReason) trace.error = forcedStopReason;
          try {
            await persistTrace();
          } catch (e) {
            console.error("[agent-loop] Failed to persist trace:", e);
          }

          const message: Message = {
            id: generateId(),
            role: "assistant",
            content: storedText,
            createdAt: new Date(),
            model: usedModel,
            tokensIn: totalTokensIn,
            tokensOut: totalTokensOut,
            cacheCreationTokens: totalCacheCreationTokens || undefined,
            cacheReadTokens: totalCacheReadTokens || undefined,
            durationMs,
            toolCallCount: totalToolCalls,
          };
          const remainingText = responseStream.remainingFor(storedText);
          if (remainingText) {
            yield this.createEvent("response_chunk", {
              text: remainingText,
            });
          }
          this.setState("idle");
          yield this.createEvent("response_complete", {
            message,
            agentId: context?.agentId,
          });
          return;
        }

        // Intermediate turn — store per-iteration tokens
        const assistantTurnCreatedAt = new Date();
        const assistantTurn: ConversationTurn = {
          id: generateId(),
          conversationId: convId,
          role: "assistant",
          content: storedText,
          toolCalls: JSON.stringify(toolCalls),
          model: usedModel,
          reasoningContent: iterReasoningContent || undefined,
          tokensIn: iterTokensIn,
          tokensOut: iterTokensOut,
          traceId: trace.id,
          createdAt: assistantTurnCreatedAt,
        };
        await this.memoryStore.addTurn(convId, assistantTurn);

        // Execute tool calls — pure tools run in parallel, impure tools act as barriers
        this.setState("tool_calling");
        let iterationErrorCount = 0;
        let hasAutoComplete = false;

        // Helper: execute a single tool call (no yielding — pure computation)
        type ToolExecResult = {
          toolCall: (typeof toolCalls)[0];
          effectiveToolName: string;
          effectiveToolInput: Record<string, unknown>;
          result: ToolResult;
          toolDurationMs: number;
          blockedByPolicy: boolean;
          isFormatError: boolean;
          rateLimited: boolean; // blocked by our dedup/limit guards
        };

        const executeOne = async (
          tc: (typeof toolCalls)[0],
        ): Promise<ToolExecResult> => {
          let effectiveToolName = tc.name;
          let effectiveToolInput = tc.input;
          let result!: ToolResult;
          let blockedByPolicy = false;

          // Check tool access policy
          if (context?.toolPolicy) {
            const { allow, deny } = context.toolPolicy;
            const denied = deny?.includes(effectiveToolName);
            const notAllowed = allow && !allow.includes(effectiveToolName);
            if (denied || notAllowed) {
              result = {
                content: `Tool "${effectiveToolName}" is disabled by policy. Do NOT retry — use an alternative approach.`,
                isError: true,
              };
              blockedByPolicy = true;
            }
          }

          // Run before hooks (skip if already blocked by policy)
          if (!blockedByPolicy && context?.toolHooks?.before) {
            const modified = await context.toolHooks.before({
              name: effectiveToolName,
              input: effectiveToolInput,
            });
            if (modified === null) {
              result = {
                content: `Tool "${effectiveToolName}" is disabled by configuration. Do NOT retry this tool — use an alternative approach (e.g., if glob is blocked, try grep or file_read with a known path).`,
                isError: true,
              };
              blockedByPolicy = true;
            } else {
              effectiveToolName = modified.name;
              effectiveToolInput = modified.input;
            }
          }

          if (
            !blockedByPolicy &&
            effectiveToolName === "subagent" &&
            (pptxSkillLoaded || isPptxGenerationTask) &&
            !isExplicitSubagentRequest(inputTextForHeuristics)
          ) {
            result = {
              content:
                "Skipped for PPTX tasks: subagent preview checks add latency and cannot verify slide quality reliably. Continue in the main task with the official verify_pptx.py --json gate and send only the verified .pptx.",
              isError: false,
            };
            blockedByPolicy = true;
          }

          if (
            !blockedByPolicy &&
            taskToolProfile.allowedTools &&
            !taskToolProfile.allowedTools.has(effectiveToolName)
          ) {
            result = {
              content:
                `Tool "${effectiveToolName}" is not allowed for ${taskToolProfile.kind} tasks. ` +
                `Use only: ${Array.from(taskToolProfile.allowedTools).join(", ")}.`,
              isError: taskToolProfile.kind !== "wechat_publish",
            };
            blockedByPolicy = true;
            if (taskToolProfile.kind !== "wechat_publish") {
              forceSynthesisOnly = true;
            }
          }

          if (!blockedByPolicy && effectiveToolName === "bash") {
            const command =
              typeof effectiveToolInput.command === "string"
                ? effectiveToolInput.command.replace(/\\/g, "/")
                : "";
            const bashPolicyDecision = evaluateBashToolPolicy(command);
            if (bashPolicyDecision.action === "deny") {
              result = {
                content: bashPolicyDecision.content,
                isError: true,
              };
              blockedByPolicy = true;
              forceSynthesisOnly = bashPolicyDecision.forceSynthesisOnly;
            } else {
              effectiveToolInput = hardenPdfBashInput(
                effectiveToolInput,
                sessionTmpDir,
                inputTextForHeuristics,
              );
            }
          }

          if (
            !blockedByPolicy &&
            effectiveToolName === "claude_code" &&
            (pptxSkillLoaded || isPptxGenerationTask)
          ) {
            effectiveToolInput = hardenPptxClaudeCodeInput(
              effectiveToolInput,
              context?.workDir,
              context?.skillsDir,
            );
          }

          if (!blockedByPolicy && taskToolProfile.kind === "wechat_publish") {
            if (effectiveToolName === "use_skill" && wechatPublishSkillLoaded) {
              result = {
                content:
                  "Skipped for wechat_publish tasks: wechat-publish skill is already loaded. Continue with file_write for Markdown or the anchored wechat_publish.py inspect/publish command.",
                isError: false,
              };
              blockedByPolicy = true;
            }
            if (effectiveToolName === "bash") {
              let command =
                typeof effectiveToolInput.command === "string"
                  ? effectiveToolInput.command.replace(/\\/g, "/")
                  : "";
              const inspectMarkdownMatch = command.match(
                /wechat_publish\.py["']?\s+inspect\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/,
              );
              const inspectedMarkdownPath =
                inspectMarkdownMatch?.[1] ??
                inspectMarkdownMatch?.[2] ??
                inspectMarkdownMatch?.[3];
              if (inspectedMarkdownPath?.toLowerCase().endsWith(".md")) {
                wechatPublishHasMarkdown = true;
                wechatPublishMarkdownPath = inspectedMarkdownPath.replace(
                  /\\/g,
                  "/",
                );
              }
              if (
                /wechat_publish\.py["']?\s+publish\b/.test(command) &&
                !/wechat_publish\.py["']?\s+publish\s+(?!--)(?:"[^"]+\.md"|'[^']+\.md'|[^\s]+\.md\b)/i.test(
                  command,
                ) &&
                wechatPublishMarkdownPath
              ) {
                const quotedPath = `"${wechatPublishMarkdownPath.replace(/"/g, '\\"')}"`;
                command = command.replace(
                  /(wechat_publish\.py["']?\s+publish\b)/,
                  `$1 ${quotedPath}`,
                );
                effectiveToolInput = {
                  ...effectiveToolInput,
                  command,
                };
              }
              const isAnchoredWechatCli = isAnchoredWechatPublishCommand(
                command,
                wechatPublishRoot,
              );
              if (!wechatPublishHasMarkdown) {
                result = {
                  content:
                    "Skipped for wechat_publish tasks: write the source Markdown article with file_write first, then run the anchored wechat_publish.py inspect/publish commands with --json. Do not use bash for drafting or content checks.",
                  isError: false,
                };
                blockedByPolicy = true;
              } else if (!isAnchoredWechatCli) {
                result = {
                  content:
                    `Blocked for wechat_publish tasks: bash may only run the anchored unified CLI, e.g. \`cd "${wechatPublishRoot}" && python ${WECHAT_PUBLISH_SCRIPT} inspect|publish ... --json\`. Write the article with file_write as Markdown; do not hand-roll HTML/Node conversion or search for alternate skill paths.`,
                  isError: !wechatPublishMarkdownCreatedInRun,
                };
                blockedByPolicy = true;
              } else if (
                !/wechat_publish\.py["']?\s+(capabilities|inspect|publish)\b/.test(
                  command,
                )
              ) {
                result = {
                  content:
                    `Skipped for wechat_publish tasks: only capabilities, inspect, and publish subcommands are allowed. Do not run preview/convert/help; continue with \`cd "${wechatPublishRoot}" && python ${WECHAT_PUBLISH_SCRIPT} publish ... --json\`.`,
                  isError: false,
                };
                blockedByPolicy = true;
              } else if (!/(^|\s)--json(\s|$)/.test(command)) {
                result = {
                  content:
                    "Skipped for wechat_publish tasks: all wechat_publish.py capabilities/inspect/publish commands must include --json so the runtime can verify code, manifest_json, and theme_selection. Re-run the same anchored CLI command with --json.",
                  isError: false,
                };
                blockedByPolicy = true;
              } else if (
                wechatPublishReadyToPublish &&
                !/wechat_publish\.py["']?\s+publish\b/.test(command)
              ) {
                result = {
                  content:
                    `Skipped for wechat_publish tasks: inspect already passed. The only allowed next command is \`cd "${wechatPublishRoot}" && python ${WECHAT_PUBLISH_SCRIPT} publish ... --json\`.`,
                  isError: false,
                };
                blockedByPolicy = true;
              } else if (
                /wechat_publish\.py["']?\s+publish\b[^\n]*\s--draft(\s|=|$)/.test(
                  command,
                )
              ) {
                result = {
                  content:
                    "Skipped invalid publish command: --draft is only for inspect and must not be used with publish. Re-run publish without --draft.",
                  isError: false,
                };
                blockedByPolicy = true;
              }
            }
            if (effectiveToolName === "file_write") {
              const targetPath =
                typeof effectiveToolInput.path === "string"
                  ? effectiveToolInput.path.replace(/\\/g, "/").toLowerCase()
                  : "";
              if (!targetPath.endsWith(".md")) {
                result = {
                  content:
                    "Blocked for wechat_publish tasks: file_write may only write the source Markdown article (.md). Do not hand-write HTML/JSON artifacts; use wechat_publish.py to convert and publish.",
                  isError: true,
                };
                blockedByPolicy = true;
              }
            }
          }

          if (
            !blockedByPolicy &&
            effectiveToolName === "bash" &&
            (pptxSkillLoaded || isPptxGenerationTask)
          ) {
            const command =
              typeof effectiveToolInput.command === "string"
                ? effectiveToolInput.command.replace(/\\/g, "/")
                : "";
            if (
              /(^|\s|["'`])claude(?:\.cmd|\.exe)?(?:\s|$)/i.test(command) ||
              /tools\/claude-code|claude-code/i.test(command)
            ) {
              result = {
                content:
                  "Blocked for PPTX tasks: do not run Claude Code through bash. Use the structured claude_code tool directly with cwd set to the session work directory, then run verify_pptx.py --json and send_file the verified deck.",
                isError: true,
              };
              blockedByPolicy = true;
            } else if (
              /\bpython(?:\d+(?:\.\d+)?)?\s+-c\s+["'][^"']*\bimport\s+pptx\b/i.test(
                command,
              )
            ) {
              result = {
                content:
                  "Skipped for PPTX tasks: do not run standalone python-pptx preflight checks. Write and run the deck generation script directly; if it fails with ModuleNotFoundError for pptx, report the missing dependency.",
                isError: false,
              };
              blockedByPolicy = true;
            } else if (
              /(?:^|\s)(?:python\s+-m\s+pip|pip)\s+install\b/i.test(command)
            ) {
              result = {
                content:
                  "Skipped for PPTX tasks: do not install Python packages during deck generation. Use the existing environment; write and run the deck generation script directly, and report ModuleNotFoundError instead of installing if a dependency is missing.",
                isError: false,
              };
              blockedByPolicy = true;
            } else if (
              Array.from(unverifiedPptxCandidates).some(
                (candidate) => !verifiedPptxPaths.has(candidate),
              ) &&
              !isOfficialPptxVerifierCommand(command)
            ) {
              const verifierPath = resolveBundledPptxVerifierPath(
                context?.skillsDir,
              ).replace(/\\/g, "/");
              result = {
                content:
                  "Skipped for PPTX tasks: a .pptx candidate already exists. Do not run custom inspection, LibreOffice conversion, PDF/PNG preview rendering, or dependency installation before verification. " +
                  `Run the official verifier with --json next, e.g. \`python "${verifierPath}" "${context?.workDir ?? "."}/output.pptx" --out-dir "${context?.workDir ?? "."}/previews" --require-text --json\`; then send_file the verified .pptx.`,
                isError: false,
              };
              blockedByPolicy = true;
            }
          }

          if (
            !blockedByPolicy &&
            effectiveToolName === "send_file" &&
            (pptxSkillLoaded || isPptxGenerationTask)
          ) {
            const requestedPath =
              typeof effectiveToolInput.path === "string"
                ? effectiveToolInput.path
                : "";
            if (!/\.pptx$/i.test(requestedPath.trim())) {
              const verifiedPath = Array.from(
                verifiedPptxDeliverables.values(),
              )[0];
              result = {
                content: verifiedPath
                  ? `Skipped for PPTX delivery: do not send preview images, PDFs, scripts, or other side files as the final artifact. The verified PPTX is ${verifiedPath.replace(/\\/g, "/")}; send that .pptx only.`
                  : "Skipped for PPTX delivery: do not send preview images, PDFs, scripts, or other side files as the final artifact. Generate and verify the .pptx with verify_pptx.py --json, then send the verified .pptx.",
                isError: false,
              };
              blockedByPolicy = true;
            } else {
              const resolvedRequestedPath = isAbsolute(requestedPath)
                ? resolve(requestedPath)
                : resolve(context?.workDir ?? process.cwd(), requestedPath);
              const normalizedRequestedPath = normalizeComparablePath(
                requestedPath,
                context?.workDir,
              );
              const inWorkDir =
                context?.workDir &&
                isPathInside(normalizedRequestedPath, context.workDir);
              if (!inWorkDir) {
                result = {
                  content: `Blocked for PPTX delivery: the verified deck is outside the session work directory. Copy it into ${context?.workDir}, re-run verify_pptx.py on the copied file, then send that verified in-session .pptx.`,
                  isError: true,
                };
                blockedByPolicy = true;
              } else if (
                !verifiedPptxPaths.has(normalizedRequestedPath) &&
                context?.workDir &&
                existsSync(resolvedRequestedPath)
              ) {
                const verification = await verifyPptxForDelivery({
                  pptxPath: resolvedRequestedPath,
                  workDir: context.workDir,
                  skillsDir: context.skillsDir,
                });
                for (const pptxPath of verification.verifiedPaths) {
                  rememberVerifiedPptx(pptxPath);
                }
                if (!verification.ok) {
                  result = {
                    content:
                      "Blocked for PPTX delivery: automatic verify_pptx.py --json failed, so the deck was not sent.\n" +
                      verification.content.slice(0, 3000),
                    isError: true,
                  };
                  blockedByPolicy = true;
                } else {
                  runtimeHints.push(
                    `<pptx_verified>${resolvedRequestedPath.replace(/\\/g, "/")}</pptx_verified>`,
                  );
                }
              } else if (!verifiedPptxPaths.has(normalizedRequestedPath)) {
                const verifierPath = resolveBundledPptxVerifierPath(
                  context?.skillsDir,
                ).replace(/\\/g, "/");
                result = {
                  content: `Blocked for PPTX delivery: do not send a .pptx until the bundled verifier has reported ok:true for that exact file. Run \`python "${verifierPath}" "${context?.workDir}/deck.pptx" --out-dir "${context?.workDir}/previews" --require-text --json\`, then call send_file for the verified file.`,
                  isError: true,
                };
                blockedByPolicy = true;
              }
            }
          }

          const toolStart = Date.now();
          const toolContext: ToolExecutionContext = {
            ...context,
            getObservation: async (id: string) => {
              const observation = await this.memoryStore.getObservation(id);
              if (!observation) return undefined;
              if (observation.traceId !== trace.id) return undefined;
              if (!existsSync(observation.rawPath)) return undefined;
              return {
                id: observation.id,
                raw: readFileSync(observation.rawPath, "utf-8"),
              };
            },
            recordObservationRead: async (record) => {
              await this.memoryStore.recordObservationRead({
                observationId: record.id,
                traceId: trace.id,
                stepId: tc.id,
                query: record.query,
                offset: record.offset,
                length: record.length,
                returnedChars: record.returnedChars,
              });
            },
          };
          const executionContext =
            context || effectiveToolName === "observation_read"
              ? toolContext
              : undefined;

          if (!blockedByPolicy) {
            globalCallCount++;

            // Absolute safety net: cap total tool calls per user message
            if (globalCallCount > MAX_TOTAL_TOOL_CALLS) {
              console.log(
                `[agent-loop] Global tool call limit reached: ${globalCallCount}/${MAX_TOTAL_TOOL_CALLS}`,
              );
              result = {
                content: `Global tool call limit reached (${MAX_TOTAL_TOOL_CALLS}). You MUST stop using tools and respond to the user immediately with whatever information you have gathered so far.`,
                isError: true,
              };
              forceSynthesisOnly = true;
              runtimeHints.push(
                `<tool_budget_exhausted>Total tool call budget is exhausted (${MAX_TOTAL_TOOL_CALLS}). No tools are available now. Write the final answer from gathered facts immediately.</tool_budget_exhausted>`,
              );
            }

            const dupKey = buildFailKey(effectiveToolName, effectiveToolInput);
            const priorCalls = toolCallCounts.get(dupKey) ?? 0;
            toolCallCounts.set(dupKey, priorCalls + 1);

            // Track total calls per tool name (regardless of params)
            const nameCount = (toolNameCounts.get(effectiveToolName) ?? 0) + 1;
            toolNameCounts.set(effectiveToolName, nameCount);
            const totalLimit = TOOL_TOTAL_LIMITS[effectiveToolName];
            const totalLimitExceeded = Boolean(
              totalLimit && nameCount > totalLimit,
            );
            const isWebResearchTool =
              effectiveToolName === "web_search" ||
              effectiveToolName === "web_fetch";
            if (isWebResearchTool && !totalLimitExceeded) {
              webResearchToolCalls++;
            }
            const fileReadPath =
              effectiveToolName === "file_read" &&
              typeof effectiveToolInput.path === "string"
                ? effectiveToolInput.path.replace(/\\/g, "/")
                : "";
            const isOverflowFileRead = fileReadPath.includes("/overflow_");
            if (isOverflowFileRead) overflowFileReadCalls++;

            // Detect repetitive calls — same tool+params called too many times
            if (result) {
              // Already blocked by global limit above
            } else if (
              sufficientWeatherFactHint &&
              (effectiveToolName === "web_search" ||
                effectiveToolName === "web_fetch" ||
                effectiveToolName === "grep" ||
                effectiveToolName === "file_read")
            ) {
              result = {
                content:
                  "已拦截：天气查询已经有足够事实，禁止继续搜索、抓网页或读取 overflow 文件。请立即根据以下事实回答用户，不要说已出现的字段未获取。\n" +
                  sufficientWeatherFactHint,
                isError: true,
              };
              result.content =
                "Blocked: the weather query already has enough facts. Do not search, fetch pages, or read overflow files. Answer the user now from these facts, and do not claim visible fields are missing.\n" +
                sufficientWeatherFactHint;
            } else if (
              isWebResearchTool &&
              webResearchToolCalls > WEB_RESEARCH_TOOL_LIMIT
            ) {
              console.log(
                `[agent-loop] Web research tool limit reached: ${webResearchToolCalls}/${WEB_RESEARCH_TOOL_LIMIT}`,
              );
              if (taskToolProfile.kind === "wechat_publish") {
                result = {
                  content:
                    `You already made ${WEB_RESEARCH_TOOL_LIMIT} web_search/web_fetch call(s). ` +
                    `Stop researching now. Continue the WeChat publishing task with non-research tools: write the Markdown article, load wechat-publish if needed, run \`cd "${wechatPublishRoot}" && python ${WECHAT_PUBLISH_SCRIPT} inspect ... --json\`, then run publish with --out-dir. Do not stop at preview or output only a research summary.`,
                  isError: true,
                };
                runtimeHints.push(
                  "<research_budget_exhausted>Research budget is exhausted for this WeChat publishing task. Web tools are no longer useful; continue with file_write/use_skill/bash to create the article and publish it. Do not stop at a summary.</research_budget_exhausted>",
                );
              } else if (isPptxGenerationTask) {
                result = {
                  content:
                    `You already made ${WEB_RESEARCH_TOOL_LIMIT} web_search/web_fetch call(s). ` +
                    "Stop researching now. Continue the PPTX task with non-research tools: use_skill pptx, generate the deck in the session work directory, run verify_pptx.py with --json, then send_file the verified .pptx.",
                  isError: true,
                };
                runtimeHints.push(
                  "<pptx_research_budget_exhausted>Research budget is exhausted. Do not search or fetch again. Continue with use_skill pptx, deck generation, verify_pptx.py --json, and send_file.</pptx_research_budget_exhausted>",
                );
              } else {
                result = {
                  content:
                    `You already made ${WEB_RESEARCH_TOOL_LIMIT} web_search/web_fetch call(s). ` +
                    "Stop researching now. Do not call web_search, web_fetch, file_read, or grep for overflow files. Generate the final answer from the facts already in context.",
                  isError: true,
                };
                forceSynthesisOnly = true;
                runtimeHints.push(
                  "<research_budget_exhausted>Research budget is exhausted. No more tools are available. Write the final answer from the gathered facts now.</research_budget_exhausted>",
                );
              }
            } else if (
              isOverflowFileRead &&
              overflowFileReadCalls > OVERFLOW_FILE_READ_LIMIT
            ) {
              console.log(
                `[agent-loop] Overflow file_read limit reached: ${overflowFileReadCalls}/${OVERFLOW_FILE_READ_LIMIT}`,
              );
              result = {
                content:
                  `You already read ${OVERFLOW_FILE_READ_LIMIT} overflow file preview/range(s). ` +
                  "Stop reading overflow files. Generate the final answer from the previews and facts already in context.",
                isError: true,
              };
              forceSynthesisOnly = true;
              runtimeHints.push(
                "<research_budget_exhausted>Research budget is exhausted. No more tools are available. Write the final answer from the gathered facts now.</research_budget_exhausted>",
              );
            } else if (totalLimitExceeded) {
              console.log(
                `[agent-loop] Total call limit reached: ${effectiveToolName} (${nameCount}/${totalLimit})`,
              );
              result = {
                content: `You have called ${effectiveToolName} ${nameCount} times in this session (limit: ${totalLimit}). You have enough information — stop searching and synthesize your answer NOW from the results you already have.`,
                isError: true,
              };
              if (
                taskToolProfile.kind === "reddit_rss" ||
                taskToolProfile.kind === "evidence_table_analysis" ||
                (taskToolProfile.kind === "news_brief" &&
                  !isPptxGenerationTask &&
                  (effectiveToolName === "web_fetch" ||
                    successfulWebFetchCalls >= 2))
              ) {
                forceSynthesisOnly = true;
              }
              runtimeHints.push(
                "<tool_budget_exhausted>This specific tool has reached its task budget. Do not call it again; write the final answer from gathered facts or use another still-allowed tool only if essential.</tool_budget_exhausted>",
              );
            } else if (priorCalls >= MAX_DUPLICATE_CALLS) {
              console.log(
                `[agent-loop] Duplicate call blocked: ${effectiveToolName} (${priorCalls + 1}x)`,
              );
              result = {
                content: `You have already called ${effectiveToolName} with the same parameters ${priorCalls} times. Use the results you already have. Do NOT search again — synthesize your answer from existing information.`,
                isError: true,
              };
            } else if (toolFailCounts.get(dupKey) ?? 0 >= MAX_TOOL_FAILURES) {
              result = {
                content: `This tool has failed ${toolFailCounts.get(dupKey)} times in this conversation. Stop retrying and tell the user what went wrong.`,
                isError: true,
              };
            } else {
              result = await this.toolRegistry.execute(
                effectiveToolName,
                effectiveToolInput,
                executionContext,
              );

              // Retry retryable tools on failure
              if (result.isError && RETRYABLE_TOOLS.has(effectiveToolName)) {
                const retryAttempts = result.metadata?.timedOut
                  ? 0
                  : MAX_RETRIES;
                for (let attempt = 1; attempt <= retryAttempts; attempt++) {
                  if (this.aborted) break;
                  const delay = RETRY_BASE_DELAY * 2 ** (attempt - 1);
                  console.log(
                    `[agent-loop] Retrying ${effectiveToolName} (attempt ${attempt}/${retryAttempts}) after ${delay}ms...`,
                  );
                  await new Promise((r) => setTimeout(r, delay));
                  if (this.aborted) break;
                  result = await this.toolRegistry.execute(
                    effectiveToolName,
                    effectiveToolInput,
                    executionContext,
                  );
                  if (!result.isError) break;
                }
              }
            }

            // Run after hooks
            if (context?.toolHooks?.after) {
              result = await context.toolHooks.after(
                { name: effectiveToolName, input: effectiveToolInput },
                result!,
              );
            }

            if (
              effectiveToolName === "web_fetch" &&
              result &&
              !result.isError &&
              !result.autoComplete &&
              result.metadata?.saved === true &&
              result.metadata.sent !== true &&
              typeof result.metadata.filePath === "string" &&
              context?.sendFile &&
              wantsFileDelivery(inputTextForHeuristics)
            ) {
              const savedPath = result.metadata.filePath;
              await context.sendFile(savedPath);
              result.content = `Fetched and sent: ${basename(savedPath)} (${result.metadata.originalLength ?? "saved"} chars).`;
              result.autoComplete = true;
              result.metadata = {
                ...result.metadata,
                sent: true,
                autoSentAfterSave: true,
              };
              result.effect = {
                kind: "send",
                target: savedPath,
                reversible: false,
                deliverable: true,
                verified: true,
              };
            }

            if (
              effectiveToolName === "bash" &&
              result &&
              !result.isError &&
              isPdfExtractionTask(inputTextForHeuristics)
            ) {
              const recovered = await recoverPdfTextFromSessionPdf(
                sessionTmpDir,
                inputTextForHeuristics,
              );
              if (
                recovered &&
                !String(result.content ?? "").includes(recovered)
              ) {
                result.content = `${String(result.content ?? "")}${recovered}`;
                result.metadata = {
                  ...(result.metadata ?? {}),
                  pdfTextAutoRecovered: true,
                };
              }
            }

            const offloadInfo = await applyOverflow(
              result!,
              effectiveToolName,
              ensureSessionTmpDir,
              this.memoryStore,
              trace.id,
              tc.id,
              effectiveToolInput,
            );
            if (offloadInfo) {
              activeToolOffloads.push(offloadInfo);
              runtimeHints.push(buildActiveToolOffloadHint(offloadInfo));
              const canvas = buildToolOffloadCanvas(activeToolOffloads);
              if (offloadCanvasHintIndex === null) {
                runtimeHints.push(canvas);
                offloadCanvasHintIndex = runtimeHints.length - 1;
              } else {
                runtimeHints[offloadCanvasHintIndex] = canvas;
              }
              if (
                effectiveToolName === "web_fetch" &&
                wantsFullFetchedText(inputTextForHeuristics) &&
                context?.sendFile &&
                offloadInfo.rawPath !== "raw file unavailable"
              ) {
                let sendPath = offloadInfo.rawPath;
                if (wantsMarkdownFile(inputTextForHeuristics)) {
                  sendPath = offloadInfo.rawPath.replace(/\.txt$/i, ".md");
                  if (sendPath === offloadInfo.rawPath) {
                    sendPath = `${offloadInfo.rawPath}.md`;
                  }
                  copyFileSync(offloadInfo.rawPath, sendPath);
                }
                const filename = basename(sendPath);
                await context.sendFile(
                  sendPath,
                  sendPath !== offloadInfo.rawPath ? filename : undefined,
                );
                result!.content = `Fetched and sent full text: ${filename} (${offloadInfo.rawChars} chars).`;
                result!.autoComplete = true;
                result!.metadata = {
                  ...(result!.metadata ?? {}),
                  fullTextSent: true,
                  sentFilename: filename,
                  ...(sendPath !== offloadInfo.rawPath
                    ? { sentPath: sendPath, markdownFilePath: sendPath }
                    : {}),
                };
                result!.effect = {
                  kind: "send",
                  target: sendPath,
                  reversible: false,
                  deliverable: true,
                  verified: true,
                };
              }
            }
          }

          if (
            taskToolProfile.kind === "wechat_publish" &&
            result &&
            !result.isError
          ) {
            const content = String(result.content ?? "");
            if (effectiveToolName === "use_skill") {
              const skillName = String(
                effectiveToolInput.name ?? effectiveToolInput.skillId ?? "",
              ).trim();
              if (skillName === "wechat-publish") {
                wechatPublishSkillLoaded = true;
              }
            }
            if (effectiveToolName === "file_write") {
              const targetPath =
                typeof effectiveToolInput.path === "string"
                  ? effectiveToolInput.path.replace(/\\/g, "/").toLowerCase()
                  : "";
              if (targetPath.endsWith(".md")) {
                wechatPublishHasMarkdown = true;
                wechatPublishMarkdownCreatedInRun = true;
                runtimeHints.push(
                  "<wechat_publish_markdown_ready>Markdown source is written. Do not search, rewrite, preview, or use other tools. Next run the anchored wechat_publish.py inspect command with --json.</wechat_publish_markdown_ready>",
                );
              }
            }
            if (effectiveToolName === "bash") {
              const command =
                typeof effectiveToolInput.command === "string"
                  ? effectiveToolInput.command.replace(/\\/g, "/")
                  : "";
              if (
                /wechat_publish\.py["']?\s+inspect\b/.test(command) &&
                content.includes('"success": true') &&
                content.includes('"code": "INSPECT_READY"')
              ) {
                wechatPublishReadyToPublish = true;
                runtimeHints.push(
                  "<wechat_publish_ready>Inspect succeeded. Do not search, rewrite, preview, send files, or call use_skill again. The next tool call must be the anchored wechat_publish.py publish command with --json.</wechat_publish_ready>",
                );
              }
              if (
                /wechat_publish\.py["']?\s+publish\b/.test(command) &&
                (content.includes('"code": "DRAFT_CREATED"') ||
                  content.includes('"code": "DRAFT_DRY_RUN_READY"'))
              ) {
                wechatPublishCompleted = true;
                forceSynthesisOnly = true;
                runtimeHints.push(
                  "<wechat_publish_completed>Publish command succeeded. No more tools are needed. Report code, draft_media_id, manifest_json, and resolved theme.</wechat_publish_completed>",
                );
              }
            }
          }

          if (result && !result.isError) {
            if (effectiveToolName === "use_skill") {
              const skillName = String(
                effectiveToolInput.name ?? effectiveToolInput.skillId ?? "",
              ).trim();
              if (skillName === "pptx") {
                pptxSkillLoaded = true;
              }
            }
            for (const pptxPath of extractVerifiedPptxPaths(
              String(result.content ?? ""),
            )) {
              const normalized = rememberVerifiedPptx(pptxPath);
              if (normalized) {
                await autoSendVerifiedPptx(pptxPath);
                runtimeHints.push(
                  `<pptx_verified>${pptxPath.replace(/\\/g, "/")}</pptx_verified>`,
                );
              }
            }
            if (
              (pptxSkillLoaded || isPptxGenerationTask) &&
              ["bash", "claude_code", "file_write"].includes(effectiveToolName)
            ) {
              for (const pptxPath of extractPptxPathMentions(
                String(result.content ?? ""),
              )) {
                const normalized = normalizeComparablePath(
                  pptxPath,
                  context?.workDir,
                );
                if (normalized && !verifiedPptxPaths.has(normalized)) {
                  unverifiedPptxCandidates.add(normalized);
                  const verifierPath = resolveBundledPptxVerifierPath(
                    context?.skillsDir,
                  ).replace(/\\/g, "/");
                  runtimeHints.push(
                    `<pptx_candidate>${pptxPath.replace(/\\/g, "/")}</pptx_candidate><pptx_next_step>Do not answer Done. Run: python "${verifierPath}" "${pptxPath.replace(/\\/g, "/")}" --out-dir "${context?.workDir ?? "."}/previews" --require-text --json ; if ok:true, call send_file for that exact PPTX.</pptx_next_step>`,
                  );
                }
              }
            }
          }

          const toolDurationMs = Date.now() - toolStart;
          // Detect LLM format errors: JSON parse failure or tool not found
          const isFormatError: boolean =
            !!(tc as { _formatError?: boolean })._formatError ||
            !!(
              result?.isError &&
              typeof result.content === "string" &&
              result.content.includes("not found")
            );
          // Detect rate-limit blocks from our dedup/limit guards
          const rateLimited: boolean = !!(
            result?.isError &&
            typeof result.content === "string" &&
            (result.content.includes("limit") ||
              result.content.includes("already called") ||
              result.content.includes("Global tool call"))
          );
          return {
            toolCall: tc,
            effectiveToolName,
            effectiveToolInput,
            result,
            toolDurationMs,
            blockedByPolicy,
            isFormatError,
            rateLimited,
          };
        };

        // Split tool calls into batches: consecutive pure tools → parallel, impure → barrier
        type ToolBatch = { parallel: boolean; calls: typeof toolCalls };
        const batches: ToolBatch[] = [];
        let pureBatch: typeof toolCalls = [];

        for (const tc of toolCalls) {
          const toolDef = this.toolRegistry.get(tc.name);
          if (toolDef?.pure) {
            pureBatch.push(tc);
          } else {
            if (pureBatch.length > 0) {
              batches.push({ parallel: true, calls: pureBatch });
              pureBatch = [];
            }
            batches.push({ parallel: false, calls: [tc] });
          }
        }
        if (pureBatch.length > 0) {
          batches.push({ parallel: true, calls: pureBatch });
        }

        // Execute batches
        let earlyReturn = false;
        const allExecResults: ToolExecResult[] = [];
        for (const batch of batches) {
          if (this.aborted || earlyReturn) break;

          // Emit tool_call events for all tools in this batch
          for (const tc of batch.calls) {
            if (
              tc.name === "claude_code" &&
              (pptxSkillLoaded || isPptxGenerationTask)
            ) {
              tc.input = hardenPptxClaudeCodeInput(
                tc.input,
                context?.workDir,
                context?.skillsDir,
              );
            }
            const eventData: Record<string, unknown> = {
              name: tc.name,
              input: tc.input,
            };
            if ((tc as { intent?: string }).intent) {
              eventData.intent = (tc as { intent?: string }).intent;
            }
            yield this.createEvent("tool_call", eventData);
            trace.steps.push({
              type: "tool_call",
              name: tc.name,
              input: tc.input,
              ...((tc as { intent?: string }).intent
                ? { intent: (tc as { intent?: string }).intent }
                : {}),
            } as TraceStep);
          }

          // Execute: parallel for pure batches (>1), sequential otherwise
          let execResults: ToolExecResult[];
          if (batch.parallel && batch.calls.length > 1) {
            console.log(
              `[agent-loop] Executing ${batch.calls.length} pure tools in parallel: ${batch.calls.map((t) => t.name).join(", ")}`,
            );
            execResults = await Promise.all(
              batch.calls.map((tc) => executeOne(tc)),
            );
          } else {
            execResults = [await executeOne(batch.calls[0])];
          }

          allExecResults.push(...execResults);

          // Process results sequentially (yield events, store turns, handle handoff)
          for (const r of execResults) {
            // Update per-tool failure tracking
            if (!r.blockedByPolicy) {
              const failKey = buildFailKey(
                r.effectiveToolName,
                r.effectiveToolInput,
              );
              if (r.result.isError) {
                toolFailCounts.set(
                  failKey,
                  (toolFailCounts.get(failKey) ?? 0) + 1,
                );
              } else {
                toolFailCounts.delete(failKey);
              }
            }

            if (r.result.autoComplete) hasAutoComplete = true;
            if (r.effectiveToolName === "update_todo") {
              // Capture todo items for auto-progress
              const todoMatch = r.result.content.matchAll(
                /^[-*]\s*\[([ xX])\]\s*(.+)/gm,
              );
              const parsed = [...todoMatch].map((m) => ({
                text: m[2].trim(),
                done: m[1] !== " ",
              }));
              if (parsed.length > 0) {
                todoItems = parsed;
                todoAutoIndex = parsed.filter((i) => i.done).length;
              }
            }

            // Handoff: signal orchestrator to switch agent
            if (r.result.handoffTo) {
              yield this.createEvent("tool_result", {
                name: r.toolCall.name,
                result: r.result,
                durationMs: r.toolDurationMs,
              });
              trace.steps.push({
                type: "tool_result",
                name: r.toolCall.name,
                content: envMap
                  ? obfuscateString(r.result.content, envMap)
                  : r.result.content,
                metadata: r.result.metadata,
                effect: r.result.effect,
                durationMs: r.toolDurationMs,
              } as TraceStep);
              const handoffToolResult: ToolResultContent = {
                type: "tool_result",
                toolUseId: r.toolCall.id,
                content: r.result.content,
                isError: false,
              };
              await this.memoryStore.addTurn(convId, {
                id: generateId(),
                conversationId: convId,
                role: "tool",
                content: JSON.stringify([handoffToolResult]),
                toolResults: JSON.stringify([
                  {
                    toolUseId: r.toolCall.id,
                    ...r.result,
                    durationMs: r.toolDurationMs,
                  },
                ]),
                createdAt: new Date(),
              });
              const hDuration = Date.now() - startTime;
              trace.model = usedModel;
              trace.tokensIn = totalTokensIn;
              trace.tokensOut = totalTokensOut;
              trace.durationMs = hDuration;
              try {
                await persistTrace();
              } catch (e) {
                console.error("[agent-loop] Failed to persist trace:", e);
              }
              yield this.createEvent("handoff", {
                targetAgentId: r.result.handoffTo,
                reason: r.result.content,
                tokensIn: totalTokensIn,
                tokensOut: totalTokensOut,
                toolCallCount: totalToolCalls,
                durationMs: hDuration,
                model: usedModel,
              });
              this.setState("idle");
              return;
            }

            yield this.createEvent("tool_result", {
              name: r.toolCall.name,
              result: r.result,
              durationMs: r.toolDurationMs,
            });

            trace.steps.push({
              type: "tool_result",
              name: r.toolCall.name,
              content: envMap
                ? obfuscateString(r.result.content, envMap)
                : r.result.content,
              isError: r.result.isError,
              metadata: r.result.metadata,
              effect: r.result.effect,
              durationMs: r.toolDurationMs,
            } as TraceStep);

            // Sanitize tool output to remove lone surrogates that break JSON/API calls
            r.result.content = sanitizeString(r.result.content);

            const toolResultContent: ToolResultContent = {
              type: "tool_result",
              toolUseId: r.toolCall.id,
              content: r.result.content,
              isError: r.result.isError,
            };

            const toolTurn: ConversationTurn = {
              id: generateId(),
              conversationId: convId,
              role: "tool",
              content: JSON.stringify([toolResultContent]),
              toolResults: JSON.stringify([
                {
                  toolUseId: r.toolCall.id,
                  ...r.result,
                  durationMs: r.toolDurationMs,
                },
              ]),
              createdAt: new Date(),
            };
            await this.memoryStore.addTurn(convId, toolTurn);

            if (r.result.isError) iterationErrorCount++;
            if (!r.result.isError && r.effectiveToolName === "web_search") {
              successfulWebSearchCalls++;
            }
            if (!r.result.isError && r.effectiveToolName === "web_fetch") {
              successfulWebFetchCalls++;
            }
          }
        }

        const terminalFailure = allExecResults.find(
          (r) => r.result.isError && r.result.metadata?.terminal === true,
        );
        if (terminalFailure) {
          const durationMs = Date.now() - startTime;
          const responseText = terminalFailure.result.content;

          const terminalTurn: ConversationTurn = {
            id: generateId(),
            conversationId: convId,
            role: "assistant",
            content: responseText,
            model: usedModel,
            tokensIn: totalTokensIn,
            tokensOut: totalTokensOut,
            cacheCreationTokens: totalCacheCreationTokens || undefined,
            cacheReadTokens: totalCacheReadTokens || undefined,
            durationMs,
            toolCallCount: totalToolCalls,
            traceId: trace.id,
            createdAt: new Date(),
          };
          await this.memoryStore.addTurn(convId, terminalTurn);

          trace.response = responseText;
          trace.model = usedModel;
          trace.tokensIn = totalTokensIn;
          trace.tokensOut = totalTokensOut;
          trace.cacheCreationTokens = totalCacheCreationTokens || undefined;
          trace.cacheReadTokens = totalCacheReadTokens || undefined;
          trace.durationMs = durationMs;
          trace.error = "terminal_tool_failure";
          try {
            await persistTrace();
          } catch (e) {
            console.error("[agent-loop] Failed to persist trace:", e);
          }

          this.setState("idle");
          const message: Message = {
            id: generateId(),
            role: "assistant",
            content: responseText,
            createdAt: new Date(),
            model: usedModel,
            tokensIn: totalTokensIn,
            tokensOut: totalTokensOut,
            cacheCreationTokens: totalCacheCreationTokens || undefined,
            cacheReadTokens: totalCacheReadTokens || undefined,
            durationMs,
            toolCallCount: totalToolCalls,
          };
          yield this.createEvent("response_complete", { message });
          return;
        }

        // Rollback: if ALL errors this iteration are format errors (JSON parse / tool not found),
        // delete the assistant + tool result turns and retry without wasting an iteration.
        if (
          iterationErrorCount > 0 &&
          iterationErrorCount === toolCalls.length &&
          !earlyReturn &&
          !this.aborted
        ) {
          const allFormatErrors =
            allExecResults.length > 0 &&
            allExecResults.every((r) => r.isFormatError);

          if (
            allFormatErrors &&
            consecutiveRollbacks < MAX_CONSECUTIVE_ROLLBACKS
          ) {
            console.log(
              `[agent-loop] Format error rollback (${consecutiveRollbacks + 1}/${MAX_CONSECUTIVE_ROLLBACKS}): deleting assistant + tool turns, retrying`,
            );
            // Delete assistant turn and all subsequent tool result turns from DB
            if (this.memoryStore.deleteTurnsFrom) {
              await this.memoryStore.deleteTurnsFrom(
                convId,
                assistantTurnCreatedAt.toISOString(),
              );
            }
            // Don't count this iteration
            iterations--;
            this.iterationBudget?.unconsume();
            consecutiveRollbacks++;
            continue;
          }
        }

        // Reset rollback counter on successful iteration (at least one non-error)
        if (iterationErrorCount < toolCalls.length) {
          consecutiveRollbacks = 0;
        }

        const factHint = buildToolFactHint(allExecResults);
        for (const result of allExecResults) {
          if (!result.result.isError) {
            fallbackSnippets.push(
              ...extractFallbackLines(result.result.content),
            );
          }
        }
        if (factHint) {
          runtimeHints.push(factHint);
          if (hasSufficientWeatherFacts(factHint)) {
            sufficientWeatherFactHint = factHint;
          }
        }

        const currentResultContents = allExecResults.map(
          (result) => result.result.content,
        );
        const completionDecision = evaluateCompletionPolicies({
          taskKind: taskToolProfile.kind,
          inputText: inputTextForHeuristics,
          messages,
          sentFiles: allSentFiles,
          fallbackSnippets,
          currentResultContents,
          toolResults: allExecResults,
          successfulWebSearchCalls,
          successfulWebFetchCalls,
          wantsFileDelivery: wantsFileDelivery(inputTextForHeuristics),
        });

        if (completionDecision) {
          for (const artifact of completionDecision.artifacts) {
            if (!context?.sendFile) continue;
            if (artifact.kind === "send_existing_file") {
              await context.sendFile(artifact.path, basename(artifact.path));
              recordDirectSendEffect(artifact.path, artifact.sendEffectSource);
              continue;
            }

            const artifactPath = join(
              ensureSessionTmpDir(),
              artifact.filename,
            ).replace(/\\/g, "/");
            writeFileSync(artifactPath, artifact.content, "utf-8");
            recordDirectWriteEffect(artifactPath, artifact.writeEffectSource);
            await context.sendFile(artifactPath, basename(artifactPath));
            recordDirectSendEffect(artifactPath, artifact.sendEffectSource);
          }
          const deterministicResponseText = completionDecision.text;
          const durationMs = Date.now() - startTime;
          const assistantTurn: ConversationTurn = {
            id: generateId(),
            conversationId: convId,
            role: "assistant",
            content: deterministicResponseText,
            model: usedModel,
            tokensIn: totalTokensIn,
            tokensOut: totalTokensOut,
            cacheCreationTokens: totalCacheCreationTokens || undefined,
            cacheReadTokens: totalCacheReadTokens || undefined,
            durationMs,
            toolCallCount: totalToolCalls,
            traceId: trace.id,
            createdAt: new Date(),
          };
          await this.memoryStore.addTurn(convId, assistantTurn);

          trace.response = deterministicResponseText;
          trace.model = usedModel;
          trace.tokensIn = totalTokensIn;
          trace.tokensOut = totalTokensOut;
          trace.cacheCreationTokens = totalCacheCreationTokens || undefined;
          trace.cacheReadTokens = totalCacheReadTokens || undefined;
          trace.durationMs = durationMs;
          try {
            await persistTrace();
          } catch (e) {
            console.error("[agent-loop] Failed to persist trace:", e);
          }

          const message: Message = {
            id: generateId(),
            role: "assistant",
            content: deterministicResponseText,
            createdAt: new Date(),
            model: usedModel,
            tokensIn: totalTokensIn,
            tokensOut: totalTokensOut,
            cacheCreationTokens: totalCacheCreationTokens || undefined,
            cacheReadTokens: totalCacheReadTokens || undefined,
            durationMs,
            toolCallCount: totalToolCalls,
          };
          const remainingText = responseStream.remainingFor(
            deterministicResponseText,
          );
          if (remainingText) {
            yield this.createEvent("response_chunk", {
              text: remainingText,
            });
          }
          this.setState("idle");
          yield this.createEvent("response_complete", {
            message,
            agentId: context?.agentId,
          });
          return;
        }

        // Fingerprint: first 300 chars of LLM output + tool names called (normalized)
        if (fullText && !escalated) {
          const toolNames = toolCalls
            .map((tc) => tc.name)
            .sort()
            .join(",");
          const fp =
            fullText.replace(/\s+/g, " ").slice(0, 300) + "|" + toolNames;
          recentFingerprints.push(fp);
          // Keep only last STRIKE_THRESHOLD entries
          if (recentFingerprints.length > STRIKE_THRESHOLD) {
            recentFingerprints.shift();
          }
          // Check if all recent fingerprints are similar (>80% char overlap)
          if (recentFingerprints.length === STRIKE_THRESHOLD) {
            const base = recentFingerprints[0];
            const allSimilar = recentFingerprints.every((f) => {
              const minLen = Math.min(f.length, base.length);
              if (minLen === 0) return true;
              let matches = 0;
              for (let ci = 0; ci < minLen; ci++) {
                if (f[ci] === base[ci]) matches++;
              }
              return matches / minLen > 0.8;
            });
            if (allSimilar) {
              escalated = true;
              runtimeHints.push(
                "<escalation>You appear to be stuck in a loop — your last 3 responses were very similar. " +
                  "STOP repeating the same approach. Try a completely different strategy: " +
                  "use different tools, change parameters, or explain to the user what's blocking you.</escalation>",
              );
              console.warn(
                `[agent-loop] Three-strike escalation triggered at iteration ${iterations}`,
              );
            }
          }
        }

        // Drain sentFiles from context into accumulator (dedup by URL)
        if (context?.sentFiles && context.sentFiles.length > 0) {
          for (const f of context.sentFiles) {
            if (isPptxGenerationTask && !/\.pptx$/i.test(f.filename)) {
              continue;
            }
            if (
              isPptxGenerationTask &&
              /\.pptx$/i.test(f.filename) &&
              !verifiedPptxPaths.has(
                normalizeComparablePath(f.filename, sessionTmpDir),
              )
            ) {
              continue;
            }
            if (!allSentFiles.some((e) => e.url === f.url)) {
              allSentFiles.push(f);
            }
          }
          context.sentFiles.length = 0;
        }

        // Auto-progress: advance todo by one item per iteration (not per tool call).
        // One iteration ≈ one logical step, regardless of how many tools were called.
        if (
          todoItems.length > 0 &&
          todoAutoIndex < todoItems.length &&
          allExecResults.some((r) => {
            if (r.result.isError || r.effectiveToolName === "update_todo")
              return false;
            if (r.effectiveToolName === "use_skill") {
              if (firstUseSkillCounted) return false; // Only the first use_skill counts
              firstUseSkillCounted = true;
            }
            return true;
          })
        ) {
          todoItems[todoAutoIndex].done = true;
          todoAutoIndex++;
          if (context?.todoNotify) {
            context.todoNotify([...todoItems]);
          }
        }

        // Auto-complete: skip further LLM calls only when ALL tools in this
        // iteration are auto-send type. If any other tool ran (web_search, bash
        // without auto_send, etc.), the LLM likely has more work to do.
        const allToolsAreAutoSend =
          hasAutoComplete &&
          allExecResults.every(
            (r) =>
              r.result.autoComplete ||
              r.effectiveToolName === "send_file" ||
              r.effectiveToolName === "update_todo",
          );
        const todoComplete =
          todoItems.length === 0 || todoAutoIndex >= todoItems.length;
        const pptxDeliverySatisfied =
          !isPptxGenerationTask ||
          allSentFiles.some((f) => /\.pptx$/i.test(f.filename));
        const pptxVerifierAutoDelivered =
          isPptxGenerationTask &&
          verifiedPptxAutoDelivered &&
          pptxDeliverySatisfied;
        if (
          (allToolsAreAutoSend || pptxVerifierAutoDelivered) &&
          iterationErrorCount === 0 &&
          todoComplete &&
          pptxDeliverySatisfied
        ) {
          const durationMs = Date.now() - startTime;

          // Build response from sent files
          const filesMd =
            pptxOnlySentFileMarkdown(allSentFiles) ??
            markdownForSentFiles(allSentFiles);
          const responseText = filesMd || "Done.";

          // Store assistant turn
          const autoTurn: ConversationTurn = {
            id: generateId(),
            conversationId: convId,
            role: "assistant",
            content: responseText,
            model: usedModel,
            tokensIn: totalTokensIn,
            tokensOut: totalTokensOut,
            cacheCreationTokens: totalCacheCreationTokens || undefined,
            cacheReadTokens: totalCacheReadTokens || undefined,
            durationMs,
            toolCallCount: totalToolCalls,
            traceId: trace.id,
            createdAt: new Date(),
          };
          await this.memoryStore.addTurn(convId, autoTurn);

          // Persist trace
          trace.response = responseText;
          trace.model = usedModel;
          trace.tokensIn = totalTokensIn;
          trace.tokensOut = totalTokensOut;
          trace.cacheCreationTokens = totalCacheCreationTokens || undefined;
          trace.cacheReadTokens = totalCacheReadTokens || undefined;
          trace.durationMs = durationMs;
          try {
            await persistTrace();
          } catch (e) {
            console.error("[agent-loop] Failed to persist trace:", e);
          }

          this.setState("idle");
          const message: Message = {
            id: generateId(),
            role: "assistant",
            content: responseText,
            createdAt: new Date(),
            model: usedModel,
            tokensIn: totalTokensIn,
            tokensOut: totalTokensOut,
            cacheCreationTokens: totalCacheCreationTokens || undefined,
            cacheReadTokens: totalCacheReadTokens || undefined,
            durationMs,
            toolCallCount: totalToolCalls,
          };
          yield this.createEvent("response_complete", { message });
          return;
        }

        // Track consecutive all-error iterations to avoid endless thrashing
        if (iterationErrorCount === toolCalls.length) {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.log(
              `[agent-loop] ${consecutiveErrors} consecutive all-error iterations, stopping early.`,
            );
            break;
          }
        } else {
          consecutiveErrors = 0;
        }

        // Rate-limit pressure: when most tool calls in this iteration were blocked
        // by our guards, inject a hint forcing the model to output instead of
        // wasting another ~90s LLM call trying more tools.
        const rateLimitedCount = allExecResults.filter(
          (r) => r.rateLimited,
        ).length;
        if (rateLimitedCount > 0 && rateLimitedCount >= toolCalls.length / 2) {
          runtimeHints.push(
            "[SYSTEM] Most of your tool calls were blocked because you have exceeded usage limits. " +
              "You MUST respond to the user NOW using the information you have already gathered. " +
              "Do NOT call any more tools. Synthesize your answer immediately.",
          );
        }

        // use_skill is just loading instructions — don't count against iteration budget
        if (
          toolCalls.every((tc) => tc.name === "use_skill") &&
          useSkillRollbacks < 3
        ) {
          iterations--;
          this.iterationBudget?.unconsume();
          useSkillRollbacks++;
        }

        // Loop back for next LLM call with tool results
      }

      // Loop exited — either max iterations, budget exhausted, or user abort
      const durationMs = Date.now() - startTime;
      const wasAborted = this.aborted;

      // Store a final assistant turn with cumulative usage stats.
      // For abort: empty content. For max iterations: generate failure summary via LLM.
      let fallbackContent = "";
      if (lastStreamErrorMessage) {
        fallbackContent = `模型调用失败：${lastStreamErrorMessage}`;
      } else if (!wasAborted) {
        // Try to generate a structured failure summary
        try {
          const toolSummary = trace.steps
            .filter(
              (s) =>
                s.type === "tool_call" ||
                (s.type === "tool_result" &&
                  (s as Record<string, unknown>).isError),
            )
            .slice(-10) // Last 10 entries for context
            .map((s) => {
              if (s.type === "tool_call")
                return `→ ${(s as Record<string, unknown>).name}`;
              return `  ✗ error`;
            })
            .join("\n");
          let summaryText = "";
          for await (const chunk of this.provider.stream({
            messages: [
              {
                id: generateId(),
                role: "user",
                content: `The agent ran for ${iterations} iterations and reached the limit. Last activity:\n${toolSummary}\n\nLast response:\n${(lastFullText || "").slice(0, 500)}\n\nWrite a 2-3 sentence summary: what was accomplished, what remains, and suggest next steps. Be concise. Reply in the same language as the last response.`,
                createdAt: new Date(),
              },
            ],
            model: usedModel,
            maxTokens: 256,
            temperature: 0,
          })) {
            if (chunk.type === "text") summaryText += chunk.text;
          }
          fallbackContent = summaryText || MAX_ITERATIONS_MESSAGE;
        } catch (e) {
          console.error("[agent-loop] Failure summary generation failed:", e);
          fallbackContent = lastFullText || MAX_ITERATIONS_MESSAGE;
        }
      }

      // Persist trace after fallback content is known so UI/debugging shows the
      // real terminal reason instead of masking provider errors as iteration caps.
      trace.model = usedModel;
      trace.tokensIn = totalTokensIn;
      trace.tokensOut = totalTokensOut;
      trace.durationMs = durationMs;
      trace.response = fallbackContent;
      trace.error = wasAborted
        ? "user_aborted"
        : lastStreamErrorMessage
          ? "llm_stream_error"
          : "max_iterations_reached";
      try {
        await persistTrace();
      } catch (e) {
        console.error("[agent-loop] Failed to persist trace:", e);
      }

      const fallbackTurn: ConversationTurn = {
        id: generateId(),
        conversationId: convId,
        role: "assistant",
        content: fallbackContent,
        model: usedModel,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        cacheCreationTokens: totalCacheCreationTokens || undefined,
        cacheReadTokens: totalCacheReadTokens || undefined,
        durationMs,
        toolCallCount: totalToolCalls,
        traceId: trace.id,
        createdAt: new Date(),
      };
      await this.memoryStore.addTurn(convId, fallbackTurn);

      this.setState("idle");
      const message: Message = {
        id: generateId(),
        role: "assistant",
        content: fallbackContent,
        createdAt: new Date(),
        model: usedModel,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        cacheCreationTokens: totalCacheCreationTokens || undefined,
        cacheReadTokens: totalCacheReadTokens || undefined,
        durationMs,
        toolCallCount: totalToolCalls,
      };
      yield this.createEvent("response_complete", { message });
    } finally {
      // Guarantee trace is saved even if the generator is aborted mid-flight
      // (e.g., user clicks stop, WebSocket disconnects, consumer stops pulling).
      // Without this, generator return() skips all code after the yield point.
      if (!tracePersistedInLoop) {
        trace.model = usedModel;
        trace.tokensIn = totalTokensIn;
        trace.tokensOut = totalTokensOut;
        trace.durationMs = Date.now() - startTime;
        trace.error = "generator_aborted";
        try {
          await persistTrace();
          console.log(
            `[agent-loop] Trace ${trace.id} saved on generator abort (${trace.steps.length} steps)`,
          );
        } catch (e) {
          console.error("[agent-loop] Failed to persist trace on abort:", e);
        }
        this.setState("idle");
      }
    }
  }

  stop(): void {
    this.aborted = true;
    this.abortController?.abort();
    this.setState("idle");
  }

  on(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(state: AgentState): void {
    this._state = state;
    this.emit("state_change", { state });
  }

  private emit(type: AgentEventType, data: unknown): void {
    const event = this.createEvent(type, data);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private createEvent(type: AgentEventType, data: unknown): AgentEvent {
    return { type, data, timestamp: new Date() };
  }
}
