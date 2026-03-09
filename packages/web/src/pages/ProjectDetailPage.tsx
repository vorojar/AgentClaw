import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import {
  getProject,
  updateProject,
  listSessions,
  closeSession,
  createSession,
  type ProjectInfo,
  type SessionInfo,
} from "../api/client";
import { useSession } from "../components/SessionContext";
import { IconTrash, IconChat, IconEdit } from "../components/Icons";
import "./ProjectDetailPage.css";

function timeAgo(
  iso: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("time.justNow");
    if (mins < 60) return t("time.minsAgo", { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("time.hoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 30) return t("time.daysAgo", { count: days });
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}

export function ProjectDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { updateProjectLocally, refreshSessions } = useSession();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [p, s] = await Promise.all([getProject(id), listSessions(id)]);
      setProject(p);
      setSessions(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleNewChat = async () => {
    if (!id) return;
    try {
      const session = await createSession(undefined, id);
      refreshSessions();
      navigate(`/chat/${session.id}`);
    } catch {
      /* ignore */
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await closeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRename = async () => {
    if (!id || !renameValue.trim() || !project) return;
    try {
      const updated = await updateProject(id, { name: renameValue.trim() });
      setProject(updated);
      updateProjectLocally(updated);
      setRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return (
      <div className="project-detail">
        <div className="project-detail-loading">{t("common.loading")}</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="project-detail">
        <div className="project-detail-error">
          {error || t("project.notFound")}
        </div>
      </div>
    );
  }

  return (
    <div className="project-detail">
      {error && (
        <div className="project-detail-toast">
          <span>{error}</span>
          <button onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      <div className="project-detail-header">
        <div className="project-detail-title-row">
          {renaming ? (
            <input
              autoFocus
              className="project-detail-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              onBlur={handleRename}
            />
          ) : (
            <>
              <h1>{project.name}</h1>
              <button
                className="project-detail-rename-btn"
                onClick={() => {
                  setRenameValue(project.name);
                  setRenaming(true);
                }}
                title={t("common.rename")}
              >
                <IconEdit size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="project-detail-input" onClick={handleNewChat}>
        <IconChat size={16} />
        <span className="project-detail-input-placeholder">
          {t("project.newChatIn", { name: project.name })}
        </span>
      </div>

      <div className="project-detail-sessions">
        <div className="project-detail-sessions-header">
          <span>{t("project.sessionsCount", { count: sessions.length })}</span>
        </div>
        {sessions.length === 0 ? (
          <div className="project-detail-empty">{t("project.noSessions")}</div>
        ) : (
          <div className="project-detail-list">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="project-session-row"
                onClick={() => navigate(`/chat/${s.id}`)}
              >
                <div className="project-session-content">
                  <span className="project-session-title">
                    {s.title || t("project.newSession")}
                  </span>
                  {s.preview && (
                    <span className="project-session-preview">{s.preview}</span>
                  )}
                </div>
                <div className="project-session-meta">
                  <span className="project-session-time">
                    {timeAgo(s.lastActiveAt, t)}
                  </span>
                  <button
                    className="project-session-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSession(s.id);
                    }}
                    title={t("common.delete")}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
