import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  type SessionInfo,
  listSessions,
  createSession,
  closeSession,
} from "../api/client";

const isMobile = () =>
  typeof matchMedia !== "undefined" && matchMedia("(max-width: 768px)").matches;

interface SessionContextValue {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  sidebarOpen: boolean;
  searchQuery: string;
  setSidebarOpen: (v: boolean) => void;
  setSearchQuery: (v: string) => void;
  handleNewChat: () => void;
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

/** Extract session ID from URL pathname like /chat/abc123 */
function sessionIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/chat\/(.+)$/);
  return m ? m[1] : null;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() =>
    sessionIdFromPath(window.location.pathname),
  );
  const [sidebarOpen, setSidebarOpen] = useState(
    () =>
      typeof matchMedia === "undefined" ||
      !matchMedia("(max-width: 768px)").matches,
  );
  const [searchQuery, setSearchQuery] = useState("");

  /* Load sessions on mount */
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const list = await listSessions();
        if (cancelled) return;
        setSessions(list);
      } catch (err) {
        console.error("Failed to load sessions:", err);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Sync activeSessionId when user navigates with browser back/forward */
  useEffect(() => {
    if (!location.pathname.startsWith("/chat")) return;
    const urlId = sessionIdFromPath(location.pathname);
    setActiveSessionId(urlId);
  }, [location.pathname]);

  /** New Chat = navigate to /chat (no session ID) */
  const handleNewChat = useCallback(() => {
    setActiveSessionId(null);
    navigate("/chat");
  }, [navigate]);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      try {
        await closeSession(id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
          navigate("/chat");
        }
      } catch (err) {
        console.error("Failed to delete session:", err);
      }
    },
    [activeSessionId, navigate],
  );

  const handleSelectSession = useCallback(
    (id: string) => {
      setActiveSessionId(id);
      navigate(`/chat/${id}`);
    },
    [navigate],
  );

  /** Lazily create a session when the user actually sends a message */
  const ensurePromiseRef = useRef<Promise<string> | null>(null);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (activeSessionId) return activeSessionId;
    if (ensurePromiseRef.current) return ensurePromiseRef.current;
    ensurePromiseRef.current = (async () => {
      try {
        const ns = await createSession();
        setSessions((prev) => [ns, ...prev]);
        setActiveSessionId(ns.id);
        navigate(`/chat/${ns.id}`, { replace: true });
        return ns.id;
      } finally {
        ensurePromiseRef.current = null;
      }
    })();
    return ensurePromiseRef.current;
  }, [activeSessionId, navigate]);

  const refreshSessions = useCallback(async () => {
    try {
      const list = await listSessions();
      setSessions(list);
    } catch {
      /* ignore */
    }
  }, []);

  // ── Mobile: browser-back closes sidebar ──
  const sidebarHistoryRef = useRef(false);

  const setSidebarOpenWithHistory = useCallback(
    (open: boolean) => {
      setSidebarOpen(open);
      if (!isMobile()) return;
      if (open && !sidebarHistoryRef.current) {
        // Push dummy entry so "back" closes sidebar instead of navigating away
        history.pushState({ _sidebar: true }, "");
        sidebarHistoryRef.current = true;
      } else if (!open && sidebarHistoryRef.current) {
        // Closed by code (backdrop / nav item) — pop our entry
        sidebarHistoryRef.current = false;
        history.back();
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    function onPopState() {
      if (sidebarHistoryRef.current) {
        sidebarHistoryRef.current = false;
        setSidebarOpen(false);
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mobile: swipe-right from left edge to open sidebar ──
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (t.clientX < 40 && isMobile()) {
        startX = t.clientX;
        startY = t.clientY;
        tracking = true;
      }
    }
    function onTouchEnd(e: TouchEvent) {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dx > 50 && dy < dx) {
        setSidebarOpenWithHistory(true);
      }
    }
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [setSidebarOpenWithHistory]);

  return (
    <SessionContext.Provider
      value={{
        sessions,
        activeSessionId,
        sidebarOpen,
        searchQuery,
        setSidebarOpen: setSidebarOpenWithHistory,
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
