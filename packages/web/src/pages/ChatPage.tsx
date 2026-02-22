import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
  type SessionInfo,
  type ChatMessage,
  type WSMessage,
  listSessions,
  createSession,
  closeSession,
  getHistory,
  connectWebSocket,
  uploadFile,
} from "../api/client";
import { CodeBlock } from "../components/CodeBlock";
import { FileDropZone } from "../components/FileDropZone";
import { ModelSelector } from "../components/ModelSelector";
import { SearchDialog } from "../components/SearchDialog";
import { exportAsMarkdown } from "../utils/export";
import {
  notifyIfHidden,
  requestNotificationPermission,
} from "../utils/notifications";
import "./ChatPage.css";

/* ────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────── */

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

/* ────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────── */

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

function formatSessionLabel(s: SessionInfo): string {
  if (s.title) return s.title;
  try {
    const d = new Date(s.createdAt);
    return (
      d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return s.id.slice(0, 8);
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
      // ignore
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
          // ignore
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
    // not JSON, treat as plain text
  }
  return { text: content, images: [] };
}

function formatToolInput(input: string): string {
  try {
    const parsed = JSON.parse(input);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return input;
  }
}

function formatToolResult(result: string): string {
  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item: Record<string, unknown>) => {
          if (item.content) return String(item.content);
          return JSON.stringify(item, null, 2);
        })
        .join("\n");
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return result;
  }
}

function formatUsageStats(msg: DisplayMessage): string | null {
  const parts: string[] = [];
  if (msg.model) parts.push(msg.model);
  const total = (msg.tokensIn ?? 0) + (msg.tokensOut ?? 0);
  if (total > 0) {
    parts.push(
      `${total.toLocaleString()} tokens (${msg.tokensIn ?? 0}\u2191 ${msg.tokensOut ?? 0}\u2193)`,
    );
  }
  if (msg.durationMs != null) {
    parts.push(`${(msg.durationMs / 1000).toFixed(1)}s`);
  }
  if (msg.toolCallCount) {
    parts.push(`\uD83D\uDD27\u00D7${msg.toolCallCount}`);
  }
  return parts.length > 0 ? parts.join(" \u00B7 ") : null;
}

/* ────────────────────────────────────────────────────
   Component: ToolCallCard
   ──────────────────────────────────────────────────── */

function ToolCallCard({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tool-call-card">
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-icon">
          {entry.toolResult !== undefined
            ? entry.isError
              ? "\u274C"
              : "\u2705"
            : "\u23F3"}
        </span>
        <span className="tool-call-name">{entry.toolName}</span>
        <span className={`tool-call-chevron${expanded ? " expanded" : ""}`}>
          {"\u25B6"}
        </span>
      </div>

      {expanded && (
        <div className="tool-call-body">
          {entry.toolInput && (
            <div className="tool-call-input">
              <div className="tool-call-section-label">Input</div>
              <pre className="tool-call-content">
                {formatToolInput(entry.toolInput)}
              </pre>
            </div>
          )}
          {entry.toolResult !== undefined && (
            <div className="tool-call-result">
              <div className="tool-call-section-label">
                {entry.isError ? "Error" : "Output"}
              </div>
              <pre
                className={`tool-call-content ${entry.isError ? "tool-result-error" : "tool-result-success"}`}
              >
                {formatToolResult(entry.toolResult)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────
   Component: ChatPage
   ──────────────────────────────────────────────────── */

export function ChatPage() {
  /* ── State ──────────────────────────────────────── */
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsDisconnected, setWsDisconnected] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<
    Array<{ file: File; preview?: string }>
  >([]);
  const [lastUserText, setLastUserText] = useState<string | null>(null);

  /* ── Refs ───────────────────────────────────────── */
  const wsRef = useRef<{
    send: (c: string) => void;
    stop: () => void;
    close: () => void;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<DisplayMessage[]>(messages);
  const toolCallIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /* ── Request notification permission on mount ──── */
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  /* ── Scroll to bottom ──────────────────────────── */
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  /* ── Keyboard shortcuts ─────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* ── Load sessions on mount ────────────────────── */
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        let list = await listSessions();
        if (cancelled) return;

        if (list.length === 0) {
          const newSession = await createSession();
          if (cancelled) return;
          list = [newSession];
        }

        setSessions(list);

        const sorted = [...list].sort(
          (a, b) =>
            new Date(b.lastActiveAt).getTime() -
            new Date(a.lastActiveAt).getTime(),
        );
        setActiveSessionId(sorted[0].id);
      } catch (err) {
        console.error("Failed to load sessions:", err);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── Load history when active session changes ─── */
  useEffect(() => {
    if (!activeSessionId) return;
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

  /* ── WebSocket connection ──────────────────────── */
  const connectWs = useCallback(() => {
    if (!activeSessionId) return;

    wsRef.current?.close();
    setWsDisconnected(false);

    const conn = connectWebSocket(
      activeSessionId,
      (msg: WSMessage) => {
        handleWsMessage(msg);
      },
      () => {
        setWsConnected(false);
        setWsDisconnected(true);
        setIsSending(false);
        setActiveToolName(null);
      },
    );

    wsRef.current = conn;
    setWsConnected(true);
  }, [activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connectWs();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connectWs]);

  /* ── Handle incoming WebSocket messages ────────── */
  const handleWsMessage = useCallback((msg: WSMessage) => {
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
          } else {
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
          }
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
          } else {
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
          }
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
          } else {
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
          }
        });
        break;
      }

      case "done": {
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

            // Browser notification
            if (content) {
              notifyIfHidden("AgentClaw", content);
            }

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

      case "error": {
        if (msg.error?.includes("Session not found")) {
          createSession()
            .then((newSession) => {
              setSessions((prev) => [newSession, ...prev]);
              setActiveSessionId(newSession.id);
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

  /* ── Send message ──────────────────────────────── */
  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if ((!text && pendingFiles.length === 0) || isSending || !wsRef.current)
      return;

    // Upload pending files and build content
    let contentToSend = text;
    const imageUrls: string[] = [];

    if (pendingFiles.length > 0) {
      for (const pf of pendingFiles) {
        try {
          const result = await uploadFile(pf.file);
          if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(pf.file.name)) {
            imageUrls.push(result.url);
          }
          contentToSend += `\n[Uploaded: ${pf.file.name}](${result.url})`;
        } catch (err) {
          console.error("Upload failed:", err);
        }
      }
      setPendingFiles([]);
    }

    // Build display content with image previews
    let displayContent = text;
    for (const url of imageUrls) {
      displayContent += `\n![](${url})`;
    }

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

    wsRef.current.send(contentToSend);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [inputValue, isSending, pendingFiles]);

  /* ── Stop generation ─────────────────────────── */
  const handleStop = useCallback(() => {
    if (!wsRef.current) return;
    wsRef.current.stop();
    setIsSending(false);
    setActiveToolName(null);
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        return [...prev.slice(0, -1), { ...last, streaming: false }];
      }
      return prev;
    });
  }, []);

  /* ── Regenerate last response ──────────────────── */
  const handleRegenerate = useCallback(() => {
    if (isSending || !wsRef.current || !lastUserText) return;

    // Remove last assistant message(s)
    setMessages((prev) => {
      const idx = prev.length - 1;
      if (idx >= 0 && prev[idx].role === "assistant") {
        return prev.slice(0, idx);
      }
      return prev;
    });

    setIsSending(true);
    wsRef.current.send(lastUserText);
  }, [isSending, lastUserText]);

  /* ── File handling ─────────────────────────────── */
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

  /* ── Keyboard handler ──────────────────────────── */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  /* ── Auto-resize textarea ──────────────────────── */
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
      const ta = e.target;
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    },
    [],
  );

  /* ── Create new session ────────────────────────── */
  const handleNewChat = useCallback(async () => {
    try {
      const newSession = await createSession();
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  }, []);

  /* ── Delete session ────────────────────────────── */
  const handleDeleteSession = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      try {
        await closeSession(id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
          setMessages([]);
        }
      } catch (err) {
        console.error("Failed to delete session:", err);
      }
    },
    [activeSessionId],
  );

  /* ── Switch session ────────────────────────────── */
  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setIsSending(false);
    setActiveToolName(null);
  }, []);

  /* ── Export conversation ────────────────────────── */
  const handleExport = useCallback(() => {
    const activeSession = sessions.find((s) => s.id === activeSessionId);
    exportAsMarkdown(
      messages.filter((m) => m.role !== "system"),
      activeSession?.title,
    );
  }, [messages, sessions, activeSessionId]);

  /* ── Search navigate ────────────────────────────── */
  const handleSearchNavigate = useCallback((messageKey: string) => {
    const el = document.querySelector(`[data-msg-key="${messageKey}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("message-highlight");
      setTimeout(() => el.classList.remove("message-highlight"), 2000);
    }
  }, []);

  /* ── Reconnect ─────────────────────────────────── */
  const handleReconnect = useCallback(() => {
    connectWs();
  }, [connectWs]);

  /* ── Render ─────────────────────────────────────── */
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const canSend =
    (inputValue.trim().length > 0 || pendingFiles.length > 0) &&
    !isSending &&
    wsConnected;
  const showRegenerate =
    !isSending &&
    lastUserText &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "assistant" &&
    !messages[messages.length - 1].streaming;

  return (
    <div className="chat-page">
      {/* Session Sidebar */}
      <aside className={`session-sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="session-sidebar-header">
          <button className="btn-new-chat" onClick={handleNewChat}>
            + New Chat
          </button>
          <button
            className="btn-collapse"
            onClick={() => setSidebarOpen(false)}
            title="Collapse sidebar"
          >
            &#10094;
          </button>
        </div>
        <div className="session-list">
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`session-item ${s.id === activeSessionId ? "active" : ""}`}
              onClick={() => handleSelectSession(s.id)}
            >
              <span className="session-item-label">
                {formatSessionLabel(s)}
              </span>
              <span
                className="session-item-delete"
                onClick={(e) => handleDeleteSession(e, s.id)}
                title="Delete"
              >
                {"\u00D7"}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Chat Area */}
      <FileDropZone onFiles={handleFiles} disabled={!wsConnected}>
        <div className="chat-area">
          {/* Header */}
          <div className="chat-header">
            {!sidebarOpen && (
              <button
                className="btn-toggle-sidebar"
                onClick={() => setSidebarOpen(true)}
                title="Show sessions"
              >
                &#9776;
              </button>
            )}
            <span className="chat-header-title">
              {activeSession?.title || "Chat"}
            </span>
            <ModelSelector className="chat-header-model" />
            <div className="chat-header-actions">
              <button
                className="btn-header-action"
                onClick={() => setSearchOpen(true)}
                title="Search (Ctrl+F)"
              >
                {"\uD83D\uDD0D"}
              </button>
              <button
                className="btn-header-action"
                onClick={handleExport}
                title="Export"
                disabled={messages.length === 0}
              >
                {"\u2B07"}
              </button>
            </div>
          </div>

          {/* Search dialog */}
          {searchOpen && (
            <SearchDialog
              messages={messages}
              onNavigate={handleSearchNavigate}
              onClose={() => setSearchOpen(false)}
            />
          )}

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
              <div className="chat-empty-state-icon">&#128172;</div>
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
                        <span className="message-error-icon">&#9888;</span>
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
                                    <ReactMarkdown
                                      components={{
                                        code: CodeBlock as never,
                                        img: ({ src, alt, ...props }) => (
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
                                            onClick={() =>
                                              src && window.open(src, "_blank")
                                            }
                                            {...props}
                                          />
                                        ),
                                        a: ({ href, children, ...props }) => (
                                          <a
                                            href={href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            {...props}
                                          >
                                            {children}
                                          </a>
                                        ),
                                      }}
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

                        {/* Tool calls */}
                        {m.toolCalls.map((tc) => (
                          <ToolCallCard key={tc.id} entry={tc} />
                        ))}

                        {/* Regenerate button on last assistant message */}
                        {showRegenerate &&
                          idx === messages.length - 1 &&
                          m.role === "assistant" && (
                            <div className="regenerate-row">
                              <button
                                className="btn-regenerate"
                                onClick={handleRegenerate}
                              >
                                {"\u21BB"} Regenerate
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
                    {"\u00D7"}
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
                disabled={!wsConnected}
                title="Attach file"
              >
                {"\uD83D\uDCCE"}
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
                  isSending ? "Waiting for response..." : "Type a message..."
                }
                disabled={isSending || !wsConnected}
                rows={1}
              />
              {isSending ? (
                <button
                  className="btn-stop"
                  onClick={handleStop}
                  title="Stop generation"
                >
                  {"\u25A0"}
                </button>
              ) : (
                <button
                  className="btn-send"
                  onClick={handleSend}
                  disabled={!canSend}
                  title="Send message"
                >
                  {"\u2191"}
                </button>
              )}
            </div>
          </div>
        </div>
      </FileDropZone>
    </div>
  );
}
