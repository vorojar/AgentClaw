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

  // ── Mobile: drag-to-reveal sidebar (follows finger) ──
  const openRef = useRef(sidebarOpen);
  openRef.current = sidebarOpen;

  useEffect(() => {
    const SNAP_RATIO = 0.35; // release past 35% → snap open
    const TRANSITION_MS = 300; // match CSS transition duration

    let startX = 0;
    let startY = 0;
    let dragging = false;
    let decided = false;
    let sidebar: HTMLElement | null = null;
    let backdrop: HTMLElement | null = null;
    let sidebarW = 260;

    function onTouchStart(e: TouchEvent) {
      if (!isMobile() || openRef.current) return;
      const t = e.touches[0];
      // Allow start from left half of screen
      if (t.clientX > window.innerWidth / 2) return;
      sidebar = document.querySelector<HTMLElement>(".sidebar");
      if (!sidebar) return;
      sidebarW = sidebar.offsetWidth || 260;
      startX = t.clientX;
      startY = t.clientY;
      dragging = false;
      decided = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (sidebar === null) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);

      // Lock direction on first significant move
      if (!decided && (dx > 10 || dy > 10)) {
        decided = true;
        if (dy > dx || dx < 0) {
          // Vertical or leftward — abort
          sidebar = null;
          return;
        }
        dragging = true;
        sidebar.style.transition = "none";
        backdrop = document.createElement("div");
        backdrop.className = "sidebar-backdrop";
        backdrop.style.opacity = "0";
        backdrop.style.animation = "none";
        sidebar.parentElement?.appendChild(backdrop);
      }
      if (!dragging) return;

      const offset = Math.max(0, Math.min(dx, sidebarW));
      const progress = offset / sidebarW;
      sidebar.style.transform = `translateX(${offset - sidebarW}px)`;
      sidebar.style.pointerEvents = "none";
      if (backdrop) backdrop.style.opacity = String(progress * 0.4);
    }

    function onTouchEnd(e: TouchEvent) {
      if (!dragging || !sidebar) {
        sidebar = null;
        return;
      }
      const el = sidebar;
      const dx = (e.changedTouches[0]?.clientX ?? startX) - startX;
      const progress = Math.max(0, dx) / sidebarW;

      // Re-enable CSS transition for snap animation
      el.style.transition = "";
      el.style.pointerEvents = "";

      if (progress > SNAP_RATIO) {
        // Snap open: animate to translateX(0), then clear inline for React
        el.style.transform = "translateX(0)";
        setSidebarOpenWithHistory(true);
        setTimeout(() => {
          el.style.transform = "";
        }, TRANSITION_MS + 50);
        if (backdrop) {
          backdrop.style.transition = `opacity ${TRANSITION_MS}ms`;
          backdrop.style.opacity = "0.4";
          setTimeout(() => backdrop?.remove(), TRANSITION_MS);
        }
      } else {
        // Snap back: animate to collapsed position, then clear inline for CSS class
        el.style.transform = `translateX(${-sidebarW - 1}px)`;
        setTimeout(() => {
          el.style.transform = "";
        }, TRANSITION_MS + 50);
        if (backdrop) {
          backdrop.style.transition = `opacity ${TRANSITION_MS}ms`;
          backdrop.style.opacity = "0";
          setTimeout(() => backdrop?.remove(), TRANSITION_MS);
        }
      }

      sidebar = null;
      backdrop = null;
      dragging = false;
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
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
