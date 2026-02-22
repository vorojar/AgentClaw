import { useState, useRef, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTheme } from "./ThemeProvider";
import { useSession } from "./SessionContext";
import {
  IconChat,
  IconPlans,
  IconMemory,
  IconTraces,
  IconTokens,
  IconSettings,
  IconApi,
  IconSearch,
  IconPanelLeft,
  IconSun,
  IconMoon,
  IconX,
  IconEdit,
} from "./Icons";

function formatSessionLabel(s: {
  title?: string;
  createdAt: string;
  id: string;
}): string {
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

export function Layout() {
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const {
    sessions,
    activeSessionId,
    sidebarOpen,
    searchQuery,
    setSidebarOpen,
    setSearchQuery,
    handleNewChat,
    handleDeleteSession,
    handleSelectSession,
  } = useSession();

  const [searchVisible, setSearchVisible] = useState(false);

  const isChat = location.pathname === "/chat" || location.pathname === "/";

  return (
    <div className="app-layout">
      {/* Unified Sidebar */}
      <aside className={`sidebar${sidebarOpen ? "" : " collapsed"}`}>
        {/* Header */}
        <div className="sidebar-header">
          <span className="sidebar-brand">AgentClaw</span>
          <button
            className="sidebar-collapse-btn"
            onClick={() => setSidebarOpen(false)}
            title="Collapse sidebar"
          >
            <IconPanelLeft size={16} />
          </button>
        </div>

        {/* New Chat + Search */}
        <div className="sidebar-actions">
          <button className="sidebar-new-chat" onClick={handleNewChat}>
            <IconEdit size={16} />
            <span>New Chat</span>
          </button>
          <button
            className="sidebar-search-btn"
            onClick={() => {
              setSearchVisible((v) => !v);
              if (searchVisible) setSearchQuery("");
            }}
            title="Search sessions"
          >
            <IconSearch size={16} />
          </button>
        </div>

        {/* Session search input */}
        {searchVisible && isChat && (
          <div className="sidebar-search-box">
            <input
              autoFocus
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                  setSearchVisible(false);
                }
              }}
            />
            {searchQuery && (
              <button
                className="sidebar-search-clear"
                onClick={() => setSearchQuery("")}
              >
                <IconX size={12} />
              </button>
            )}
          </div>
        )}

        {/* Navigation */}
        <nav className="sidebar-nav">
          <NavLink
            to="/chat"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <IconChat size={16} /> Chat
          </NavLink>
          <NavLink
            to="/plans"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <IconPlans size={16} /> Plans
          </NavLink>
          <NavLink
            to="/memory"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <IconMemory size={16} /> Memory
          </NavLink>
          <NavLink
            to="/traces"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <IconTraces size={16} /> Traces
          </NavLink>
          <NavLink
            to="/token-logs"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <IconTokens size={16} /> Token Logs
          </NavLink>
        </nav>

        {/* Session list (when on chat) */}
        {isChat &&
          sessions.length > 0 &&
          (() => {
            const q = searchQuery.toLowerCase();
            const filtered = q
              ? sessions.filter((s) =>
                  formatSessionLabel(s).toLowerCase().includes(q),
                )
              : sessions;
            return (
              <>
                <div className="sidebar-divider">
                  <span>{q ? `Results (${filtered.length})` : "Recent"}</span>
                </div>
                <div className="sidebar-sessions">
                  {filtered.map((s) => (
                    <button
                      key={s.id}
                      className={`sidebar-session-item${s.id === activeSessionId ? " active" : ""}`}
                      onClick={() => handleSelectSession(s.id)}
                    >
                      <span className="sidebar-session-label">
                        {formatSessionLabel(s)}
                      </span>
                      <span
                        className="sidebar-session-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSession(s.id);
                        }}
                        title="Delete"
                      >
                        <IconX size={14} />
                      </span>
                    </button>
                  ))}
                </div>
              </>
            );
          })()}

        {/* Footer */}
        <div className="sidebar-footer">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `sidebar-footer-link${isActive ? " active" : ""}`
            }
          >
            <IconSettings size={16} /> Settings
          </NavLink>
          <div className="sidebar-footer-row">
            <NavLink
              to="/api"
              className={({ isActive }) =>
                `sidebar-footer-link${isActive ? " active" : ""}`
              }
            >
              <IconApi size={16} /> API
            </NavLink>
            <button
              className="sidebar-theme-btn"
              onClick={toggle}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? (
                <IconSun size={14} />
              ) : (
                <IconMoon size={14} />
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
