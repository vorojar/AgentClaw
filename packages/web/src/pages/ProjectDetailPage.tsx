import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getProject,
  updateProject,
  listSessions,
  createSession,
  closeSession,
  type ProjectInfo,
  type SessionInfo,
} from "../api/client";
import { useSession } from "../components/SessionContext";
import {
  IconArrowLeft,
  IconEdit,
  IconX,
  IconTrash,
  IconChat,
} from "../components/Icons";
import "./ProjectDetailPage.css";

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

function timeAgo(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { handleSelectSession, setPendingProjectId } = useSession();

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Instructions editing
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState("");

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
      const ns = await createSession(undefined, id);
      // Navigate to the chat page with that session
      handleSelectSession(ns.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await closeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveInstructions = async () => {
    if (!id || !project) return;
    try {
      const updated = await updateProject(id, {
        instructions: instructionsDraft,
      });
      setProject(updated);
      setEditingInstructions(false);
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
          className="btn btn-secondary"
          onClick={() => navigate("/projects")}
        >
          Back to Projects
        </button>
      </div>
    );
  }

  return (
    <div className="project-detail">
      {error && (
        <div className="project-detail-toast">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <IconX size={14} />
          </button>
        </div>
      )}

      <div className="project-detail-layout">
        {/* Left column */}
        <div className="project-detail-left">
          <button
            className="project-detail-back"
            onClick={() => navigate("/projects")}
          >
            <IconArrowLeft size={16} />
            <span>All Projects</span>
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

          {/* New conversation button */}
          <button className="project-detail-new-chat" onClick={handleNewChat}>
            <IconChat size={16} />
            <span>New conversation</span>
          </button>

          {/* Conversations list */}
          <div className="project-detail-sessions">
            <h3>
              Conversations
              <span className="project-detail-sessions-count">
                {sessions.length}
              </span>
            </h3>
            {sessions.length === 0 ? (
              <div className="project-detail-sessions-empty">
                No conversations yet. Start one above.
              </div>
            ) : (
              <div className="project-detail-sessions-list">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="project-session-item"
                    onClick={() => handleSelectSession(s.id)}
                  >
                    <div className="project-session-info">
                      <span className="project-session-title">
                        {formatSessionLabel(s)}
                      </span>
                      <span className="project-session-time">
                        {timeAgo(s.lastActiveAt)}
                      </span>
                    </div>
                    <button
                      className="project-session-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(s.id);
                      }}
                      title="Delete"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="project-detail-right">
          {/* Instructions card */}
          <div className="project-detail-card">
            <div className="project-detail-card-header">
              <h3 style={{ color: "var(--accent)" }}>Instructions</h3>
              {!editingInstructions && (
                <button
                  className="project-detail-card-action"
                  onClick={() => {
                    setInstructionsDraft(project.instructions || "");
                    setEditingInstructions(true);
                  }}
                  title="Edit"
                >
                  <IconEdit size={14} />
                </button>
              )}
            </div>
            {editingInstructions ? (
              <div className="project-detail-instructions-edit">
                <textarea
                  autoFocus
                  value={instructionsDraft}
                  onChange={(e) => setInstructionsDraft(e.target.value)}
                  placeholder="Add instructions to customize how the AI responds in this project..."
                />
                <div className="project-detail-instructions-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEditingInstructions(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleSaveInstructions}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : project.instructions ? (
              <pre className="project-detail-instructions-text">
                {project.instructions}
              </pre>
            ) : (
              <div className="project-detail-card-empty">
                Add instructions to customize how the AI responds in this
                project.
              </div>
            )}
          </div>

          {/* Project info card */}
          <div className="project-detail-card">
            <div className="project-detail-card-header">
              <h3>Project Info</h3>
              <button
                className="project-detail-card-action"
                onClick={() => navigate(`/projects/${id}/edit`)}
                title="Edit project"
              >
                <IconEdit size={14} />
              </button>
            </div>
            <div className="project-detail-info-grid">
              <div className="project-detail-info-item">
                <span className="project-detail-info-label">Color</span>
                <span
                  className="project-detail-info-color"
                  style={{ background: project.color }}
                />
              </div>
              <div className="project-detail-info-item">
                <span className="project-detail-info-label">Conversations</span>
                <span>{sessions.length}</span>
              </div>
              <div className="project-detail-info-item">
                <span className="project-detail-info-label">Created</span>
                <span>{new Date(project.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
