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
        // Closed by code (backdrop / nav item) — replace dummy entry instead
        // of history.back() which races with NavLink navigate()
        sidebarHistoryRef.current = false;
        history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
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

  // Clean up drag backdrop when sidebar closes (by any means)
  useEffect(() => {
    if (!sidebarOpen) {
      const bd = document.getElementById("drag-backdrop");
      if (bd) {
        bd.style.transition = "opacity 200ms";
        bd.style.opacity = "0";
        setTimeout(() => bd.remove(), 200);
      }
      delete document.documentElement.dataset.sidebarDrag;
    }
  }, [sidebarOpen]);

  useEffect(() => {
    const SNAP_RATIO = 0.35;
    const TRANSITION_MS = 300;

    let startX = 0;
    let startY = 0;
    let dragging = false;
    let decided = false;
    let closing = false; // true = swipe-to-close, false = swipe-to-open
    let sidebar: HTMLElement | null = null;
    let backdrop: HTMLElement | null = null;
    let sidebarW = 300;

    function onTouchStart(e: TouchEvent) {
      if (!isMobile()) return;
      const t = e.touches[0];
      const isOpen = openRef.current;

      if (isOpen) {
        // Swipe-to-close: only start on the sidebar itself or its backdrop
        sidebar = document.querySelector<HTMLElement>(".sidebar");
        if (!sidebar) return;
        const rect = sidebar.getBoundingClientRect();
        if (t.clientX > rect.right + 40) {
          sidebar = null;
          return;
        }
        closing = true;
      } else {
        // Swipe-to-open: only left half of screen
        if (t.clientX > window.innerWidth / 2) return;
        sidebar = document.querySelector<HTMLElement>(".sidebar");
        if (!sidebar) return;
        closing = false;
      }

      sidebarW = sidebar.offsetWidth || 300;
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

      if (!decided && (Math.abs(dx) > 10 || dy > 10)) {
        decided = true;
        if (closing) {
          // Close gesture: must swipe left (dx < 0) and horizontally dominant
          if (dy > Math.abs(dx) || dx > 0) {
            sidebar = null;
            return;
          }
        } else {
          // Open gesture: must swipe right (dx > 0) and horizontally dominant
          if (dy > dx || dx < 0) {
            sidebar = null;
            return;
          }
        }
        dragging = true;
        sidebar.style.transition = "none";

        if (closing) {
          // Grab the existing React backdrop or drag-backdrop
          backdrop =
            document.querySelector<HTMLElement>(".sidebar-backdrop") ||
            document.getElementById("drag-backdrop");
          if (backdrop) backdrop.style.transition = "none";
        } else {
          // Create a fresh drag backdrop for open gesture
          backdrop = document.createElement("div");
          backdrop.id = "drag-backdrop";
          backdrop.style.cssText =
            "position:fixed;inset:0;z-index:199;" +
            "background:rgba(0,0,0,0.4);" +
            "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);" +
            "opacity:0;pointer-events:none;";
          sidebar.parentElement?.appendChild(backdrop);
        }
      }
      if (!dragging) return;

      if (closing) {
        // dx is negative (swiping left). Map 0..-sidebarW to progress 1..0
        const offset = Math.max(-sidebarW, Math.min(0, dx));
        const progress = 1 + offset / sidebarW; // 1 = fully open, 0 = fully closed
        sidebar.style.transform = `translateX(${offset}px)`;
        sidebar.style.pointerEvents = "none";
        if (backdrop) backdrop.style.opacity = String(Math.max(0, progress));
      } else {
        // dx is positive (swiping right). Map 0..sidebarW to progress 0..1
        const offset = Math.max(0, Math.min(dx, sidebarW));
        const progress = offset / sidebarW;
        sidebar.style.transform = `translateX(${offset - sidebarW}px)`;
        sidebar.style.pointerEvents = "none";
        if (backdrop) backdrop.style.opacity = String(progress);
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!dragging || !sidebar) {
        sidebar = null;
        return;
      }
      const el = sidebar;
      const dx = (e.changedTouches[0]?.clientX ?? startX) - startX;

      el.style.transition = "";
      el.style.pointerEvents = "";

      const bd = backdrop;

      if (closing) {
        const progress = Math.max(0, -dx) / sidebarW; // how far closed
        if (progress > SNAP_RATIO) {
          // Snap closed
          el.style.transform = `translateX(${-sidebarW - 1}px)`;
          setSidebarOpenWithHistory(false);
          setTimeout(() => {
            el.style.transform = "";
          }, TRANSITION_MS + 50);
          if (bd) {
            bd.style.transition = `opacity ${TRANSITION_MS}ms`;
            bd.style.opacity = "0";
          }
        } else {
          // Bounce back open
          el.style.transform = "translateX(0)";
          setTimeout(() => {
            el.style.transform = "";
          }, TRANSITION_MS + 50);
          if (bd) {
            bd.style.transition = "";
            bd.style.opacity = "1";
          }
        }
      } else {
        const progress = Math.max(0, dx) / sidebarW;
        if (progress > SNAP_RATIO) {
          // Snap open
          if (bd) {
            bd.style.transition = `opacity 200ms`;
            bd.style.opacity = "1";
            bd.style.pointerEvents = "auto";
            bd.onclick = () => setSidebarOpenWithHistory(false);
          }
          document.documentElement.dataset.sidebarDrag = "";
          el.style.transform = "translateX(0)";
          setSidebarOpenWithHistory(true);
          setTimeout(() => {
            el.style.transform = "";
          }, TRANSITION_MS + 50);
        } else {
          // Snap back closed
          el.style.transform = `translateX(${-sidebarW - 1}px)`;
          setTimeout(() => {
            el.style.transform = "";
          }, TRANSITION_MS + 50);
          if (bd) {
            bd.style.transition = `opacity ${TRANSITION_MS}ms`;
            bd.style.opacity = "0";
            setTimeout(() => bd.remove(), TRANSITION_MS);
          }
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
