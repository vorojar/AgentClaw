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

  /* Load sessions on mount */
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        let list = await listSessions();
        if (cancelled) return;
        if (list.length === 0) {
          const ns = await createSession();
          if (cancelled) return;
          list = [ns];
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
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setActiveSessionId((prev) => (prev === id ? null : prev));
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  }, []);

  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

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
        refreshSessions,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
