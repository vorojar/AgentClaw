import {
  useState,
  useEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type ChatMessage,
  type WSMessage,
  type SkillInfo,
  type AgentInfo,
  getHistory,
  deleteTurnsFrom,
  createSession,
  uploadFile,
  renameSession,
  closeSession,
  updateSession,
  listSkills,
  listAgents,
} from "../api/client";
import { useSessionWebSocket } from "../hooks/useSessionWebSocket";
import { useStreamingState } from "../hooks/useStreamingState";
import { CodeBlock } from "../components/CodeBlock";
import { FileDropZone } from "../components/FileDropZone";
import { useSession } from "../components/SessionContext";
import { useTheme } from "../components/ThemeProvider";
import {
  IconMenu,
  IconPaperclip,
  IconArrowUp,
  IconSquare,
  IconRefresh,
  IconWarning,
  IconCheck,
  IconXCircle,
  IconClock,
  IconChevronRight,
  IconX,
  IconArrowLeft,
  IconExternalLink,
  IconDownload,
  IconMoreHorizontal,
  IconEdit,
  IconTrash,
  IconMic,
  IconSkills,
  IconProjects,
  IconCode,
  IconEye,
  IconCopy,
} from "../components/Icons";
import { formatDuration, formatTimeOnly } from "../utils/format";
import {
  notifyIfHidden,
  requestNotificationPermission,
} from "../utils/notifications";
import { JsonView, darkStyles, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import "./ChatPage.css";

/* ── Types ────────────────────────────────────────── */

interface ToolCallEntry {
  id: number;
  toolName: string;
  toolInput: string;
  toolResult?: string;
  isError?: boolean;
  collapsed: boolean;
  durationMs?: number;
  progressLines?: string[];
}

interface DisplayMessage {
  key: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  model?: string;
  createdAt?: string;
  streaming: boolean;
  toolCalls: ToolCallEntry[];
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  toolCallCount?: number;
}

/* ── Preview Context (allows static mdComponents to open side panel) ── */

interface PreviewFile {
  href: string;
  filename: string;
  downloadHref?: string;
}

const PreviewContext = createContext<(file: PreviewFile) => void>(() => {});

/* ── Helpers ──────────────────────────────────────── */

let msgCounter = 0;
function nextKey(): string {
  return `msg-${++msgCounter}-${Date.now()}`;
}

function chatMessageToDisplay(m: ChatMessage): DisplayMessage {
  const toolCalls: ToolCallEntry[] = [];
  if (m.role === "assistant" && m.toolCalls) {
    try {
      const parsed = JSON.parse(m.toolCalls) as Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
      }>;
      for (const tc of parsed) {
        toolCalls.push({
          id: ++msgCounter,
          toolName: tc.name,
          toolInput: JSON.stringify(tc.input),
          collapsed: true,
        });
      }
    } catch {
      /* ignore */
    }
  }
  return {
    key: nextKey(),
    role: m.role,
    content: m.content,
    model: m.model,
    createdAt: m.createdAt,
    streaming: false,
    toolCalls,
    tokensIn: m.tokensIn,
    tokensOut: m.tokensOut,
    durationMs: m.durationMs,
    toolCallCount: m.toolCallCount,
  };
}

function historyToDisplayMessages(history: ChatMessage[]): DisplayMessage[] {
  const result: DisplayMessage[] = [];
  for (const m of history) {
    if (m.role === "tool") {
      const lastMsg = result[result.length - 1];
      if (
        lastMsg &&
        lastMsg.role === "assistant" &&
        lastMsg.toolCalls.length > 0
      ) {
        try {
          const results = JSON.parse(m.toolResults || m.content) as Array<{
            toolUseId?: string;
            content?: string;
            isError?: boolean;
            durationMs?: number;
          }>;
          for (const tr of results) {
            const tc = lastMsg.toolCalls.find(
              (t) => t.toolResult === undefined,
            );
            if (tc) {
              tc.toolResult = tr.content ?? "";
              tc.isError = tr.isError ?? false;
              tc.durationMs = tr.durationMs;
            }
          }
        } catch {
          /* ignore */
        }
      }
      continue;
    }

    // Merge consecutive tool-only assistant turns into one DisplayMessage
    // so that ToolCallGroup can collapse them together.
    const lastMsg = result[result.length - 1];
    if (
      m.role === "assistant" &&
      m.toolCalls &&
      !m.content?.trim() &&
      lastMsg &&
      lastMsg.role === "assistant" &&
      lastMsg.toolCalls.length > 0 &&
      !lastMsg.content?.trim()
    ) {
      const dm = chatMessageToDisplay(m);
      lastMsg.toolCalls.push(...dm.toolCalls);
      // Accumulate tokens
      if (dm.tokensIn) lastMsg.tokensIn = (lastMsg.tokensIn || 0) + dm.tokensIn;
      if (dm.tokensOut)
        lastMsg.tokensOut = (lastMsg.tokensOut || 0) + dm.tokensOut;
      continue;
    }

    result.push(chatMessageToDisplay(m));
  }
  return result;
}

interface ParsedContent {
  text: string;
  images: Array<{ data: string; mediaType: string }>;
}

function parseMessageContent(content: string): ParsedContent {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.type) {
      const text = parsed
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("");
      const images = parsed
        .filter((b: { type: string }) => b.type === "image")
        .map((b: { data: string; mediaType: string }) => ({
          data: b.data,
          mediaType: b.mediaType,
        }));
      return { text, images };
    }
  } catch {
    /* not JSON */
  }
  return { text: content, images: [] };
}

/** Try to parse JSON, return parsed object or null */
function tryParseJson(s: string): unknown | null {
  const t = s.trimStart();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Parse tool result string — extract content from wrapper arrays */
function parseToolResult(result: string): { json: unknown } | { text: string } {
  const parsed = tryParseJson(result);
  if (parsed === null) return { text: result };
  if (Array.isArray(parsed)) {
    // [{content: "..."}] wrapper → extract text
    const texts = parsed.map((item: Record<string, unknown>) =>
      item.content ? String(item.content) : JSON.stringify(item, null, 2),
    );
    return { text: texts.join("\n") };
  }
  return { json: parsed };
}

function formatUsageStats(msg: DisplayMessage): string | null {
  const parts: string[] = [];
  const total = (msg.tokensIn ?? 0) + (msg.tokensOut ?? 0);
  if (total > 0)
    parts.push(
      `${total.toLocaleString()} tokens (${msg.tokensIn ?? 0}\u2191 ${msg.tokensOut ?? 0}\u2193)`,
    );
  if (msg.durationMs != null) parts.push(formatDuration(msg.durationMs));
  if (msg.toolCallCount) parts.push(`${msg.toolCallCount} tools`);
  return parts.length > 0 ? parts.join(" \u00B7 ") : null;
}

/* ── HTML Preview Card (opens side panel via context) ── */

function HtmlPreviewCard({
  href,
  filename,
  downloadHref,
}: {
  href: string;
  filename: string;
  downloadHref?: string;
}) {
  const { t } = useTranslation();
  const openPreview = useContext(PreviewContext);
  return (
    <div
      className="html-preview-card"
      onClick={() => openPreview({ href, filename, downloadHref })}
    >
      <span className="html-preview-icon">&#9654;</span>
      <span className="html-preview-name">{filename}</span>
      <span className="html-preview-badge">{t("chat.preview")}</span>
    </div>
  );
}

function PreviewPanel({
  file,
  onClose,
}: {
  file: PreviewFile;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { href, filename, downloadHref } = file;
  // Binary files: no source view or copy
  const isBinary =
    /\.(pptx?|xlsx?|xls|pdf|docx?|zip|rar|7z|tar|gz|bz2|exe|dll|so|dylib|png|jpe?g|gif|bmp|webp|ico|svg|mp[34]|wav|ogg|flac|m4a|avi|mov|mkv|webm)$/i.test(
      filename,
    );
  const [needsDevServer, setNeedsDevServer] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [panelWidth, setPanelWidth] = useState(50); // percentage
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const [sourceContent, setSourceContent] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(Date.now());
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Reset state when file changes
  useEffect(() => {
    setIframeLoading(true);
    setNeedsDevServer(false);
    setViewMode("preview");
    setSourceContent("");
  }, [href]);

  // Fetch source content (for source view and copy)
  // For files with a separate downloadHref (e.g. md rendered via /preview/),
  // fetch the original file so "View Source" and "Copy" show raw content.
  // Skip for binary files (pptx, xlsx, pdf, etc.) — source is meaningless.
  const sourceHref = downloadHref || href;
  useEffect(() => {
    if (isBinary) return;
    fetch(sourceHref)
      .then((r) => r.text())
      .then((text) => {
        setSourceContent(text);
        if (/<script\b[^>]*\bsrc=["'](?!https?:\/\/)/.test(text)) {
          setNeedsDevServer(true);
        }
      })
      .catch(() => {});
  }, [sourceHref, isBinary, cacheBuster]);

  const handleCopy = useCallback(() => {
    if (!sourceContent) return;
    navigator.clipboard.writeText(sourceContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [sourceContent]);

  // Drag-to-resize handler
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = panelRef.current?.parentElement;
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const pct = ((rect.right - ev.clientX) / rect.width) * 100;
      // clamp: min 20%, max 70%
      setPanelWidth(Math.min(70, Math.max(20, pct)));
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Re-enable iframe pointer events
      panelRef.current
        ?.querySelector("iframe")
        ?.style.removeProperty("pointer-events");
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    // Disable iframe pointer events during drag to prevent stealing mouse
    panelRef.current
      ?.querySelector("iframe")
      ?.style.setProperty("pointer-events", "none");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const bustHref = `${href}${href.includes("?") ? "&" : "?"}t=${cacheBuster}`;
  const iframeProp = {
    className: "preview-panel-iframe",
    onLoad: () => setIframeLoading(false),
  };

  return (
    <div
      className="preview-panel"
      ref={panelRef}
      style={{ width: `${panelWidth}%` }}
    >
      <div className="resize-handle" onMouseDown={onResizeStart} />
      <div className="preview-panel-toolbar">
        {!isBinary && (
          <>
            <button
              className={`preview-panel-btn ${viewMode === "preview" ? "active" : ""}`}
              onClick={() => setViewMode("preview")}
              title={t("chat.preview", "Preview")}
            >
              <IconEye size={16} />
            </button>
            <button
              className={`preview-panel-btn ${viewMode === "source" ? "active" : ""}`}
              onClick={() => setViewMode("source")}
              title={t("chat.source", "Source")}
            >
              <IconCode size={16} />
            </button>
          </>
        )}
        <span className="preview-panel-title" title={filename}>
          {filename}
        </span>
        <button
          className="preview-panel-btn"
          onClick={() => {
            setCacheBuster(Date.now());
            setIframeLoading(true);
          }}
          title={t("common.refresh", "Refresh")}
        >
          <IconRefresh size={16} />
        </button>
        {!isBinary && (
          <button
            className="preview-panel-btn"
            onClick={handleCopy}
            title={
              copied ? t("common.copied", "Copied!") : t("common.copy", "Copy")
            }
          >
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          </button>
        )}
        {downloadHref && (
          <a
            href={downloadHref}
            download
            className="preview-panel-btn"
            title={t("chat.download")}
          >
            <IconDownload size={16} />
          </a>
        )}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="preview-panel-btn"
          title={t("chat.openNewTab")}
        >
          <IconExternalLink size={16} />
        </a>
        <button
          className="preview-panel-btn"
          onClick={onClose}
          title={t("common.close")}
        >
          <IconX size={16} />
        </button>
      </div>
      <div className="preview-panel-body">
        {viewMode === "source" ? (
          <pre className="preview-panel-source">
            <code>{sourceContent}</code>
          </pre>
        ) : (
          <>
            {iframeLoading && (
              <div className="preview-panel-loading">
                <span className="preview-panel-spinner" />
              </div>
            )}
            {(() => {
              if (needsDevServer) {
                return (
                  <>
                    <iframe
                      src="http://localhost:5173"
                      {...iframeProp}
                      title="Vite dev server preview"
                    />
                    <div className="preview-panel-hint">
                      If blank, run:{" "}
                      <code>
                        cd{" "}
                        {href
                          .replace(/^\/files\//, "data/tmp/")
                          .replace(/\/[^/]+$/, "")}{" "}
                        && npm run dev
                      </code>
                    </div>
                  </>
                );
              }
              const isOfficeDoc = /\.(pptx|docx)$/i.test(filename);
              return (
                <iframe
                  src={bustHref}
                  sandbox={
                    isOfficeDoc ? undefined : "allow-scripts allow-same-origin"
                  }
                  {...iframeProp}
                  title={isOfficeDoc ? "Document preview" : "HTML preview"}
                />
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Stable ReactMarkdown components (avoid re-mount on re-render) ── */

const mdComponents = {
  code: CodeBlock as never,
  img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img
      src={src}
      alt={alt ?? "image"}
      style={{
        maxWidth: "100%",
        maxHeight: "400px",
        borderRadius: "8px",
        marginTop: "8px",
        marginBottom: "8px",
        display: "block",
        cursor: "pointer",
      }}
      onClick={() => src && window.open(src, "_blank")}
      {...props}
    />
  ),
  a: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    if (!href) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    }
    // Video files
    if (/\.(mp4|mkv|webm|mov|avi)$/i.test(href)) {
      return (
        <video
          src={href}
          controls
          preload="metadata"
          className="message-video"
        />
      );
    }
    // Audio files
    if (/\.(mp3|wav|ogg|flac|m4a)$/i.test(href)) {
      return (
        <audio
          src={href}
          controls
          preload="metadata"
          className="message-audio"
        />
      );
    }
    // Previewable files served from /files/
    if (href.startsWith("/files/")) {
      const filename = decodeURIComponent(href.split("/").pop() || "");
      // HTML files: preview directly
      if (/\.html?$/i.test(href)) {
        return <HtmlPreviewCard href={href} filename={filename} />;
      }
      // Markdown / Office documents: route through /preview/ for server rendering
      if (/\.(md|docx|pptx|xlsx|xls|csv)$/i.test(href)) {
        const previewHref = href.replace(/^\/files\//, "/preview/");
        return (
          <HtmlPreviewCard
            href={previewHref}
            filename={filename}
            downloadHref={href}
          />
        );
      }
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
};

/* ── Tool result markdown components (inline code stays inline) ── */

const toolMdComponents = {
  code: ({
    children,
  }: {
    className?: string;
    children?: React.ReactNode;
    [k: string]: unknown;
  }) => {
    // Tool results use simple inline code only — no CodeBlock (no dark theme, no Preview)
    return <code className="code-inline">{children}</code>;
  },
  // Prevent code blocks from rendering as <pre><code> with CodeBlock styling
  pre: ({ children }: { children?: React.ReactNode }) => {
    return <pre className="tool-result-pre">{children}</pre>;
  },
};

function SectionLabel({ label, text }: { label: string; text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="tool-call-section-label">
      {label}
      <button
        className={`tool-section-copy${copied ? " copied" : ""}`}
        onClick={() => {
          navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </div>
  );
}

/* ── ToolCallCard ─────────────────────────────────── */

function toolCallLabel(name: string, input: string): string {
  try {
    const obj = JSON.parse(input);
    if (name === "bash" && obj.command) {
      const cmd = String(obj.command);
      return `bash: ${cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd}`;
    }
    if (name === "use_skill" && obj.name) return `use_skill: ${obj.name}`;
    if (name === "file_read" && obj.path) return `file_read: ${obj.path}`;
    if (name === "file_write" && obj.path) return `file_write: ${obj.path}`;
    if (name === "send_file" && obj.filename)
      return `send_file: ${obj.filename}`;
  } catch {
    /* not JSON */
  }
  return name;
}

/** Tools whose output is always human-readable markdown */
const MARKDOWN_OUTPUT_TOOLS = new Set(["claude_code"]);

function ToolResultContent({
  result,
  toolName,
  isError,
}: {
  result: string;
  toolName: string;
  isError?: boolean;
}) {
  const { theme } = useTheme();
  const jsonStyle = theme === "dark" ? darkStyles : defaultStyles;

  if (isError) {
    return <pre className="tool-call-content tool-result-error">{result}</pre>;
  }
  // Tools that always produce markdown → render it
  if (MARKDOWN_OUTPUT_TOOLS.has(toolName)) {
    const parsed = parseToolResult(result);
    const text = "text" in parsed ? parsed.text : result;
    return (
      <div className="tool-call-content tool-result-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={toolMdComponents}
        >
          {text}
        </ReactMarkdown>
      </div>
    );
  }
  const parsed = parseToolResult(result);
  if ("json" in parsed) {
    return (
      <div className="tool-call-json">
        <JsonView data={parsed.json as object} style={jsonStyle} />
      </div>
    );
  }
  return (
    <pre className="tool-call-content tool-result-success">{parsed.text}</pre>
  );
}

function ToolCallCard({ entry }: { entry: ToolCallEntry }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const rotationRef = useRef(0);
  const { theme } = useTheme();
  const jsonStyle = theme === "dark" ? darkStyles : defaultStyles;
  const label = toolCallLabel(entry.toolName, entry.toolInput);

  const handleToggle = () => {
    rotationRef.current += 90;
    setExpanded(!expanded);
  };

  return (
    <div className="tool-call-card">
      <div className="tool-call-header" onClick={handleToggle}>
        <span className="tool-call-icon">
          {entry.toolResult === undefined ? (
            <IconClock size={14} />
          ) : entry.isError ? (
            <IconXCircle size={14} />
          ) : (
            <IconCheck size={14} />
          )}
        </span>
        <span className="tool-call-name" title={label}>
          {label}
        </span>
        {entry.durationMs !== undefined && (
          <span className="tool-call-duration">
            {formatDuration(entry.durationMs)}
          </span>
        )}
        <span
          className="tool-call-chevron"
          style={{ transform: `rotate(${rotationRef.current}deg)` }}
        >
          <IconChevronRight size={14} />
        </span>
      </div>
      {entry.toolResult === undefined &&
        entry.progressLines &&
        entry.progressLines.length > 0 && (
          <div className="tool-progress-lines">
            {entry.progressLines.map((line, i) => (
              <div key={i} className="tool-progress-line">
                {line}
              </div>
            ))}
          </div>
        )}
      {expanded && (
        <div className="tool-call-body">
          {entry.toolInput && (
            <div className="tool-call-input">
              <SectionLabel label={t("chat.input")} text={entry.toolInput} />
              {(() => {
                const json = tryParseJson(entry.toolInput);
                return json ? (
                  <div className="tool-call-json">
                    <JsonView data={json as object} style={jsonStyle} />
                  </div>
                ) : (
                  <pre className="tool-call-content">{entry.toolInput}</pre>
                );
              })()}
            </div>
          )}
          {entry.toolResult !== undefined && (
            <div className="tool-call-result">
              <SectionLabel
                label={entry.isError ? t("chat.error") : t("chat.output")}
                text={entry.toolResult}
              />
              <ToolResultContent
                result={entry.toolResult}
                toolName={entry.toolName}
                isError={entry.isError}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── SubAgentCard (Mem-style grouped card) ────────── */

interface SubAgentTask {
  goal: string;
  status: "running" | "completed" | "failed" | "killed" | "pending";
  result?: string;
}

function parseSubAgentTasks(entry: ToolCallEntry): SubAgentTask[] | null {
  // Only for subagent spawn_and_wait
  try {
    const input = JSON.parse(entry.toolInput);
    if (input.action !== "spawn_and_wait" || !Array.isArray(input.goals)) return null;

    const goals: string[] = input.goals;
    const tasks: SubAgentTask[] = goals.map((g) => ({
      goal: g,
      status: "pending" as const,
    }));

    // Parse progress from progressLines (each line is JSON)
    if (entry.progressLines) {
      for (const line of entry.progressLines) {
        try {
          const p = JSON.parse(line);
          if (p.subagent && typeof p.index === "number" && tasks[p.index]) {
            tasks[p.index].status = p.status;
            if (p.result) tasks[p.index].result = p.result;
          }
        } catch {
          /* not JSON progress, skip */
        }
      }
    }

    // If tool_result is available, parse final results
    if (entry.toolResult) {
      const blocks = entry.toolResult.split("\n\n");
      for (let i = 0; i < blocks.length && i < tasks.length; i++) {
        const block = blocks[i];
        if (block.startsWith("✓")) {
          tasks[i].status = "completed";
          const lines = block.split("\n");
          tasks[i].result = lines.slice(1).join("\n");
        } else if (block.startsWith("✗")) {
          tasks[i].status = "failed";
          const lines = block.split("\n");
          tasks[i].result = lines.slice(1).join("\n");
        }
      }
    }

    return tasks;
  } catch {
    return null;
  }
}

function SubAgentCard({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const tasks = parseSubAgentTasks(entry)!;
  const done = tasks.filter(
    (t) => t.status === "completed" || t.status === "failed",
  ).length;
  const allDone = entry.toolResult !== undefined;

  return (
    <div className="subagent-card">
      <div className="subagent-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="subagent-card-icon">
          {allDone ? <IconCheck size={14} /> : <IconClock size={14} />}
        </span>
        <span className="subagent-card-title">Subagents</span>
        <span className="subagent-card-count">
          {done} / {tasks.length}
        </span>
        {entry.durationMs !== undefined && (
          <span className="tool-call-duration">{formatDuration(entry.durationMs)}</span>
        )}
        <span className="tool-call-chevron">
          <IconChevronRight size={14} />
        </span>
      </div>
      <div className="subagent-card-tasks">
        {tasks.map((task, i) => (
          <div key={i} className={`subagent-task subagent-task-${task.status}`}>
            <span className="subagent-task-icon">
              {task.status === "completed" ? (
                <IconCheck size={13} />
              ) : task.status === "failed" ? (
                <IconXCircle size={13} />
              ) : task.status === "running" ? (
                <span className="subagent-task-spinner" />
              ) : (
                <span className="subagent-task-pending" />
              )}
            </span>
            <span className="subagent-task-goal">{task.goal}</span>
            {expanded && task.result && (
              <pre className="subagent-task-result">{task.result}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── ToolCallGroup (collapsible) ──────────────────── */

const TOOL_COLLAPSE_THRESHOLD = 3;

function ToolCallGroup({ entries }: { entries: ToolCallEntry[] }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);

  // Split: completed (have result) vs in-progress (no result yet)
  const completed = entries.filter((e) => e.toolResult !== undefined);
  const inProgress = entries.filter((e) => e.toolResult === undefined);
  const allDone = inProgress.length === 0;
  const shouldCollapse = allDone && completed.length >= TOOL_COLLAPSE_THRESHOLD;

  if (!shouldCollapse || !collapsed) {
    return (
      <>
        {shouldCollapse && (
          <div
            className="tool-group-summary"
            onClick={() => setCollapsed(true)}
          >
            <span className="tool-group-collapse-hint">
              ▼ {t("chat.collapse")}
            </span>
          </div>
        )}
        {entries.map((tc) =>
          parseSubAgentTasks(tc) ? (
            <SubAgentCard key={tc.id} entry={tc} />
          ) : (
            <ToolCallCard key={tc.id} entry={tc} />
          ),
        )}
      </>
    );
  }

  // Collapsed summary
  const totalMs = completed.reduce((sum, e) => sum + (e.durationMs || 0), 0);
  const errors = completed.filter((e) => e.isError).length;
  const uniqueTools = [...new Set(completed.map((e) => e.toolName))];
  const toolSummary = uniqueTools
    .map((name) => {
      const count = completed.filter((e) => e.toolName === name).length;
      return count > 1 ? `${name} ×${count}` : name;
    })
    .join(", ");

  return (
    <div className="tool-group-summary" onClick={() => setCollapsed(false)}>
      <span className="tool-group-icon">
        {errors > 0 ? <IconWarning size={14} /> : <IconCheck size={14} />}
      </span>
      <span className="tool-group-text">
        {t("chat.toolCalls", { count: completed.length, summary: toolSummary })}
      </span>
      {totalMs > 0 && (
        <span className="tool-group-duration">{formatDuration(totalMs)}</span>
      )}
      <span className="tool-group-expand">▶</span>
    </div>
  );
}

/* ── PendingFilesList ─────────────────────────────── */

interface PendingFilesListProps {
  files: Array<{ file: File; preview?: string }>;
  onRemove: (index: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

function PendingFilesList({
  files,
  onRemove,
  className,
  style,
}: PendingFilesListProps) {
  if (files.length === 0) return null;
  return (
    <div className={className ?? "pending-files"} style={style}>
      {files.map((pf, i) => (
        <div key={i} className="pending-file-item">
          {pf.preview ? (
            <img
              src={pf.preview}
              alt={pf.file.name}
              className="pending-file-preview"
            />
          ) : (
            <span className="pending-file-name">{pf.file.name}</span>
          )}
          <button className="pending-file-remove" onClick={() => onRemove(i)}>
            <IconX size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── ChatPage ─────────────────────────────────────── */

export function ChatPage() {
  const {
    sessions,
    activeSessionId,
    sidebarOpen,
    setSidebarOpen,
    refreshSessions,
    ensureSession,
    pendingAgentId,
    setPendingAgentId,
    projects,
    setStreamingSessionId,
  } = useSession();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  // wsConnected, wsDisconnected, wsRef — from useSessionWebSocket below
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<
    Array<{ file: File; preview?: string }>
  >([]);
  const [lastUserText, setLastUserText] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [headerSubMenu, setHeaderSubMenu] = useState(false);
  const [editingMsgKey, setEditingMsgKey] = useState<string | null>(null);
  const [editMsgValue, setEditMsgValue] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [todoItems, setTodoItems] = useState<
    Array<{ text: string; done: boolean }>
  >([]);
  const {
    isSending,
    activeToolName,
    streamingSessionRef,
    startStreaming,
    stopStreaming,
    resetLocal: resetStreamingLocal,
    setActiveToolName,
    setIsSending,
  } = useStreamingState({ setStreamingSessionId });

  const sessionIdRef = useRef(activeSessionId);
  sessionIdRef.current = activeSessionId;
  const skillMenuRef = useRef<HTMLDivElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<DisplayMessage[]>(messages);
  const toolCallIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;
  const pendingFilesRef = useRef(pendingFiles);
  pendingFilesRef.current = pendingFiles;

  /* ── Voice input (Web Speech API + MediaRecorder fallback) ─── */
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasSpeechRecognition = !!(
    window.SpeechRecognition || window.webkitSpeechRecognition
  );
  const skipHistoryRef = useRef(false);
  const stoppedRef = useRef(false);
  /** WS 重连回放中：history 加载完后保留 streaming 消息 */
  const resumingRef = useRef(false);
  const sendTimestampRef = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    requestNotificationPermission();
    const PINNED = ["research", "coding", "writing", "web-search", "pdf"];
    listSkills()
      .then((list) => {
        const enabled = list.filter((s) => s.enabled);
        enabled.sort((a, b) => {
          const ai = PINNED.indexOf(a.name);
          const bi = PINNED.indexOf(b.name);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
        setSkills(enabled);
      })
      .catch(() => {});
    listAgents()
      .then((list) => setAgents(list))
      .catch(() => {});
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  /* Load history */
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      // resetStreamingLocal() handled by session-switch effect below
      setLoadingHistory(false);
      // 新建会话时清空 todo
      setTodoItems([]);
      return;
    }
    // Skip loading empty history for sessions just created by ensureSession
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }
    let cancelled = false;
    async function loadHistory() {
      setLoadingHistory(true);
      try {
        const history = await getHistory(activeSessionId!);
        if (cancelled) return;
        const historyMessages = historyToDisplayMessages(history);
        if (resumingRef.current) {
          // WS 回放中：history 放前面，保留当前 streaming 消息在末尾
          // Buffer 回放已包含当前 assistant 轮的完整状态，
          // 去掉 history 末尾的 assistant 消息避免重复
          setMessages((prev) => {
            const streaming = prev.filter((m) => m.streaming);
            let trimmed = historyMessages;
            if (streaming.length > 0) {
              while (
                trimmed.length > 0 &&
                trimmed[trimmed.length - 1].role === "assistant"
              ) {
                trimmed = trimmed.slice(0, -1);
              }
            }
            return [...trimmed, ...streaming];
          });
        } else {
          setMessages(historyMessages);
        }
      } catch (err) {
        console.error("Failed to load history:", err);
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }
    loadHistory();
    // 从 localStorage 恢复 todo 进度
    const savedTodo = localStorage.getItem(`todo:${activeSessionId}`);
    if (savedTodo) {
      try {
        setTodoItems(JSON.parse(savedTodo));
      } catch {
        setTodoItems([]);
      }
    } else {
      setTodoItems([]);
    }
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  useEffect(() => {
    return () => {
      pendingFilesRef.current.forEach((pf) => {
        if (pf.preview) URL.revokeObjectURL(pf.preview);
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* WS message handler */
  const handleWsMessage = useCallback((msg: WSMessage) => {
    // After stop is requested, ignore streaming events until "done" arrives
    if (stoppedRef.current && msg.type !== "done" && msg.type !== "error") {
      return;
    }
    switch (msg.type) {
      case "resuming": {
        // 服务端重连回放：标记回放中，防止 history 加载覆盖 streaming 状态
        resumingRef.current = true;
        startStreaming(sessionIdRef.current);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            return prev.slice(0, -1);
          }
          return prev;
        });
        break;
      }
      case "handoff": {
        // Agent handoff notification
        const handoffNotice = `\u{1F504} **Handoff** \u2192 **${msg.toAgentName || msg.toAgent}**`;
        setMessages((prev) => {
          const cleaned = prev.map((m) =>
            m.streaming ? { ...m, streaming: false } : m,
          );
          return [
            ...cleaned,
            {
              key: nextKey(),
              role: "system" as const,
              content: handoffNotice,
              createdAt: new Date().toISOString(),
            },
          ];
        });
        break;
      }
      case "text": {
        setActiveToolName(null);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + (msg.text ?? "") },
            ];
          }
          return [
            ...prev,
            {
              key: nextKey(),
              role: "assistant",
              content: msg.text ?? "",
              streaming: true,
              toolCalls: [],
            },
          ];
        });
        break;
      }
      case "tool_call": {
        const tcId = ++toolCallIdRef.current;
        const entry: ToolCallEntry = {
          id: tcId,
          toolName: msg.toolName ?? "unknown",
          toolInput: msg.toolInput ?? "",
          collapsed: true,
        };
        setActiveToolName(msg.toolName ?? null);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            return [
              ...prev.slice(0, -1),
              { ...last, toolCalls: [...last.toolCalls, entry] },
            ];
          }
          return [
            ...prev,
            {
              key: nextKey(),
              role: "assistant",
              content: "",
              streaming: true,
              toolCalls: [entry],
            },
          ];
        });
        break;
      }
      case "tool_result": {
        setActiveToolName(null);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.toolCalls.length > 0) {
            const toolCalls = [...last.toolCalls];
            for (let i = toolCalls.length - 1; i >= 0; i--) {
              if (toolCalls[i].toolResult === undefined) {
                toolCalls[i] = {
                  ...toolCalls[i],
                  toolResult: msg.toolResult ?? "",
                  isError: false,
                  durationMs: msg.durationMs ?? undefined,
                };
                break;
              }
            }
            return [...prev.slice(0, -1), { ...last, toolCalls }];
          }
          return prev;
        });
        break;
      }
      case "tool_progress": {
        const progressText = msg.text ?? "";
        if (!progressText) break;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.toolCalls.length > 0) {
            const toolCalls = [...last.toolCalls];
            // Append to the last unfinished tool call
            for (let i = toolCalls.length - 1; i >= 0; i--) {
              if (toolCalls[i].toolResult === undefined) {
                const lines = [
                  ...(toolCalls[i].progressLines ?? []),
                  progressText,
                ];
                // Keep last 20 lines to avoid memory bloat
                toolCalls[i] = {
                  ...toolCalls[i],
                  progressLines: lines.slice(-20),
                };
                break;
              }
            }
            return [...prev.slice(0, -1), { ...last, toolCalls }];
          }
          return prev;
        });
        break;
      }
      case "file": {
        const fileUrl = msg.url ?? "";
        const fileName = msg.filename ?? "file";
        const isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(fileName);
        const fileContent = isImage
          ? `![${fileName}](${fileUrl})`
          : `[${fileName}](${fileUrl})`;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          // Deduplicate: skip if this URL is already in the current assistant message
          if (
            last &&
            last.role === "assistant" &&
            last.content?.includes(fileUrl)
          ) {
            return prev;
          }
          if (last && last.role === "assistant" && last.streaming) {
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content: last.content
                  ? last.content + "\n" + fileContent
                  : fileContent,
              },
            ];
          }
          return [
            ...prev,
            {
              key: nextKey(),
              role: "assistant",
              content: fileContent,
              streaming: true,
              toolCalls: [],
            },
          ];
        });
        break;
      }
      case "todo_update": {
        const items = (
          msg as unknown as { items: Array<{ text: string; done: boolean }> }
        ).items;
        if (Array.isArray(items)) {
          setTodoItems(items);
          // 持久化到 localStorage，切换会话时可恢复
          const sid = sessionIdRef.current;
          if (sid) {
            localStorage.setItem(`todo:${sid}`, JSON.stringify(items));
          }
        }
        break;
      }
      case "done": {
        stoppedRef.current = false;
        resumingRef.current = false;
        setActiveToolName(null);
        const elapsed = sendTimestampRef.current
          ? Date.now() - sendTimestampRef.current
          : undefined;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            let content = last.content;
            const seen = new Set<string>();
            content = content.replace(
              /!?\[([^\]]*)\]\(([^)]*)\)/g,
              (match, _alt: string, url: string) => {
                if (seen.has(url)) return "";
                seen.add(url);
                return match;
              },
            );
            content = content.replace(/\n{3,}/g, "\n\n").trim();
            if (content) notifyIfHidden("AgentClaw", content);
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content,
                streaming: false,
                model: msg.model ?? last.model,
                tokensIn: msg.tokensIn ?? last.tokensIn,
                tokensOut: msg.tokensOut ?? last.tokensOut,
                durationMs: elapsed ?? msg.durationMs ?? last.durationMs,
                toolCallCount: msg.toolCallCount ?? last.toolCallCount,
              },
            ];
          }
          return prev;
        });
        stopStreaming();
        refreshSessions();
        break;
      }
      case "prompt": {
        const q = msg.question ?? "";
        setPendingPrompt(q);
        // Show question as assistant message
        setMessages((prev) => [
          ...prev,
          {
            key: nextKey(),
            role: "assistant",
            content: q,
            createdAt: new Date().toISOString(),
            streaming: false,
            toolCalls: [],
          },
        ]);
        break;
      }
      case "broadcast": {
        const broadcastText = msg.text ?? "";
        if (!broadcastText) break;
        // Toast notification (visible on any page)
        const w = window as unknown as {
          toast?: { info: (title: string, desc?: string) => void };
        };
        if (w.toast) {
          w.toast.info("AgentClaw", broadcastText);
        }
        new Audio("/tada.wav").play().catch(() => {});
        // Browser notification (always, even if page is visible)
        if (Notification.permission === "granted") {
          new Notification("AgentClaw", {
            body: broadcastText.slice(0, 100),
            icon: "/favicon.ico",
            tag: "agentclaw-broadcast",
          });
        }
        break;
      }
      case "session_activity": {
        // Another channel (Telegram/WhatsApp) updated a session — refresh list
        refreshSessions();
        break;
      }
      case "error": {
        if (msg.error?.includes("Session not found")) {
          createSession()
            .then((ns) => {
              // session will be refreshed via context
            })
            .catch(() => {});
          return;
        }
        const errMsg: DisplayMessage = {
          key: nextKey(),
          role: "system",
          content: msg.error ?? "An unknown error occurred.",
          streaming: false,
          toolCalls: [],
        };
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            return [
              ...prev.slice(0, -1),
              { ...last, streaming: false },
              errMsg,
            ];
          }
          return [...prev, errMsg];
        });
        resetStreamingLocal();
        break;
      }
    }
  }, []);

  /* WS connection lifecycle (extracted hook) */
  const {
    wsRef,
    wsConnected,
    wsDisconnected,
    setPendingSend,
    reconnect: connectWs,
  } = useSessionWebSocket({
    sessionId: activeSessionId,
    onMessage: handleWsMessage,
    onStaleStreaming: stopStreaming,
    resumingRef,
    streamingSessionRef,
  });

  /* Reset streaming state on session switch (hook handles WS lifecycle) */
  useEffect(() => {
    resetStreamingLocal();
  }, [activeSessionId, resetStreamingLocal]);

  /* Clear active tool on WS disconnect */
  useEffect(() => {
    if (wsDisconnected) setActiveToolName(null);
  }, [wsDisconnected, setActiveToolName]);

  /* Send */
  const handleSend = useCallback(async () => {
    const text = inputValue.trim();

    // Reply to ask_user prompt
    if (pendingPrompt && text && wsRef.current) {
      wsRef.current.promptReply(text);
      setInputValue("");
      setPendingPrompt(null);
      // Show user reply as a message
      setMessages((prev) => [
        ...prev,
        {
          key: nextKey(),
          role: "user",
          content: text,
          createdAt: new Date().toISOString(),
          streaming: false,
          toolCalls: [],
        },
      ]);
      return;
    }

    if ((!text && pendingFiles.length === 0) || isSending) return;

    let contentToSend = text;
    const imageUrls: string[] = [];
    const fileLinks: string[] = [];

    if (pendingFiles.length > 0) {
      for (const pf of pendingFiles) {
        try {
          const result = await uploadFile(pf.file);
          if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(pf.file.name)) {
            imageUrls.push(result.url);
          } else {
            fileLinks.push(`[${pf.file.name}](${result.url})`);
          }
          contentToSend += `\n[Uploaded: ${pf.file.name}](${result.url})`;
        } catch (err) {
          console.error("Upload failed:", err);
        }
      }
      setPendingFiles([]);
    }

    let displayContent = text;
    for (const url of imageUrls) displayContent += `\n![](${url})`;
    if (fileLinks.length > 0) displayContent += `\n${fileLinks.join("\n")}`;

    const userMsg: DisplayMessage = {
      key: nextKey(),
      role: "user",
      content: displayContent || contentToSend,
      createdAt: new Date().toISOString(),
      streaming: false,
      toolCalls: [],
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setLastUserText(contentToSend);
    sendTimestampRef.current = Date.now();
    startStreaming(activeSessionId);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const skillToSend = selectedSkill || undefined;
    setSelectedSkill(null);

    if (wsRef.current) {
      wsRef.current.send(contentToSend, skillToSend);
    } else {
      // No WS — store message, create/reconnect session; onOpen will send it
      setPendingSend(contentToSend, skillToSend);
      if (!activeSessionId) {
        skipHistoryRef.current = true;
        await ensureSession();
      } else {
        connectWs();
      }
    }
  }, [
    inputValue,
    isSending,
    pendingFiles,
    selectedSkill,
    ensureSession,
    activeSessionId,
    connectWs,
    setPendingSend,
    startStreaming,
  ]);

  const handleStop = useCallback(() => {
    if (!wsRef.current) return;
    stoppedRef.current = true;
    wsRef.current.stop();
    resetStreamingLocal();
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.streaming)
        return [...prev.slice(0, -1), { ...last, streaming: false }];
      return prev;
    });
  }, []);

  const handleRegenerate = useCallback(() => {
    if (isSending || !wsRef.current || !lastUserText) return;
    setMessages((prev) => {
      const idx = prev.length - 1;
      if (idx >= 0 && prev[idx].role === "assistant") return prev.slice(0, idx);
      return prev;
    });
    sendTimestampRef.current = Date.now();
    setIsSending(true);
    wsRef.current.send(lastUserText);
  }, [isSending, lastUserText]);

  const handleEditSubmit = useCallback(
    async (msgKey: string) => {
      const text = editMsgValue.trim();
      if (!text || isSending || !wsRef.current || !activeSessionId) return;

      // Find the message to edit — its createdAt marks the truncation point
      const targetMsg = messages.find((m) => m.key === msgKey);
      if (!targetMsg?.createdAt) return;

      setEditingMsgKey(null);
      setEditMsgValue("");

      // Check if editing the first user message — need to update session title
      const isFirstUserMsg =
        messages.findIndex((m) => m.role === "user") ===
        messages.findIndex((m) => m.key === msgKey);

      // Truncate backend history from this message onwards
      try {
        await deleteTurnsFrom(activeSessionId, targetMsg.createdAt);
      } catch (err) {
        console.error("Failed to truncate history:", err);
      }

      // Update session title if editing the first user message
      if (isFirstUserMsg) {
        const newTitle = text.slice(0, 50).trim() || "New Chat";
        updateSession(activeSessionId, { title: newTitle })
          .then(() => refreshSessions())
          .catch(() => {});
      }

      // Truncate frontend messages
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.key === msgKey);
        if (idx < 0) return prev;
        return prev.slice(0, idx);
      });

      // Add new user message and send
      const userMsg: DisplayMessage = {
        key: nextKey(),
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
        streaming: false,
        toolCalls: [],
      };
      setMessages((prev) => [...prev, userMsg]);
      setLastUserText(text);
      sendTimestampRef.current = Date.now();
      setIsSending(true);
      wsRef.current!.send(text);
    },
    [editMsgValue, isSending, activeSessionId, messages, refreshSessions],
  );

  const handleFiles = useCallback((files: File[]) => {
    const newFiles = files.map((file) => {
      const preview = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined;
      return { file, preview };
    });
    setPendingFiles((prev) => [...prev, ...newFiles]);
  }, []);

  /* Voice input toggle — SpeechRecognition (desktop) or MediaRecorder fallback (mobile) */
  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordingTime(0);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      mediaChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) mediaChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        const blob = new Blob(mediaChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size > 0) {
          const ext = (recorder.mimeType || "").includes("mp4")
            ? "m4a"
            : "webm";
          const file = new File([blob], `voice-${Date.now()}.${ext}`, {
            type: blob.type,
          });
          handleFiles([file]);
        }
        setIsRecording(false);
        setRecordingTime(0);
      };

      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        setRecordingTime(0);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);
    } catch {
      console.error("Microphone access denied");
    }
  }, [handleFiles]);

  const toggleVoice = useCallback(() => {
    if (!hasSpeechRecognition) {
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setIsListening(false);
      return;
    }

    const rec = new SR();
    rec.lang = navigator.language;
    rec.interimResults = true;
    rec.continuous = true;

    const base = inputValueRef.current;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let finals = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finals += e.results[i][0].transcript;
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      setInputValue((base ? base + " " : "") + finals + interim);
    };

    rec.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };

    rec.onerror = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };

    recognitionRef.current = rec;
    setIsListening(true);
    rec.start();
  }, [hasSpeechRecognition, isRecording, stopRecording, startRecording]);

  const removePendingFile = useCallback((index: number) => {
    setPendingFiles((prev) => {
      const removed = prev[index];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const isTouchDevice = useRef(
    typeof matchMedia !== "undefined" &&
      matchMedia("(pointer: coarse)").matches,
  );
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleFiles(imageFiles);
      }
    },
    [handleFiles],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Mobile: Enter = newline (send via button). Desktop: Enter = send.
      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        !e.nativeEvent.isComposing &&
        !isTouchDevice.current
      ) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
      const ta = e.target;
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    },
    [],
  );

  // Close header menu and skill menu on outside click
  useEffect(() => {
    if (!headerMenuOpen && !skillMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        headerMenuOpen &&
        headerMenuRef.current &&
        !headerMenuRef.current.contains(target)
      ) {
        setHeaderMenuOpen(false);
        setHeaderSubMenu(false);
      }
      if (
        skillMenuOpen &&
        skillMenuRef.current &&
        !skillMenuRef.current.contains(target)
      ) {
        setSkillMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [headerMenuOpen, skillMenuOpen]);

  const handleMoveToProject = useCallback(
    async (projectId: string) => {
      if (!activeSessionId) return;
      try {
        await updateSession(activeSessionId, { projectId });
        refreshSessions();
      } catch (err) {
        console.error("Failed to move session:", err);
      }
      setHeaderMenuOpen(false);
      setHeaderSubMenu(false);
    },
    [activeSessionId, refreshSessions],
  );

  const handleHeaderRename = useCallback(() => {
    setHeaderMenuOpen(false);
    const s = sessions.find((s) => s.id === activeSessionId);
    setEditTitleValue(s?.title || "");
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }, [sessions, activeSessionId]);

  const handleHeaderDelete = useCallback(async () => {
    setHeaderMenuOpen(false);
    if (!activeSessionId) return;
    try {
      await closeSession(activeSessionId);
      refreshSessions();
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  }, [activeSessionId, refreshSessions]);

  const handleReconnect = useCallback(() => {
    connectWs();
  }, [connectWs]);

  /* Render */
  function getInputPlaceholder(): string {
    if (pendingPrompt) return pendingPrompt;
    if (isListening) return t("chat.listeningPlaceholder");
    if (isRecording) return t("chat.recordingPlaceholder");
    if (isSending) return t("chat.waitingPlaceholder");
    return t("chat.replyPlaceholder");
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeProject = activeSession?.projectId
    ? projects.find((p) => p.id === activeSession.projectId)
    : null;
  const isNewChat = messages.length === 0 && !loadingHistory;
  const canSend =
    (inputValue.trim().length > 0 || pendingFiles.length > 0) && !isSending;
  const showRegenerate =
    !isSending &&
    lastUserText &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "assistant" &&
    !messages[messages.length - 1].streaming;

  return (
    <PreviewContext.Provider value={setPreviewFile}>
      <FileDropZone onFiles={handleFiles} disabled={isSending}>
        <div className={`chat-page${previewFile ? " has-preview" : ""}`}>
          {/* Header */}
          <div className="chat-header">
            {!sidebarOpen && (
              <button
                className="btn-icon"
                onClick={() => setSidebarOpen(true)}
                title={t("sidebar.show")}
              >
                <IconMenu size={18} />
              </button>
            )}
            {editingTitle ? (
              <input
                ref={titleInputRef}
                className="chat-header-title-input"
                value={editTitleValue}
                onChange={(e) => setEditTitleValue(e.target.value)}
                onBlur={() => {
                  const trimmed = editTitleValue.trim();
                  setEditingTitle(false);
                  if (
                    trimmed &&
                    activeSessionId &&
                    trimmed !== activeSession?.title
                  ) {
                    renameSession(activeSessionId, trimmed)
                      .then(() => refreshSessions())
                      .catch((err) => console.error("Failed to rename:", err));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
              />
            ) : (
              <span
                className="chat-header-title"
                onDoubleClick={() => {
                  setEditTitleValue(activeSession?.title || "");
                  setEditingTitle(true);
                  setTimeout(() => titleInputRef.current?.select(), 0);
                }}
                title={t("chat.doubleClickRename")}
              >
                {activeProject && (
                  <span
                    className="chat-header-project"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/projects/${activeProject.id}`);
                    }}
                  >
                    {activeProject.name}
                    <span className="chat-header-sep">/</span>
                  </span>
                )}
                {activeSession?.title || "AgentClaw"}
              </span>
            )}
            <div className="chat-header-actions" ref={headerMenuRef}>
              {!isNewChat && (
                <button
                  className="btn-icon"
                  onClick={() => setHeaderMenuOpen((v) => !v)}
                  title={t("common.more")}
                >
                  <IconMoreHorizontal size={18} />
                </button>
              )}
              {headerMenuOpen && (
                <div className="header-dropdown">
                  <button onClick={handleHeaderRename}>
                    <IconEdit size={14} /> {t("common.rename")}
                  </button>
                  {projects.length > 0 && (
                    <div
                      className="header-dropdown-sub"
                      onMouseEnter={() => setHeaderSubMenu(true)}
                      onMouseLeave={() => setHeaderSubMenu(false)}
                      onClick={() => setHeaderSubMenu((v) => !v)}
                    >
                      <span className="header-dropdown-item">
                        <IconProjects size={14} /> {t("sidebar.moveToProject")}
                        <span className="header-dropdown-arrow">›</span>
                      </span>
                      {headerSubMenu && (
                        <div className="header-dropdown-submenu">
                          {projects.map((p) => (
                            <button
                              key={p.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMoveToProject(p.id);
                              }}
                            >
                              <IconProjects size={14} /> {p.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    className="header-dropdown-danger"
                    onClick={handleHeaderDelete}
                    disabled={!activeSessionId}
                  >
                    <IconTrash size={14} /> {t("common.delete")}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Disconnected banner */}
          {wsDisconnected && (
            <div className="connection-banner">
              <span>{t("chat.connectionLost")}</span>
              <button onClick={handleReconnect}>{t("chat.reconnect")}</button>
            </div>
          )}

          {/* Tool execution status */}
          {activeToolName && (
            <div className="tool-status-bar">
              <span className="tool-status-spinner" />
              <span>{t("chat.runningTool", { tool: activeToolName })}</span>
            </div>
          )}

          {/* Todo progress card */}
          {todoItems.length > 0 && (
            <div className="todo-progress-card">
              <div className="todo-progress-header">
                <span className="todo-progress-label">
                  {t("chat.progress")}
                </span>
                <span className="todo-progress-count">
                  {todoItems.filter((i) => i.done).length}/{todoItems.length}
                </span>
              </div>
              <div className="todo-progress-bar">
                <div
                  className="todo-progress-fill"
                  style={{
                    width: `${(todoItems.filter((i) => i.done).length / todoItems.length) * 100}%`,
                  }}
                />
              </div>
              <ul className="todo-progress-list">
                {todoItems.map((item, i) => (
                  <li key={i} className={item.done ? "done" : ""}>
                    <span className="todo-check">
                      {item.done ? "\u2713" : "\u25CB"}
                    </span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Body: chat main + optional preview panel */}
          <div className="chat-body">
            <div className="chat-main">
              {/* Messages */}
              {messages.length === 0 && !loadingHistory ? (
                <div className="chat-welcome">
                  {agents.length > 1 && (
                    <div className="agent-selector">
                      {agents.map((a) => (
                        <button
                          key={a.id}
                          className={`agent-chip${pendingAgentId === a.id ? " active" : ""}`}
                          onClick={() => setPendingAgentId(a.id)}
                          title={a.description || a.name}
                        >
                          {a.avatar && (
                            <span className="agent-avatar">{a.avatar}</span>
                          )}
                          <span>{a.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <h2 className="chat-welcome-title">
                    {t("chat.welcomeTitle")}
                  </h2>
                  <div className="chat-welcome-input">
                    <div className="chat-input-box">
                      <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        placeholder={t("chat.askPlaceholder")}
                        disabled={isSending}
                        rows={2}
                      />
                      <div className="chat-input-actions">
                        <div className="chat-input-actions-left">
                          <button
                            className="btn-attach"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isSending}
                            title={t("chat.attachFile")}
                          >
                            <IconPaperclip size={18} />
                          </button>
                          {skills.length > 0 && (
                            <div
                              className="skill-menu-anchor"
                              ref={skillMenuRef}
                            >
                              <button
                                className={`btn-skill${selectedSkill ? " active" : ""}`}
                                onClick={() => setSkillMenuOpen((v) => !v)}
                                disabled={isSending}
                                title={t("chat.selectSkill")}
                              >
                                <IconSkills size={18} />
                              </button>
                              {skillMenuOpen && (
                                <div className="skill-popup">
                                  {skills.slice(0, 5).map((s) => (
                                    <button
                                      key={s.id}
                                      className={`skill-popup-item${selectedSkill === s.name ? " active" : ""}`}
                                      onClick={() => {
                                        setSelectedSkill((prev) =>
                                          prev === s.name ? null : s.name,
                                        );
                                        setSkillMenuOpen(false);
                                      }}
                                      title={s.description}
                                    >
                                      {s.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {selectedSkill && (
                            <span className="skill-selected-inline">
                              {selectedSkill}
                              <button
                                className="skill-selected-clear"
                                onClick={() => setSelectedSkill(null)}
                              >
                                <IconX size={12} />
                              </button>
                            </span>
                          )}
                        </div>
                        <div className="chat-input-actions-right">
                          {isRecording && (
                            <span className="recording-time">
                              {Math.floor(recordingTime / 60)}:
                              {String(recordingTime % 60).padStart(2, "0")}
                            </span>
                          )}
                          <button
                            className={`btn-voice${isListening || isRecording ? " listening" : ""}`}
                            onClick={toggleVoice}
                            disabled={isSending}
                            title={
                              isListening || isRecording
                                ? t("chat.stopVoice")
                                : t("chat.voiceInput")
                            }
                          >
                            <IconMic size={18} />
                          </button>
                          <button
                            className="btn-send"
                            onClick={handleSend}
                            disabled={!canSend}
                            title={t("chat.sendMessage")}
                          >
                            <IconArrowUp size={18} />
                          </button>
                        </div>
                      </div>
                    </div>
                    <PendingFilesList
                      files={pendingFiles}
                      onRemove={removePendingFile}
                      style={{ marginTop: 8, padding: 0 }}
                    />
                  </div>
                  <div className="chat-welcome-skills">
                    {[
                      { label: t("chat.imageGen"), skill: "comfyui" },
                      { label: t("chat.code"), skill: "coding" },
                      { label: t("chat.excel"), skill: "xlsx" },
                      { label: "PDF", skill: "pdf" },
                      { label: t("chat.webSearch"), skill: "web-search" },
                    ].map((item) => (
                      <button
                        key={item.skill}
                        className={`welcome-skill-chip${selectedSkill === item.skill ? " active" : ""}`}
                        onClick={() =>
                          setSelectedSkill((prev) =>
                            prev === item.skill ? null : item.skill,
                          )
                        }
                      >
                        {item.label}
                      </button>
                    ))}
                    <button
                      className="welcome-skill-chip"
                      onClick={() => navigate("/skills")}
                    >
                      {t("common.more")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="messages-container">
                  <div className="messages-list">
                    {messages.map((m, idx) => (
                      <div key={m.key} data-msg-key={m.key}>
                        {m.role === "system" && m.content ? (
                          m.content.startsWith("\u{1F504}") ? (
                            <div className="message-handoff">
                              <ReactMarkdown>{m.content}</ReactMarkdown>
                            </div>
                          ) : (
                            <div className="message-error">
                              <span className="message-error-icon">
                                <IconWarning size={16} />
                              </span>
                              <span>{m.content}</span>
                            </div>
                          )
                        ) : (
                          <>
                            {(() => {
                              const visible = m.toolCalls.filter(
                                (tc) =>
                                  tc.toolName !== "send_file" &&
                                  tc.toolName !== "update_todo",
                              );
                              return visible.length > 0 ? (
                                <ToolCallGroup entries={visible} />
                              ) : null;
                            })()}
                            {m.content &&
                              (() => {
                                const parsed = parseMessageContent(m.content);

                                /* Inline editing mode for user messages */
                                if (
                                  m.role === "user" &&
                                  editingMsgKey === m.key
                                ) {
                                  return (
                                    <div className="message-row user">
                                      <div className="message-bubble editing">
                                        <textarea
                                          className="edit-msg-textarea"
                                          value={editMsgValue}
                                          onChange={(e) =>
                                            setEditMsgValue(e.target.value)
                                          }
                                          autoFocus
                                          rows={3}
                                          onKeyDown={(e) => {
                                            if (e.key === "Escape") {
                                              setEditingMsgKey(null);
                                            } else if (
                                              e.key === "Enter" &&
                                              !e.shiftKey
                                            ) {
                                              e.preventDefault();
                                              handleEditSubmit(m.key);
                                            }
                                          }}
                                        />
                                        <div className="edit-msg-actions">
                                          <button
                                            className="btn-edit-cancel"
                                            onClick={() =>
                                              setEditingMsgKey(null)
                                            }
                                          >
                                            {t("common.cancel")}
                                          </button>
                                          <button
                                            className="btn-edit-submit"
                                            onClick={() =>
                                              handleEditSubmit(m.key)
                                            }
                                            disabled={!editMsgValue.trim()}
                                          >
                                            {t("common.send")}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <div className={`message-row ${m.role}`}>
                                    <div className="message-bubble">
                                      {parsed.images.map((img, i) => (
                                        <img
                                          key={i}
                                          src={`data:${img.mediaType};base64,${img.data}`}
                                          alt="user image"
                                          style={{
                                            maxWidth: "100%",
                                            maxHeight: "300px",
                                            borderRadius: "8px",
                                            marginBottom: parsed.text
                                              ? "8px"
                                              : 0,
                                            display: "block",
                                          }}
                                        />
                                      ))}
                                      <div className="message-content-md">
                                        <ReactMarkdown
                                          remarkPlugins={[remarkGfm]}
                                          components={mdComponents}
                                        >
                                          {parsed.text}
                                        </ReactMarkdown>
                                        {m.streaming &&
                                          m.toolCalls.length === 0 && (
                                            <span className="streaming-cursor" />
                                          )}
                                      </div>
                                      {(m.createdAt ||
                                        (m.role === "assistant" &&
                                          !m.streaming)) && (
                                        <div className="message-meta">
                                          {formatTimeOnly(m.createdAt)}
                                          {(() => {
                                            const usage =
                                              m.role === "assistant"
                                                ? formatUsageStats(m)
                                                : null;
                                            if (usage)
                                              return ` \u00b7 ${usage}`;
                                            if (m.model)
                                              return ` \u00b7 ${m.model}`;
                                            return "";
                                          })()}
                                        </div>
                                      )}
                                      {m.role === "user" && !isSending && (
                                        <button
                                          className="btn-edit-msg"
                                          onClick={() => {
                                            setEditingMsgKey(m.key);
                                            setEditMsgValue(parsed.text);
                                          }}
                                          title={t("chat.editResend")}
                                        >
                                          <IconEdit size={14} />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                            {showRegenerate &&
                              idx === messages.length - 1 &&
                              m.role === "assistant" && (
                                <div className="regenerate-row">
                                  <button
                                    className="btn-regenerate"
                                    onClick={handleRegenerate}
                                  >
                                    <IconRefresh size={14} />{" "}
                                    {t("chat.regenerate")}
                                  </button>
                                </div>
                              )}
                          </>
                        )}
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                </div>
              )}

              {/* Hidden file input (always rendered so ref works in both layouts) */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files) {
                    handleFiles(Array.from(e.target.files));
                    e.target.value = "";
                  }
                }}
              />

              {/* Pending file previews (only in chat mode, welcome has its own) */}
              {!isNewChat && (
                <PendingFilesList
                  files={pendingFiles}
                  onRemove={removePendingFile}
                />
              )}

              {/* Input Area — hidden on welcome screen */}
              {!isNewChat && (
                <div className="chat-input-area">
                  <div className="chat-input-box">
                    <textarea
                      ref={textareaRef}
                      value={inputValue}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      placeholder={getInputPlaceholder()}
                      disabled={isSending && !pendingPrompt}
                      rows={2}
                    />
                    <div className="chat-input-actions">
                      <div className="chat-input-actions-left">
                        <button
                          className="btn-attach"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isSending}
                          title={t("chat.attachFile")}
                        >
                          <IconPaperclip size={18} />
                        </button>
                        {skills.length > 0 && (
                          <div className="skill-menu-anchor" ref={skillMenuRef}>
                            <button
                              className={`btn-skill${selectedSkill ? " active" : ""}`}
                              onClick={() => setSkillMenuOpen((v) => !v)}
                              disabled={isSending}
                              title={t("chat.selectSkill")}
                            >
                              <IconSkills size={18} />
                            </button>
                            {skillMenuOpen && (
                              <div className="skill-popup">
                                {skills.slice(0, 5).map((s) => (
                                  <button
                                    key={s.id}
                                    className={`skill-popup-item${selectedSkill === s.name ? " active" : ""}`}
                                    onClick={() => {
                                      setSelectedSkill((prev) =>
                                        prev === s.name ? null : s.name,
                                      );
                                      setSkillMenuOpen(false);
                                    }}
                                    title={s.description}
                                  >
                                    {s.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {selectedSkill && (
                          <span className="skill-selected-inline">
                            {selectedSkill}
                            <button
                              className="skill-selected-clear"
                              onClick={() => setSelectedSkill(null)}
                            >
                              <IconX size={12} />
                            </button>
                          </span>
                        )}
                      </div>
                      <div className="chat-input-actions-right">
                        {isRecording && (
                          <span className="recording-time">
                            {Math.floor(recordingTime / 60)}:
                            {String(recordingTime % 60).padStart(2, "0")}
                          </span>
                        )}
                        <button
                          className={`btn-voice${isListening || isRecording ? " listening" : ""}`}
                          onClick={toggleVoice}
                          disabled={isSending}
                          title={
                            isListening || isRecording
                              ? t("chat.stopVoice")
                              : t("chat.voiceInput")
                          }
                        >
                          <IconMic size={18} />
                        </button>
                        {isSending && !pendingPrompt ? (
                          <button
                            className="btn-stop"
                            onClick={handleStop}
                            title={t("chat.stopGeneration")}
                          >
                            <IconSquare size={14} />
                          </button>
                        ) : (
                          <button
                            className="btn-send"
                            onClick={handleSend}
                            disabled={!pendingPrompt && !canSend}
                            title={t("chat.sendMessage")}
                          >
                            <IconArrowUp size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* end chat-main */}

            {previewFile && (
              <PreviewPanel
                file={previewFile}
                onClose={() => setPreviewFile(null)}
              />
            )}
          </div>
          {/* end chat-body */}
        </div>
      </FileDropZone>
    </PreviewContext.Provider>
  );
}
