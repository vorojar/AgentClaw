import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type ChatMessage,
  type WSMessage,
  type SkillInfo,
  getHistory,
  createSession,
  connectWebSocket,
  uploadFile,
  renameSession,
  closeSession,
  listSkills,
} from "../api/client";
import { CodeBlock } from "../components/CodeBlock";
import { FileDropZone } from "../components/FileDropZone";
import { useSession } from "../components/SessionContext";
import { useTheme } from "../components/ThemeProvider";
import {
  IconMenu,
  IconDownload,
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
  IconMoreHorizontal,
  IconEdit,
  IconTrash,
  IconMic,
  IconSkills,
} from "../components/Icons";
import { exportAsMarkdown } from "../utils/export";
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
  startedAt?: number;
  durationMs?: number;
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

/* ── Helpers ──────────────────────────────────────── */

let msgCounter = 0;
function nextKey(): string {
  return `msg-${++msgCounter}-${Date.now()}`;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
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
          }>;
          for (const tr of results) {
            const tc = lastMsg.toolCalls.find(
              (t) => t.toolResult === undefined,
            );
            if (tc) {
              tc.toolResult = tr.content ?? "";
              tc.isError = tr.isError ?? false;
            }
          }
        } catch {
          /* ignore */
        }
      }
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
  if (msg.durationMs != null)
    parts.push(`${(msg.durationMs / 1000).toFixed(1)}s`);
  if (msg.toolCallCount) parts.push(`${msg.toolCallCount} tools`);
  return parts.length > 0 ? parts.join(" \u00B7 ") : null;
}

/* ── HTML Preview Card + Overlay ── */

function HtmlPreviewCard({
  href,
  filename,
}: {
  href: string;
  filename: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="html-preview-card" onClick={() => setOpen(true)}>
        <span className="html-preview-icon">&#9654;</span>
        <span className="html-preview-name">{filename}</span>
        <span className="html-preview-badge">Preview</span>
      </div>
      {open &&
        createPortal(
          <HtmlPreviewOverlay
            href={href}
            filename={filename}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}

function HtmlPreviewOverlay({
  href,
  filename,
  onClose,
}: {
  href: string;
  filename: string;
  onClose: () => void;
}) {
  const [needsDevServer, setNeedsDevServer] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);

    // Push history entry so browser back closes the overlay
    history.pushState({ _htmlPreview: true }, "");
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("popstate", onPop);
      // Clean up dummy history entry if closed by button/Escape (not back)
      if (history.state?._htmlPreview) history.back();
    };
  }, [onClose]);

  // Detect non-self-contained HTML (Vite/webpack projects with module script refs)
  useEffect(() => {
    fetch(href)
      .then((r) => r.text())
      .then((html) => {
        if (/<script\b[^>]*\bsrc=["'](?!https?:\/\/)/.test(html)) {
          setNeedsDevServer(true);
        }
      })
      .catch(() => {});
  }, [href]);

  return (
    <div className="html-overlay">
      <div className="html-overlay-toolbar">
        <button className="html-overlay-btn" onClick={onClose} title="Close">
          <IconArrowLeft size={20} />
        </button>
        <span className="html-overlay-title">{filename}</span>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="html-overlay-btn"
          title="Open in new tab"
        >
          <IconExternalLink size={18} />
        </a>
      </div>
      {needsDevServer ? (
        <>
          <iframe
            src="http://localhost:5173"
            className="html-overlay-iframe"
            title="Vite dev server preview"
          />
          <div className="html-overlay-hint">
            If blank, run:{" "}
            <code>
              cd{" "}
              {href.replace(/^\/files\//, "data/tmp/").replace(/\/[^/]+$/, "")}{" "}
              && npm run dev
            </code>
          </div>
        </>
      ) : (
        <iframe
          src={href}
          sandbox="allow-scripts"
          className="html-overlay-iframe"
          title="HTML preview"
        />
      )}
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
    if (href && /\.(mp4|mkv|webm|mov|avi)$/i.test(href)) {
      return (
        <video
          src={href}
          controls
          preload="metadata"
          className="message-video"
        />
      );
    }
    if (href && /\.(mp3|wav|ogg|flac|m4a)$/i.test(href)) {
      return (
        <audio
          src={href}
          controls
          preload="metadata"
          className="message-audio"
        />
      );
    }
    if (href && /\.html?$/i.test(href) && href.startsWith("/files/")) {
      const filename = decodeURIComponent(href.split("/").pop() || "");
      return <HtmlPreviewCard href={href} filename={filename} />;
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
        {copied ? "Copied" : "Copy"}
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
          {entry.toolResult !== undefined ? (
            entry.isError ? (
              <IconXCircle size={14} />
            ) : (
              <IconCheck size={14} />
            )
          ) : (
            <IconClock size={14} />
          )}
        </span>
        <span className="tool-call-name" title={label}>
          {label}
        </span>
        {entry.durationMs !== undefined && (
          <span className="tool-call-duration">
            {entry.durationMs < 1000
              ? `${entry.durationMs}ms`
              : `${(entry.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        <span
          className="tool-call-chevron"
          style={{ transform: `rotate(${rotationRef.current}deg)` }}
        >
          <IconChevronRight size={14} />
        </span>
      </div>
      {expanded && (
        <div className="tool-call-body">
          {entry.toolInput && (
            <div className="tool-call-input">
              <SectionLabel label="INPUT" text={entry.toolInput} />
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
                label={entry.isError ? "ERROR" : "OUTPUT"}
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

/* ── ChatPage ─────────────────────────────────────── */

export function ChatPage() {
  const {
    sessions,
    activeSessionId,
    sidebarOpen,
    setSidebarOpen,
    refreshSessions,
    ensureSession,
  } = useSession();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsDisconnected, setWsDisconnected] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<
    Array<{ file: File; preview?: string }>
  >([]);
  const [lastUserText, setLastUserText] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [editingMsgKey, setEditingMsgKey] = useState<string | null>(null);
  const [editMsgValue, setEditMsgValue] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [todoItems, setTodoItems] = useState<
    Array<{ text: string; done: boolean }>
  >([]);
  const skillMenuRef = useRef<HTMLDivElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const wsRef = useRef<{
    send: (c: string, skillName?: string) => void;
    stop: () => void;
    close: () => void;
    promptReply: (c: string) => void;
  } | null>(null);
  const wsGenRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<DisplayMessage[]>(messages);
  const toolCallIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSendRef = useRef<string | null>(null);
  const pendingSkillRef = useRef<string | null>(null);

  /* ── Voice input (Web Speech API) ─── */
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const skipHistoryRef = useRef(false);
  const stoppedRef = useRef(false);
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
      setIsSending(false);
      setActiveToolName(null);
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
        setMessages(historyToDisplayMessages(history));
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

  /* WS connection — generation counter guards stale callbacks */
  const connectWs = useCallback(() => {
    // Always invalidate old WS callbacks first
    const gen = ++wsGenRef.current;
    wsRef.current?.close();
    wsRef.current = null;
    setWsConnected(false);
    setWsDisconnected(false);
    if (!activeSessionId) return;
    const conn = connectWebSocket(
      activeSessionId,
      (msg: WSMessage) => {
        if (wsGenRef.current === gen) handleWsMessage(msg);
      },
      () => {
        if (wsGenRef.current === gen) {
          setWsConnected(false);
          setWsDisconnected(true);
          setIsSending(false);
          setActiveToolName(null);
          // Auto-reconnect after 3 s (only if this generation is still current)
          setTimeout(() => {
            if (wsGenRef.current === gen) connectWs();
          }, 3000);
        }
      },
      () => {
        if (wsGenRef.current === gen) {
          setWsConnected(true);
          setWsDisconnected(false);
          // Send pending message (first message that triggered session creation)
          if (pendingSendRef.current && conn) {
            const msg = pendingSendRef.current;
            const skill = pendingSkillRef.current;
            pendingSendRef.current = null;
            pendingSkillRef.current = null;
            conn.send(msg, skill ?? undefined);
          }
        }
      },
    );
    wsRef.current = conn;
  }, [activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connectWs();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connectWs]);

  /* WS message handler */
  const handleWsMessage = useCallback((msg: WSMessage) => {
    // After stop is requested, ignore streaming events until "done" arrives
    if (stoppedRef.current && msg.type !== "done" && msg.type !== "error") {
      return;
    }
    switch (msg.type) {
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
          startedAt: Date.now(),
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
                  durationMs: toolCalls[i].startedAt
                    ? Date.now() - toolCalls[i].startedAt
                    : undefined,
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
          if (activeSessionId) {
            localStorage.setItem(
              `todo:${activeSessionId}`,
              JSON.stringify(items),
            );
          }
        }
        break;
      }
      case "done": {
        stoppedRef.current = false;
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
        setIsSending(false);
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
        setIsSending(false);
        setActiveToolName(null);
        break;
      }
    }
  }, []);

  /* Voice input toggle */
  const toggleVoice = useCallback(() => {
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

    const base = inputValue;

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
  }, []);

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

    if (pendingFiles.length > 0) {
      for (const pf of pendingFiles) {
        try {
          const result = await uploadFile(pf.file);
          if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(pf.file.name))
            imageUrls.push(result.url);
          contentToSend += `\n[Uploaded: ${pf.file.name}](${result.url})`;
        } catch (err) {
          console.error("Upload failed:", err);
        }
      }
      setPendingFiles([]);
    }

    let displayContent = text;
    for (const url of imageUrls) displayContent += `\n![](${url})`;

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
    setIsSending(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const skillToSend = selectedSkill || undefined;
    setSelectedSkill(null);

    if (wsRef.current) {
      wsRef.current.send(contentToSend, skillToSend);
    } else {
      // No WS — store message, create/reconnect session; onOpen will send it
      pendingSendRef.current = contentToSend;
      pendingSkillRef.current = skillToSend ?? null;
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
  ]);

  const handleStop = useCallback(() => {
    if (!wsRef.current) return;
    stoppedRef.current = true;
    wsRef.current.stop();
    setIsSending(false);
    setActiveToolName(null);
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
    (msgKey: string) => {
      const text = editMsgValue.trim();
      if (!text || isSending || !wsRef.current) return;
      // Truncate everything from this message onwards, then resend
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.key === msgKey);
        if (idx < 0) return prev;
        return prev.slice(0, idx);
      });
      setEditingMsgKey(null);
      setEditMsgValue("");
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
    [editMsgValue, isSending],
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

  // Close header menu on outside click
  useEffect(() => {
    if (!headerMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        headerMenuRef.current &&
        !headerMenuRef.current.contains(e.target as Node)
      ) {
        setHeaderMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [headerMenuOpen]);

  // Close skill menu on outside click
  useEffect(() => {
    if (!skillMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        skillMenuRef.current &&
        !skillMenuRef.current.contains(e.target as Node)
      ) {
        setSkillMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [skillMenuOpen]);

  const handleExport = useCallback(() => {
    const activeSession = sessions.find((s) => s.id === activeSessionId);
    exportAsMarkdown(
      messages.filter((m) => m.role !== "system"),
      activeSession?.title,
    );
    setHeaderMenuOpen(false);
  }, [messages, sessions, activeSessionId]);

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
  const activeSession = sessions.find((s) => s.id === activeSessionId);
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
    <FileDropZone onFiles={handleFiles} disabled={isSending}>
      <div className="chat-page">
        {/* Header */}
        <div className="chat-header">
          {!sidebarOpen && (
            <button
              className="btn-icon"
              onClick={() => setSidebarOpen(true)}
              title="Show sidebar"
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
              title="Double-click to rename"
            >
              {activeSession?.title || "AgentClaw"}
            </span>
          )}
          <div className="chat-header-actions" ref={headerMenuRef}>
            {!isNewChat && (
              <button
                className="btn-icon"
                onClick={() => setHeaderMenuOpen((v) => !v)}
                title="More"
              >
                <IconMoreHorizontal size={18} />
              </button>
            )}
            {headerMenuOpen && (
              <div className="header-dropdown">
                <button onClick={handleHeaderRename}>
                  <IconEdit size={14} /> Rename
                </button>
                <button onClick={handleExport} disabled={messages.length === 0}>
                  <IconDownload size={14} /> Export
                </button>
                <button
                  className="header-dropdown-danger"
                  onClick={handleHeaderDelete}
                  disabled={!activeSessionId}
                >
                  <IconTrash size={14} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Disconnected banner */}
        {wsDisconnected && (
          <div className="connection-banner">
            <span>Connection lost.</span>
            <button onClick={handleReconnect}>Reconnect</button>
          </div>
        )}

        {/* Tool execution status */}
        {activeToolName && (
          <div className="tool-status-bar">
            <span className="tool-status-spinner" />
            <span>Running {activeToolName}...</span>
          </div>
        )}

        {/* Todo progress card */}
        {todoItems.length > 0 && (
          <div className="todo-progress-card">
            <div className="todo-progress-header">
              <span className="todo-progress-label">Progress</span>
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

        {/* Messages */}
        {messages.length === 0 && !loadingHistory ? (
          <div className="chat-welcome">
            <h2 className="chat-welcome-title">What can I do for you?</h2>
            <div className="chat-welcome-input">
              <div className="chat-input-box">
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask AgentClaw..."
                  disabled={isSending}
                  rows={2}
                />
                <div className="chat-input-actions">
                  <div className="chat-input-actions-left">
                    <button
                      className="btn-attach"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSending}
                      title="Attach file"
                    >
                      <IconPaperclip size={18} />
                    </button>
                    {skills.length > 0 && (
                      <div className="skill-menu-anchor" ref={skillMenuRef}>
                        <button
                          className={`btn-skill${selectedSkill ? " active" : ""}`}
                          onClick={() => setSkillMenuOpen((v) => !v)}
                          disabled={isSending}
                          title="Select skill"
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
                    {(window.SpeechRecognition ||
                      window.webkitSpeechRecognition) && (
                      <button
                        className={`btn-voice${isListening ? " listening" : ""}`}
                        onClick={toggleVoice}
                        disabled={isSending}
                        title={isListening ? "Stop voice input" : "Voice input"}
                      >
                        <IconMic size={18} />
                      </button>
                    )}
                    <button
                      className="btn-send"
                      onClick={handleSend}
                      disabled={!canSend}
                      title="Send message"
                    >
                      <IconArrowUp size={18} />
                    </button>
                  </div>
                </div>
              </div>
              {pendingFiles.length > 0 && (
                <div
                  className="pending-files"
                  style={{ marginTop: 8, padding: 0 }}
                >
                  {pendingFiles.map((pf, i) => (
                    <div key={i} className="pending-file-item">
                      {pf.preview ? (
                        <img
                          src={pf.preview}
                          alt={pf.file.name}
                          className="pending-file-preview"
                        />
                      ) : (
                        <span className="pending-file-name">
                          {pf.file.name}
                        </span>
                      )}
                      <button
                        className="pending-file-remove"
                        onClick={() => removePendingFile(i)}
                      >
                        <IconX size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="chat-welcome-skills">
              {[
                { label: "Image Gen", skill: "comfyui" },
                { label: "Code", skill: "coding" },
                { label: "Excel", skill: "xlsx" },
                { label: "PDF", skill: "pdf" },
                { label: "Web Search", skill: "web-search" },
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
                More
              </button>
            </div>
          </div>
        ) : (
          <div className="messages-container">
            <div className="messages-list">
              {messages.map((m, idx) => (
                <div key={m.key} data-msg-key={m.key}>
                  {m.role === "system" && m.content ? (
                    <div className="message-error">
                      <span className="message-error-icon">
                        <IconWarning size={16} />
                      </span>
                      <span>{m.content}</span>
                    </div>
                  ) : (
                    <>
                      {m.toolCalls
                        .filter(
                          (tc) =>
                            tc.toolName !== "send_file" &&
                            tc.toolName !== "update_todo",
                        )
                        .map((tc) => (
                          <ToolCallCard key={tc.id} entry={tc} />
                        ))}
                      {m.content &&
                        (() => {
                          const parsed = parseMessageContent(m.content);

                          /* Inline editing mode for user messages */
                          if (m.role === "user" && editingMsgKey === m.key) {
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
                                      onClick={() => setEditingMsgKey(null)}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      className="btn-edit-submit"
                                      onClick={() => handleEditSubmit(m.key)}
                                      disabled={!editMsgValue.trim()}
                                    >
                                      Send
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
                                      marginBottom: parsed.text ? "8px" : 0,
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
                                  {m.streaming && m.toolCalls.length === 0 && (
                                    <span className="streaming-cursor" />
                                  )}
                                </div>
                                {(m.createdAt ||
                                  (m.role === "assistant" && !m.streaming)) && (
                                  <div className="message-meta">
                                    {formatTime(m.createdAt)}
                                    {m.role === "assistant" &&
                                    formatUsageStats(m)
                                      ? ` \u00b7 ${formatUsageStats(m)}`
                                      : m.model
                                        ? ` \u00b7 ${m.model}`
                                        : ""}
                                  </div>
                                )}
                                {m.role === "user" && !isSending && (
                                  <button
                                    className="btn-edit-msg"
                                    onClick={() => {
                                      setEditingMsgKey(m.key);
                                      setEditMsgValue(parsed.text);
                                    }}
                                    title="Edit & resend"
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
                              <IconRefresh size={14} /> Regenerate
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
          accept="*/*"
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
        {!isNewChat && pendingFiles.length > 0 && (
          <div className="pending-files">
            {pendingFiles.map((pf, i) => (
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
                <button
                  className="pending-file-remove"
                  onClick={() => removePendingFile(i)}
                >
                  <IconX size={10} />
                </button>
              </div>
            ))}
          </div>
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
                placeholder={
                  pendingPrompt
                    ? pendingPrompt
                    : isListening
                      ? "Listening..."
                      : isSending
                        ? "Waiting for response..."
                        : "Reply to AgentClaw..."
                }
                disabled={isSending && !pendingPrompt}
                rows={2}
              />
              <div className="chat-input-actions">
                <div className="chat-input-actions-left">
                  <button
                    className="btn-attach"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSending}
                    title="Attach file"
                  >
                    <IconPaperclip size={18} />
                  </button>
                  {skills.length > 0 && (
                    <div className="skill-menu-anchor" ref={skillMenuRef}>
                      <button
                        className={`btn-skill${selectedSkill ? " active" : ""}`}
                        onClick={() => setSkillMenuOpen((v) => !v)}
                        disabled={isSending}
                        title="Select skill"
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
                  {(window.SpeechRecognition ||
                    window.webkitSpeechRecognition) && (
                    <button
                      className={`btn-voice${isListening ? " listening" : ""}`}
                      onClick={toggleVoice}
                      disabled={isSending}
                      title={isListening ? "Stop voice input" : "Voice input"}
                    >
                      <IconMic size={18} />
                    </button>
                  )}
                  {isSending && !pendingPrompt ? (
                    <button
                      className="btn-stop"
                      onClick={handleStop}
                      title="Stop generation"
                    >
                      <IconSquare size={14} />
                    </button>
                  ) : (
                    <button
                      className="btn-send"
                      onClick={handleSend}
                      disabled={!pendingPrompt && !canSend}
                      title="Send message"
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
    </FileDropZone>
  );
}
