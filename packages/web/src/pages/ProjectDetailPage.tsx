import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getProject,
  updateProject,
  listSessions,
  closeSession,
  type ProjectInfo,
  type SessionInfo,
} from "../api/client";
import { useSession } from "../components/SessionContext";
import { IconTrash, IconChat, IconEdit } from "../components/Icons";
import "./ProjectDetailPage.css";

function timeAgo(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "\u521a\u521a";
    if (mins < 60) return `${mins}\u5206\u949f\u524d`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}\u5c0f\u65f6\u524d`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}\u5929\u524d`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setPendingProjectId, updateProjectLocally, refreshSessions } =
    useSession();
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

  const handleNewChat = () => {
    if (!id) return;
    setPendingProjectId(id);
    navigate("/chat");
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
        <div className="project-detail-loading">Loading...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="project-detail">
        <div className="project-detail-error">
          {error || "Project not found"}
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
                title="Rename"
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
          {"\u5728\u300c"}
          {project.name}
          {"\u300d\u4e2d\u65b0\u5efa\u804a\u5929"}
        </span>
      </div>

      <div className="project-detail-sessions">
        <div className="project-detail-sessions-header">
          <span>
            {sessions.length} {"\u4e2a\u4f1a\u8bdd"}
          </span>
        </div>
        {sessions.length === 0 ? (
          <div className="project-detail-empty">
            {
              "\u8fd8\u6ca1\u6709\u4f1a\u8bdd\uff0c\u70b9\u51fb\u4e0a\u65b9\u5f00\u59cb\u804a\u5929"
            }
          </div>
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
                    {s.title || "\u65b0\u4f1a\u8bdd"}
                  </span>
                  {s.preview && (
                    <span className="project-session-preview">{s.preview}</span>
                  )}
                </div>
                <div className="project-session-meta">
                  <span className="project-session-time">
                    {timeAgo(s.lastActiveAt)}
                  </span>
                  <button
                    className="project-session-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSession(s.id);
                    }}
                    title={"\u5220\u9664"}
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
