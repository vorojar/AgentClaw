import { useState, useEffect, useRef, useCallback } from "react";
import {
  type SessionInfo,
  type ChatMessage,
  type WSMessage,
  listSessions,
  createSession,
  getHistory,
  connectWebSocket,
} from "../api/client";
import "./ChatPage.css";

/* ────────────────────────────────────────────────────
   Types for the internal message model.
   We extend beyond plain ChatMessage to support
   streaming text and tool-call cards inline.
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
  /** Unique key for React rendering */
  key: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  model?: string;
  createdAt?: string;
  /** Whether this message is still being streamed */
  streaming: boolean;
  /** Tool calls associated with this assistant turn */
  toolCalls: ToolCallEntry[];
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
  return {
    key: nextKey(),
    role: m.role,
    content: m.content,
    model: m.model,
    createdAt: m.createdAt,
    streaming: false,
    toolCalls: [],
  };
}

/* ────────────────────────────────────────────────────
   Component: ToolCallCard
   ──────────────────────────────────────────────────── */

function ToolCallCard({
  entry,
  onToggle,
}: {
  entry: ToolCallEntry;
  onToggle: () => void;
}) {
  const hasResult = entry.toolResult !== undefined;

  return (
    <div className="tool-call-card">
      <div className="tool-call-header" onClick={onToggle}>
        <span
          className={`tool-call-chevron ${entry.collapsed ? "" : "expanded"}`}
        >
          &#9654;
        </span>
        <span className="tool-call-icon">&#128295;</span>
        <span className="tool-call-name">{entry.toolName}</span>
        {hasResult && (
          <span
            className={`tool-call-status badge ${entry.isError ? "badge-error" : "badge-success"}`}
          >
            {entry.isError ? "error" : "done"}
          </span>
        )}
        {!hasResult && (
          <span className="tool-call-status badge badge-warning">running</span>
        )}
      </div>
      {!entry.collapsed && (
        <div className="tool-call-body">
          <div className="tool-call-input">
            <div className="tool-call-section-label">Input</div>
            <div className="tool-call-content">
              {entry.toolInput || "(none)"}
            </div>
          </div>
          {hasResult && (
            <div className="tool-call-result">
              <div className="tool-call-section-label">Result</div>
              <div
                className={`tool-call-content ${entry.isError ? "tool-result-error" : "tool-result-success"}`}
              >
                {entry.toolResult}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────
   Component: ChatPage (default export)
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

  /* ── Refs ───────────────────────────────────────── */
  const wsRef = useRef<{ send: (c: string) => void; close: () => void } | null>(
    null,
  );
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<DisplayMessage[]>(messages);
  const toolCallIdRef = useRef(0);

  // Keep messagesRef in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /* ── Scroll to bottom ──────────────────────────── */
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

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

        // Auto-select the most recent session
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
        setMessages(history.map(chatMessageToDisplay));
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

    // Close previous connection
    wsRef.current?.close();
    setWsDisconnected(false);

    const conn = connectWebSocket(
      activeSessionId,
      (msg: WSMessage) => {
        handleWsMessage(msg);
      },
      () => {
        // onClose
        setWsConnected(false);
        setWsDisconnected(true);
        setIsSending(false);
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
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            // Append to existing streaming message
            const updated = {
              ...last,
              content: last.content + (msg.text ?? ""),
            };
            return [...prev.slice(0, -1), updated];
          } else {
            // Start a new assistant message
            const newMsg: DisplayMessage = {
              key: nextKey(),
              role: "assistant",
              content: msg.text ?? "",
              streaming: true,
              toolCalls: [],
            };
            return [...prev, newMsg];
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

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            const updated = {
              ...last,
              toolCalls: [...last.toolCalls, entry],
            };
            return [...prev.slice(0, -1), updated];
          } else {
            // Create new assistant message with tool call
            const newMsg: DisplayMessage = {
              key: nextKey(),
              role: "assistant",
              content: "",
              streaming: true,
              toolCalls: [entry],
            };
            return [...prev, newMsg];
          }
        });
        break;
      }

      case "tool_result": {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.toolCalls.length > 0) {
            // Update the most recent tool call that doesn't have a result yet
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

      case "done": {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            return [...prev.slice(0, -1), { ...last, streaming: false }];
          }
          return prev;
        });
        setIsSending(false);
        break;
      }

      case "error": {
        // If session was lost (e.g. gateway restart), auto-create a new one
        if (msg.error?.includes("Session not found")) {
          createSession()
            .then((newSession) => {
              setSessions((prev) => [newSession, ...prev]);
              setActiveSessionId(newSession.id);
            })
            .catch(() => {});
          return;
        }

        // Append an error display
        const errMsg: DisplayMessage = {
          key: nextKey(),
          role: "system",
          content: msg.error ?? "An unknown error occurred.",
          streaming: false,
          toolCalls: [],
        };
        setMessages((prev) => {
          // If the last message is a streaming assistant, mark it done
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
        break;
      }
    }
  }, []);

  /* ── Send message ──────────────────────────────── */
  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isSending || !wsRef.current) return;

    // Add user message to display
    const userMsg: DisplayMessage = {
      key: nextKey(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      streaming: false,
      toolCalls: [],
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsSending(true);

    // Send via WebSocket
    wsRef.current.send(text);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [inputValue, isSending]);

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

  /* ── Switch session ────────────────────────────── */
  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setIsSending(false);
  }, []);

  /* ── Toggle tool call collapse ─────────────────── */
  const toggleToolCall = useCallback((msgKey: string, toolId: number) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.key !== msgKey) return m;
        return {
          ...m,
          toolCalls: m.toolCalls.map((tc) =>
            tc.id === toolId ? { ...tc, collapsed: !tc.collapsed } : tc,
          ),
        };
      }),
    );
  }, []);

  /* ── Reconnect ─────────────────────────────────── */
  const handleReconnect = useCallback(() => {
    connectWs();
  }, [connectWs]);

  /* ── Render ─────────────────────────────────────── */
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const canSend = inputValue.trim().length > 0 && !isSending && wsConnected;

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
            </button>
          ))}
        </div>
      </aside>

      {/* Chat Area */}
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
          <span className="chat-header-title">Chat</span>
          {activeSession && (
            <span className="chat-header-session-id">
              {activeSession.id.slice(0, 8)}
            </span>
          )}
        </div>

        {/* Disconnected banner */}
        {wsDisconnected && (
          <div className="connection-banner">
            <span>Connection lost.</span>
            <button onClick={handleReconnect}>Reconnect</button>
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
              {messages.map((m) => (
                <div key={m.key}>
                  {/* Error / system messages use special styling */}
                  {m.role === "system" && m.content ? (
                    <div className="message-error">
                      <span className="message-error-icon">&#9888;</span>
                      <span>{m.content}</span>
                    </div>
                  ) : (
                    <>
                      {/* Regular message content */}
                      {m.content && (
                        <div className={`message-row ${m.role}`}>
                          <div className="message-bubble">
                            <div>
                              {m.content}
                              {m.streaming && m.toolCalls.length === 0 && (
                                <span className="streaming-cursor" />
                              )}
                            </div>
                            {m.createdAt && (
                              <div className="message-meta">
                                {formatTime(m.createdAt)}
                                {m.model ? ` \u00b7 ${m.model}` : ""}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Tool calls */}
                      {m.toolCalls.map((tc) => (
                        <ToolCallCard
                          key={tc.id}
                          entry={tc}
                          onToggle={() => toggleToolCall(m.key, tc.id)}
                        />
                      ))}
                    </>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="chat-input-area">
          <div className="chat-input-wrapper">
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
            <button
              className={`btn-send ${isSending ? "loading" : ""}`}
              onClick={handleSend}
              disabled={!canSend}
              title="Send message"
            >
              {isSending ? "" : "\u2191"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
