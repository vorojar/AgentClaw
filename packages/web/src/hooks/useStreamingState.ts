import { useState, useCallback, useRef } from "react";

export interface UseStreamingStateOptions {
  /** Setter from SessionContext — drives sidebar spinner */
  setStreamingSessionId: (id: string | null) => void;
}

export interface UseStreamingStateResult {
  isSending: boolean;
  activeToolName: string | null;
  /** Ref tracking which session is actually streaming (survives session switch) */
  streamingSessionRef: React.MutableRefObject<string | null>;
  /** Begin streaming for a session (sets isSending + streaming session) */
  startStreaming: (sessionId: string | null) => void;
  /** Streaming finished normally (clears everything) */
  stopStreaming: () => void;
  /** Session switch / WS reconnect — clear local UI state only */
  resetLocal: () => void;
  /** Set current tool name (during streaming) */
  setActiveToolName: (name: string | null) => void;
  /** Set isSending directly (for edge cases like retry/edit) */
  setIsSending: (v: boolean) => void;
}

/**
 * Manages streaming-related UI state.
 *
 * Consolidates isSending, activeToolName, streamingSessionRef and
 * streamingSessionId (from context) into named transitions.
 */
export function useStreamingState({
  setStreamingSessionId,
}: UseStreamingStateOptions): UseStreamingStateResult {
  const [isSending, setIsSending] = useState(false);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const streamingSessionRef = useRef<string | null>(null);

  const startStreaming = useCallback(
    (sessionId: string | null) => {
      setIsSending(true);
      streamingSessionRef.current = sessionId;
      setStreamingSessionId(sessionId);
    },
    [setStreamingSessionId],
  );

  const stopStreaming = useCallback(() => {
    setIsSending(false);
    setActiveToolName(null);
    streamingSessionRef.current = null;
    setStreamingSessionId(null);
  }, [setStreamingSessionId]);

  const resetLocal = useCallback(() => {
    setIsSending(false);
    setActiveToolName(null);
  }, []);

  return {
    isSending,
    activeToolName,
    streamingSessionRef,
    startStreaming,
    stopStreaming,
    resetLocal,
    setActiveToolName,
    setIsSending,
  };
}
