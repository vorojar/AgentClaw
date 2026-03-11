import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useTheme } from "./ThemeProvider";
import { useSession } from "./SessionContext";
import { updateSession, renameSession } from "../api/client";
import {
  IconChat,
  IconSettings,
  IconSearch,
  IconPanelLeft,
  IconSun,
  IconMoon,
  IconX,
  IconEdit,
  IconMenu,
  IconTasks,
  IconProjects,
  IconChevronDown,
  IconMoreHorizontal,
  IconTrash,
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
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
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
    streamingSessionId,
    activeLoopIds,
    projects,
    handleCreateProject,
    refreshSessions,
  } = useSession();

  const [searchVisible, setSearchVisible] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
    subMenu?: boolean;
  } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");

  const isMobile =
    typeof matchMedia !== "undefined" &&
    matchMedia("(max-width: 768px)").matches;

  const closeSidebarOnMobile = () => {
    if (isMobile) setSidebarOpen(false);
  };

  const handleCreateSubmit = async () => {
    if (!newProjectName.trim() || creating) return;
    setCreating(true);
    try {
      const p = await handleCreateProject(newProjectName);
      setCreateModalOpen(false);
      setNewProjectName("");
      navigate(`/projects/${p.id}`);
      closeSidebarOnMobile();
    } catch {
      /* ignore */
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSessionMenu(null);
    };
    if (sessionMenu) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [sessionMenu]);

  const handleSessionRename = async () => {
    if (!renamingSessionId || !renameValue.trim()) {
      setRenamingSessionId(null);
      return;
    }
    try {
      await renameSession(renamingSessionId, renameValue.trim());
      refreshSessions();
    } catch {
      /* ignore */
    }
    setRenamingSessionId(null);
  };

  const isSettingsActive = location.pathname.startsWith("/settings");

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
            title={t("sidebar.collapse")}
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
            <span>{t("sidebar.newChat")}</span>
          </button>
          <button
            className="sidebar-search-btn"
            onClick={() => {
              setSearchVisible((v) => !v);
              if (searchVisible) setSearchQuery("");
            }}
            title={t("sidebar.searchTitle")}
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
              placeholder={t("sidebar.searchSessions")}
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
            <IconChat size={16} /> {t("nav.chat")}
          </NavLink>
          <NavLink
            to="/tasks"
            className={({ isActive }) => (isActive ? "active" : "")}
            onClick={closeSidebarOnMobile}
          >
            <IconTasks size={16} /> {t("nav.tasks")}
          </NavLink>
        </nav>

        {/* Projects section */}
        <div className="sidebar-projects">
          <button
            className="sidebar-projects-toggle"
            onClick={() => setProjectsOpen((v) => !v)}
          >
            <span>{t("nav.projects")}</span>
            <span
              className={`sidebar-more-chevron${projectsOpen ? " expanded" : ""}`}
            >
              <IconChevronDown size={14} />
            </span>
          </button>
          {projectsOpen && (
            <nav className="sidebar-projects-list">
              <a
                className="sidebar-projects-new"
                onClick={() => {
                  setCreateModalOpen(true);
                }}
              >
                <IconEdit size={14} />
                {t("nav.newProject")}
              </a>
              {projects.map((p) => (
                <NavLink
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className={({ isActive }) => (isActive ? "active" : "")}
                  onClick={closeSidebarOnMobile}
                >
                  <IconProjects size={14} />
                  {p.name}
                </NavLink>
              ))}
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
                  <span>
                    {q
                      ? t("sidebar.results", { count: filtered.length })
                      : t("sidebar.recent")}
                  </span>
                </div>
                <div className="sidebar-sessions">
                  {filtered.map((s) => (
                    <button
                      key={s.id}
                      className={`sidebar-session-item${s.id === activeSessionId ? " active" : ""}`}
                      onClick={() => {
                        if (renamingSessionId === s.id) return;
                        handleSelectSession(s.id);
                        closeSidebarOnMobile();
                      }}
                    >
                      {renamingSessionId === s.id ? (
                        <input
                          autoFocus
                          className="sidebar-session-rename"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSessionRename();
                            if (e.key === "Escape") setRenamingSessionId(null);
                          }}
                          onBlur={handleSessionRename}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="sidebar-session-label">
                          {(s.id === streamingSessionId ||
                            activeLoopIds.has(s.id)) && (
                            <span className="sidebar-session-spinner" />
                          )}
                          {formatSessionLabel(s)}
                        </span>
                      )}
                      <span
                        className="sidebar-session-more"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = (
                            e.currentTarget as HTMLElement
                          ).getBoundingClientRect();
                          setSessionMenu({
                            x: rect.right,
                            y: rect.top,
                            sessionId: s.id,
                          });
                        }}
                      >
                        <IconMoreHorizontal size={14} />
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
              className={() =>
                `sidebar-footer-link${isSettingsActive ? " active" : ""}`
              }
              onClick={closeSidebarOnMobile}
            >
              <IconSettings size={16} /> {t("nav.settings")}
            </NavLink>
            <button
              className="sidebar-theme-btn"
              onClick={toggle}
              title={
                theme === "dark"
                  ? t("sidebar.lightMode")
                  : t("sidebar.darkMode")
              }
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
            title={t("sidebar.show")}
          >
            <IconMenu size={18} />
          </button>
        )}
        <Outlet />
      </main>

      {sessionMenu &&
        createPortal(
          <div
            className="session-context-overlay"
            onClick={() => setSessionMenu(null)}
          >
            <div
              className="session-context-menu"
              style={{ top: sessionMenu.y, left: sessionMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="session-context-item"
                onClick={() => {
                  const s = sessions.find(
                    (s) => s.id === sessionMenu.sessionId,
                  );
                  setRenameValue(s?.title || "");
                  setRenamingSessionId(sessionMenu.sessionId);
                  setSessionMenu(null);
                }}
              >
                <IconEdit size={14} /> {t("common.rename")}
              </button>
              {projects.length > 0 && (
                <div
                  className="session-context-sub"
                  onMouseEnter={() =>
                    setSessionMenu((m) => m && { ...m, subMenu: true })
                  }
                  onMouseLeave={() =>
                    setSessionMenu((m) => m && { ...m, subMenu: false })
                  }
                  onClick={() =>
                    setSessionMenu((m) => m && { ...m, subMenu: !m.subMenu })
                  }
                >
                  <span className="session-context-item">
                    <IconProjects size={14} /> {t("sidebar.moveToProject")}
                    <span className="session-context-arrow">›</span>
                  </span>
                  {sessionMenu.subMenu && (
                    <div className="session-context-submenu">
                      {projects.map((p) => (
                        <button
                          key={p.id}
                          className="session-context-item"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await updateSession(sessionMenu.sessionId, {
                              projectId: p.id,
                            });
                            refreshSessions();
                            setSessionMenu(null);
                          }}
                        >
                          <IconProjects size={14} />
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                className="session-context-item session-context-danger"
                onClick={() => {
                  handleDeleteSession(sessionMenu.sessionId);
                  setSessionMenu(null);
                }}
              >
                <IconTrash size={14} /> {t("common.delete")}
              </button>
            </div>
          </div>,
          document.body,
        )}

      {createModalOpen &&
        createPortal(
          <div
            className="project-modal-overlay"
            onClick={() => {
              setCreateModalOpen(false);
              setNewProjectName("");
            }}
          >
            <div className="project-modal" onClick={(e) => e.stopPropagation()}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h2>{t("projectModal.title")}</h2>
                <button
                  className="btn-icon"
                  onClick={() => {
                    setCreateModalOpen(false);
                    setNewProjectName("");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-secondary)",
                  }}
                >
                  <IconX size={18} />
                </button>
              </div>
              <div className="project-modal-field">
                <label>{t("projectModal.nameLabel")}</label>
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder={t("projectModal.namePlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleCreateSubmit();
                    }
                  }}
                />
              </div>
              <div className="project-modal-buttons">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setCreateModalOpen(false);
                    setNewProjectName("");
                  }}
                >
                  {t("common.cancel")}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={creating || !newProjectName.trim()}
                  onClick={handleCreateSubmit}
                >
                  {creating ? t("common.creating") : t("common.create")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
