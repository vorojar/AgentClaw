import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTheme } from "./ThemeProvider";
import { useSession } from "./SessionContext";
import { type ProjectInfo, listProjects, updateSession } from "../api/client";
import {
  IconChat,
  IconMemory,
  IconTraces,
  IconTokens,
  IconSettings,
  IconSkills,
  IconApi,
  IconSearch,
  IconPanelLeft,
  IconSun,
  IconMoon,
  IconX,
  IconEdit,
  IconMenu,
  IconTasks,
  IconChannels,
  IconSubAgents,
  IconAgents,
  IconProjects,
  IconChevronDown,
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
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    if (contextMenu) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [contextMenu]);

  const MORE_PATHS = [
    "/channels",
    "/subagents",
    "/agents",
    "/memory",
    "/traces",
    "/token-logs",
    "/skills",
    "/api",
  ];
  const isProjects = location.pathname.startsWith("/projects");
  const isMoreActive = MORE_PATHS.some((p) => location.pathname.startsWith(p));
  const [moreOpen, setMoreOpen] = useState(isMoreActive);

  const isMobile =
    typeof matchMedia !== "undefined" &&
    matchMedia("(max-width: 768px)").matches;

  /** Close sidebar on mobile after navigating */
  const closeSidebarOnMobile = () => {
    if (isMobile) setSidebarOpen(false);
  };

  const isChat =
    location.pathname === "/" || location.pathname.startsWith("/chat");

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
          <button
            className="sidebar-new-chat"
            onClick={() => {
              handleNewChat();
              closeSidebarOnMobile();
            }}
          >
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
        {searchVisible && (
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
            className={() => (isChat ? "active" : "")}
            onClick={closeSidebarOnMobile}
          >
            <IconChat size={16} /> Chat
          </NavLink>
          <NavLink
            to="/projects"
            className={() => (isProjects ? "active" : "")}
            onClick={closeSidebarOnMobile}
          >
            <IconProjects size={16} /> Projects
          </NavLink>
          <NavLink
            to="/tasks"
            className={({ isActive }) => (isActive ? "active" : "")}
            onClick={closeSidebarOnMobile}
          >
            <IconTasks size={16} /> Tasks
          </NavLink>
        </nav>

        {/* Projects section */}
        {projects.length > 0 && (
          <div className="sidebar-projects">
            <button
              className="sidebar-projects-toggle"
              onClick={() => setProjectsOpen((v) => !v)}
            >
              <span>Projects</span>
              <span
                className={`sidebar-more-chevron${projectsOpen ? " expanded" : ""}`}
              >
                <IconChevronDown size={14} />
              </span>
            </button>
            {projectsOpen && (
              <nav className="sidebar-projects-list">
                {projects.map((p) => (
                  <NavLink
                    key={p.id}
                    to={`/projects/${p.id}`}
                    className={({ isActive }) => (isActive ? "active" : "")}
                    onClick={closeSidebarOnMobile}
                  >
                    <span
                      className="sidebar-project-dot"
                      style={{ background: p.color }}
                    />
                    {p.name}
                  </NavLink>
                ))}
              </nav>
            )}
          </div>
        )}

        {/* More group (collapsible) */}
        <div className="sidebar-more">
          <button
            className={`sidebar-more-toggle${isMoreActive ? " active" : ""}`}
            onClick={() => setMoreOpen((v) => !v)}
          >
            <span>More</span>
            <span
              className={`sidebar-more-chevron${moreOpen ? " expanded" : ""}`}
            >
              <IconChevronDown size={14} />
            </span>
          </button>
          {moreOpen && (
            <nav className="sidebar-nav sidebar-nav-more">
              <NavLink
                to="/channels"
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={closeSidebarOnMobile}
              >
                <IconChannels size={16} /> Channels
              </NavLink>
              <NavLink
                to="/subagents"
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={closeSidebarOnMobile}
              >
                <IconSubAgents size={16} /> Subagents
              </NavLink>
              <NavLink
                to="/agents"
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={closeSidebarOnMobile}
              >
                <IconAgents size={16} /> Agents
              </NavLink>
              <NavLink
                to="/memory"
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={closeSidebarOnMobile}
              >
                <IconMemory size={16} /> Memory
              </NavLink>
              <NavLink
                to="/traces"
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={closeSidebarOnMobile}
              >
                <IconTraces size={16} /> Traces
              </NavLink>
              <NavLink
                to="/token-logs"
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={closeSidebarOnMobile}
              >
                <IconTokens size={16} /> Token Logs
              </NavLink>
              <NavLink
                to="/skills"
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={closeSidebarOnMobile}
              >
                <IconSkills size={16} /> Skills
              </NavLink>
              <NavLink
                to="/api"
                className={({ isActive }) => (isActive ? "active" : "")}
                onClick={closeSidebarOnMobile}
              >
                <IconApi size={16} /> API
              </NavLink>
            </nav>
          )}
        </div>

        {/* Session list */}
        {sessions.length > 0 &&
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
                      onClick={() => {
                        handleSelectSession(s.id);
                        closeSidebarOnMobile();
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          sessionId: s.id,
                        });
                      }}
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
          <div className="sidebar-footer-row">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `sidebar-footer-link${isActive ? " active" : ""}`
              }
              onClick={closeSidebarOnMobile}
            >
              <IconSettings size={16} /> Settings
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

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="main-content">
        {!sidebarOpen && !isChat && (
          <button
            className="mobile-menu-btn"
            onClick={() => setSidebarOpen(true)}
            title="Open sidebar"
          >
            <IconMenu size={18} />
          </button>
        )}
        <Outlet />
      </main>

      {contextMenu &&
        createPortal(
          <div
            className="session-context-overlay"
            onClick={() => setContextMenu(null)}
          >
            <div
              className="session-context-menu"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="session-context-label">移至项目</div>
              {projects.map((p) => (
                <button
                  key={p.id}
                  className="session-context-item"
                  onClick={async () => {
                    await updateSession(contextMenu.sessionId, {
                      projectId: p.id,
                    });
                    setContextMenu(null);
                  }}
                >
                  <span
                    className="sidebar-project-dot"
                    style={{ background: p.color }}
                  />
                  {p.name}
                </button>
              ))}
              <button
                className="session-context-item"
                onClick={async () => {
                  await updateSession(contextMenu.sessionId, {
                    projectId: null,
                  });
                  setContextMenu(null);
                }}
              >
                无项目
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
