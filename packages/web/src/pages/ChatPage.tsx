import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
  type ChatMessage,
  type WSMessage,
  getHistory,
  createSession,
  connectWebSocket,
  uploadFile,
  renameSession,
} from "../api/client";
import { CodeBlock } from "../components/CodeBlock";
import { FileDropZone } from "../components/FileDropZone";
import { useSession } from "../components/SessionContext";
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
} from "../components/Icons";
import { exportAsMarkdown } from "../utils/export";
import {
  notifyIfHidden,
  requestNotificationPermission,
} from "../utils/notifications";
import "./ChatPage.css";

/* ── Types ────────────────────────────────────────── */

interface ToolCallEntry {
  id: number;
  toolName: string;
  toolInput: string;
  toolResult?: string;
  isError?: boolean;
  collapsed: boolean;
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

function formatToolInput(input: string): string {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}

function formatToolResult(result: string): string {
  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item: Record<string, unknown>) =>
          item.content ? String(item.content) : JSON.stringify(item, null, 2),
        )
        .join("\n");
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return result;
  }
}

/** Detect if a string is likely JSON */
function isJsonString(s: string): boolean {
  const t = s.trimStart();
  return (
    (t.startsWith("{") || t.startsWith("[")) &&
    (() => {
      try {
        JSON.parse(s);
        return true;
      } catch {
        return false;
      }
    })()
  );
}

/** Detect if a string contains markdown formatting */
const MD_RE = /^#{1,6}\s|^\s*[-*]\s|\*\*|__|\[.+\]\(.+\)|```/m;

function formatUsageStats(msg: DisplayMessage): string | null {
  const parts: string[] = [];
  if (msg.model) parts.push(msg.model);
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
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
};

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

function ToolResultContent({
  content,
  isError,
}: {
  content: string;
  isError?: boolean;
}) {
  if (isError) {
    return <pre className="tool-call-content tool-result-error">{content}</pre>;
  }
  if (isJsonString(content)) {
    return (
      <CodeBlock className="language-json">
        {JSON.stringify(JSON.parse(content), null, 2)}
      </CodeBlock>
    );
  }
  if (MD_RE.test(content)) {
    return (
      <div className="tool-call-content tool-result-success tool-result-md">
        <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
      </div>
    );
  }
  return <pre className="tool-call-content tool-result-success">{content}</pre>;
}

function ToolCallCard({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const label = toolCallLabel(entry.toolName, entry.toolInput);
  return (
    <div className="tool-call-card">
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
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
        <span className={`tool-call-chevron${expanded ? " expanded" : ""}`}>
          <IconChevronRight size={14} />
        </span>
      </div>
      {expanded && (
        <div className="tool-call-body">
          {entry.toolInput && (
            <div className="tool-call-input">
              <div className="tool-call-section-label">INPUT</div>
              <CodeBlock className="language-json">
                {formatToolInput(entry.toolInput)}
              </CodeBlock>
            </div>
          )}
          {entry.toolResult !== undefined && (
            <div className="tool-call-result">
              <div className="tool-call-section-label">
                {entry.isError ? "ERROR" : "OUTPUT"}
              </div>
              <ToolResultContent
                content={formatToolResult(entry.toolResult)}
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
  const titleInputRef = useRef<HTMLInputElement>(null);

  const wsRef = useRef<{
    send: (c: string) => void;
    stop: () => void;
    close: () => void;
  } | null>(null);
  const wsGenRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<DisplayMessage[]>(messages);
  const toolCallIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSendRef = useRef<string | null>(null);
  const skipHistoryRef = useRef(false);
  const stoppedRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    requestNotificationPermission();
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
            pendingSendRef.current = null;
            conn.send(msg);
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
      case "done": {
        stoppedRef.current = false;
        setActiveToolName(null);
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
                durationMs: msg.durationMs ?? last.durationMs,
                toolCallCount: msg.toolCallCount ?? last.toolCallCount,
              },
            ];
          }
          return prev;
        });
        setIsSending(false);
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

  /* Send */
  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
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
    setIsSending(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    if (wsRef.current) {
      wsRef.current.send(contentToSend);
    } else {
      // No WS — store message, create/reconnect session; onOpen will send it
      pendingSendRef.current = contentToSend;
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
    setIsSending(true);
    wsRef.current.send(lastUserText);
  }, [isSending, lastUserText]);

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

  const handleExport = useCallback(() => {
    const activeSession = sessions.find((s) => s.id === activeSessionId);
    exportAsMarkdown(
      messages.filter((m) => m.role !== "system"),
      activeSession?.title,
    );
  }, [messages, sessions, activeSessionId]);

  const handleReconnect = useCallback(() => {
    connectWs();
  }, [connectWs]);

  /* Render */
  const activeSession = sessions.find((s) => s.id === activeSessionId);
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
              {activeSession?.title || "Chat"}
            </span>
          )}
          <div className="chat-header-actions">
            <button
              className="btn-icon"
              onClick={handleExport}
              title="Export"
              disabled={messages.length === 0}
            >
              <IconDownload size={16} />
            </button>
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

        {/* Messages */}
        {messages.length === 0 && !loadingHistory ? (
          <div className="chat-empty-state">
            <h2>How can I help you today?</h2>
            <p>Send a message to start a conversation.</p>
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
                      {m.content &&
                        (() => {
                          const parsed = parseMessageContent(m.content);
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
                                  <ReactMarkdown components={mdComponents}>
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
                              </div>
                            </div>
                          );
                        })()}
                      {m.toolCalls.map((tc) => (
                        <ToolCallCard key={tc.id} entry={tc} />
                      ))}
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

        {/* Pending file previews */}
        {pendingFiles.length > 0 && (
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

        {/* Input Area */}
        <div className="chat-input-area">
          <div className="chat-input-wrapper">
            <button
              className="btn-attach"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSending}
              title="Attach file"
            >
              <IconPaperclip size={18} />
            </button>
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
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isSending ? "Waiting for response..." : "Reply to AgentClaw..."
              }
              disabled={isSending}
              rows={2}
            />
            {isSending ? (
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
                disabled={!canSend}
                title="Send message"
              >
                <IconArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </FileDropZone>
  );
}
