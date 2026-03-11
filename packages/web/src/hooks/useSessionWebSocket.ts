import { useState, useEffect, useRef, useCallback } from "react";
import { type WSMessage, connectWebSocket } from "../api/client";

export interface SessionWSHandle {
  send: (content: string, skillName?: string) => void;
  stop: () => void;
  close: () => void;
  promptReply: (content: string) => void;
}

export interface UseSessionWebSocketOptions {
  /** Current active session ID */
  sessionId: string | null;
  /** Called for each WS message (already guarded by generation counter) */
  onMessage: (msg: WSMessage) => void;
  /** Called when streaming state needs to be cleared (reconnect found session idle) */
  onStaleStreaming?: () => void;
  /** Ref indicating whether a resuming replay is active */
  resumingRef: React.MutableRefObject<boolean>;
  /** Ref tracking the streaming session (for stale detection) */
  streamingSessionRef: React.MutableRefObject<string | null>;
}

export interface UseSessionWebSocketResult {
  wsRef: React.MutableRefObject<SessionWSHandle | null>;
  wsConnected: boolean;
  wsDisconnected: boolean;
  /** Queue a message to send once WS connects (for new sessions) */
  setPendingSend: (content: string, skillName?: string) => void;
  /** Manually trigger reconnect */
  reconnect: () => void;
}

/**
 * Manages WebSocket connection lifecycle for a chat session.
 *
 * Handles: connection, reconnection with exponential backoff,
 * generation counter to prevent stale callbacks, visibility/online
 * auto-reconnect, and stale streaming detection on reconnect.
 */
export function useSessionWebSocket({
  sessionId,
  onMessage,
  onStaleStreaming,
  resumingRef,
  streamingSessionRef,
}: UseSessionWebSocketOptions): UseSessionWebSocketResult {
  const [wsConnected, setWsConnected] = useState(false);
  const [wsDisconnected, setWsDisconnected] = useState(false);

  const wsRef = useRef<SessionWSHandle | null>(null);
  const wsGenRef = useRef(0);
  const wsRetryRef = useRef(0);
  const pendingSendRef = useRef<{
    content: string;
    skill?: string;
  } | null>(null);

  // Stable refs for callbacks (avoid stale closures in connectWs)
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onStaleStreamingRef = useRef(onStaleStreaming);
  onStaleStreamingRef.current = onStaleStreaming;

  const connectWs = useCallback(() => {
    const gen = ++wsGenRef.current;
    wsRef.current?.close();
    wsRef.current = null;
    setWsConnected(false);
    setWsDisconnected(false);
    resumingRef.current = false;

    if (!sessionId) return;

    const conn = connectWebSocket(
      sessionId,
      // onMessage — guarded by generation counter
      (msg: WSMessage) => {
        if (wsGenRef.current === gen) onMessageRef.current(msg);
      },
      // onClose — reconnect with exponential backoff
      () => {
        if (wsGenRef.current === gen) {
          setWsConnected(false);
          setWsDisconnected(true);
          // Don't clear isSending — agent loop is still running server-side.
          const retry = wsRetryRef.current;
          const baseDelay = Math.min(
            1000 * Math.pow(2, Math.min(retry, 5)),
            30000,
          );
          const jitter = Math.random() * 1000;
          wsRetryRef.current = retry + 1;
          setTimeout(() => {
            if (wsGenRef.current === gen) connectWs();
          }, baseDelay + jitter);
        }
      },
      // onOpen
      () => {
        if (wsGenRef.current === gen) {
          wsRetryRef.current = 0;
          setWsConnected(true);
          setWsDisconnected(false);
          // Send pending message (first message that triggered session creation)
          if (pendingSendRef.current && conn) {
            const { content, skill } = pendingSendRef.current;
            pendingSendRef.current = null;
            conn.send(content, skill);
          }
          // If reconnecting to a session that was streaming, check if still active.
          // Server sends "resuming" synchronously on connect if still streaming.
          // If no "resuming" arrives within 500ms, session has finished — clear stale state.
          if (
            streamingSessionRef.current &&
            streamingSessionRef.current === sessionId
          ) {
            const snap = streamingSessionRef.current;
            setTimeout(() => {
              if (
                wsGenRef.current === gen &&
                streamingSessionRef.current === snap &&
                !resumingRef.current
              ) {
                onStaleStreamingRef.current?.();
              }
            }, 500);
          }
        }
      },
    );
    wsRef.current = conn;
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect on session change
  useEffect(() => {
    connectWs();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connectWs]);

  // Auto-reconnect on visibility change and network recovery
  const wsDisconnectedRef = useRef(false);
  wsDisconnectedRef.current = wsDisconnected;
  useEffect(() => {
    const tryReconnect = () => {
      if (wsDisconnectedRef.current && sessionId) {
        wsRetryRef.current = 0;
        connectWs();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") tryReconnect();
    };
    const onOnline = () => tryReconnect();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [connectWs, sessionId]);

  const setPendingSend = useCallback((content: string, skillName?: string) => {
    pendingSendRef.current = { content, skill: skillName };
  }, []);

  return {
    wsRef,
    wsConnected,
    wsDisconnected,
    setPendingSend,
    reconnect: connectWs,
  };
}
