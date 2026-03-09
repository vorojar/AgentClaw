import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getProject,
  listSessions,
  closeSession,
  type ProjectInfo,
  type SessionInfo,
} from "../api/client";
import { useSession } from "../components/SessionContext";
import { IconArrowLeft, IconTrash, IconChat } from "../components/Icons";
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
  const { setPendingProjectId } = useSession();

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
        <button
          className="project-detail-back"
          onClick={() => navigate("/projects")}
        >
          <IconArrowLeft size={16} /> All Projects
        </button>
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

      <button
        className="project-detail-back"
        onClick={() => navigate("/projects")}
      >
        <IconArrowLeft size={16} /> All Projects
      </button>

      <div className="project-detail-header">
        <div className="project-detail-title-row">
          <span
            className="project-detail-dot"
            style={{ background: project.color }}
          />
          <h1>{project.name}</h1>
        </div>
        {project.description && (
          <p className="project-detail-desc">{project.description}</p>
        )}
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
