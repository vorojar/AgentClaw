import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  type SessionInfo,
  listSessions,
  createSession,
  closeSession,
} from "../api/client";

interface SessionContextValue {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  sidebarOpen: boolean;
  searchQuery: string;
  setSidebarOpen: (v: boolean) => void;
  setSearchQuery: (v: string) => void;
  handleNewChat: () => Promise<void>;
  handleDeleteSession: (id: string) => Promise<void>;
  handleSelectSession: (id: string) => void;
  /** Create session on-demand (e.g. first message) and set as active */
  ensureSession: () => Promise<string>;
  /** Called by ChatPage when session title updates from WS */
  refreshSessions: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>(null!);

export function useSession() {
  return useContext(SessionContext);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  /* Load sessions on mount — never auto-create */
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const list = await listSessions();
        if (cancelled) return;
        setSessions(list);
        if (list.length > 0) {
          const sorted = [...list].sort(
            (a, b) =>
              new Date(b.lastActiveAt).getTime() -
              new Date(a.lastActiveAt).getTime(),
          );
          setActiveSessionId(sorted[0].id);
        }
      } catch (err) {
        console.error("Failed to load sessions:", err);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNewChat = useCallback(async () => {
    try {
      const ns = await createSession();
      setSessions((prev) => [ns, ...prev]);
      setActiveSessionId(ns.id);
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  }, []);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      await closeSession(id);
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== id);
        return remaining;
      });
      setActiveSessionId((prev) => {
        if (prev !== id) return prev;
        // Will be resolved by the effect below
        return null;
      });
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  }, []);

  /* When activeSessionId becomes null and sessions exist, pick the most recent */
  useEffect(() => {
    if (activeSessionId !== null) return;
    if (sessions.length > 0) {
      const sorted = [...sessions].sort(
        (a, b) =>
          new Date(b.lastActiveAt).getTime() -
          new Date(a.lastActiveAt).getTime(),
      );
      setActiveSessionId(sorted[0].id);
    }
    // If sessions is empty, stay null — empty state shown
  }, [activeSessionId, sessions]);

  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  /** Lazily create a session when the user actually sends a message */
  const ensureSession = useCallback(async (): Promise<string> => {
    if (activeSessionId) return activeSessionId;
    const ns = await createSession();
    setSessions((prev) => [ns, ...prev]);
    setActiveSessionId(ns.id);
    return ns.id;
  }, [activeSessionId]);

  const refreshSessions = useCallback(async () => {
    try {
      const list = await listSessions();
      setSessions(list);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <SessionContext.Provider
      value={{
        sessions,
        activeSessionId,
        sidebarOpen,
        searchQuery,
        setSidebarOpen,
        setSearchQuery,
        handleNewChat,
        handleDeleteSession,
        handleSelectSession,
        ensureSession,
        refreshSessions,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
