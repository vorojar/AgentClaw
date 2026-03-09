import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { IconEdit, IconTrash, IconX } from "../components/Icons";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  type ProjectInfo,
} from "../api/client";
import "./ProjectsPage.css";

const COLOR_PRESETS = [
  "#6B7F5E",
  "#5E7F7F",
  "#7F5E6B",
  "#5E6B7F",
  "#7F6B5E",
  "#8B6BAE",
  "#AE6B8B",
  "#6BAE8B",
  "#AE8B6B",
  "#4A90D9",
  "#D94A4A",
  "#D9A34A",
];

interface FormData {
  name: string;
  description: string;
  instructions: string;
  color: string;
}

const emptyForm: FormData = {
  name: "",
  description: "",
  instructions: "",
  color: COLOR_PRESETS[0],
};

function projectToForm(p: ProjectInfo): FormData {
  return {
    name: p.name,
    description: p.description || "",
    instructions: p.instructions || "",
    color: p.color || COLOR_PRESETS[0],
  };
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { id: editIdFromRoute } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const list = await listProjects();
      setProjects(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Open edit modal when navigated to /projects/:id/edit
  useEffect(() => {
    if (editIdFromRoute && projects.length > 0) {
      const target = projects.find((p) => p.id === editIdFromRoute);
      if (target) {
        openEdit(target);
      }
    }
  }, [editIdFromRoute, projects]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open create modal when ?new=1
  useEffect(() => {
    if (searchParams.get("new") === "1" && !loading) {
      openCreate();
      navigate("/projects", { replace: true });
    }
  }, [searchParams, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (p: ProjectInfo) => {
    setEditingId(p.id);
    setForm(projectToForm(p));
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await updateProject(editingId, {
          name: form.name.trim(),
          description: form.description.trim(),
          instructions: form.instructions.trim(),
          color: form.color,
        });
        setProjects((prev) =>
          prev.map((p) => (p.id === editingId ? updated : p)),
        );
      } else {
        const created = await createProject({
          name: form.name.trim(),
          description: form.description.trim(),
          instructions: form.instructions.trim(),
          color: form.color,
        });
        setProjects((prev) => [created, ...prev]);
      }
      setModalOpen(false);
      if (editIdFromRoute) navigate("/projects", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <PageHeader>
        <h1>Projects</h1>
      </PageHeader>
      <div className="page-body">
        {error && (
          <div className="projects-error">
            <span>{error}</span>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <div className="projects-toolbar">
          <span className="projects-count">
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </span>
          <button
            className="btn btn-primary projects-add-btn"
            onClick={openCreate}
          >
            + New Project
          </button>
        </div>

        {loading ? (
          <div className="projects-loading">Loading...</div>
        ) : projects.length === 0 ? (
          <div className="projects-empty">
            No projects yet. Create one to organize your conversations.
          </div>
        ) : (
          <div className="projects-grid">
            {projects.map((p) => (
              <div
                key={p.id}
                className="project-card"
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                <div className="project-card-top">
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span
                      className="project-card-color"
                      style={{ background: p.color }}
                    />
                    <h3 className="project-card-name">{p.name}</h3>
                  </div>
                  <div className="project-card-actions">
                    <button
                      title="Edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(p);
                      }}
                    >
                      <IconEdit size={14} />
                    </button>
                    <button
                      className="delete-btn"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(p.id);
                      }}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
                {p.description && (
                  <div className="project-card-desc">{p.description}</div>
                )}
                <div className="project-card-meta">
                  <span>
                    {p.sessionCount} conversation
                    {p.sessionCount !== 1 ? "s" : ""}
                  </span>
                  <span>Updated {formatDate(p.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Modal */}
        {modalOpen && (
          <div
            className="project-modal-overlay"
            onClick={() => setModalOpen(false)}
          >
            <div className="project-modal" onClick={(e) => e.stopPropagation()}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h2>{editingId ? "Edit Project" : "New Project"}</h2>
                <button
                  className="btn-icon"
                  onClick={() => setModalOpen(false)}
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
                <label>Name</label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g. Write Articles"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSave();
                    }
                  }}
                />
              </div>

              <div className="project-modal-field">
                <label>Description</label>
                <input
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder="Short description (optional)"
                />
              </div>

              <div className="project-modal-field">
                <label>Color</label>
                <div className="project-color-picker">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      className={`project-color-swatch${form.color === c ? " active" : ""}`}
                      style={{ background: c }}
                      onClick={() => setForm((f) => ({ ...f, color: c }))}
                    />
                  ))}
                </div>
              </div>

              <div className="project-modal-field">
                <label>Instructions</label>
                <textarea
                  className="instructions-textarea"
                  value={form.instructions}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, instructions: e.target.value }))
                  }
                  placeholder="Custom instructions for conversations in this project..."
                />
              </div>

              <div className="project-modal-buttons">
                <button
                  className="btn btn-secondary"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={saving || !form.name.trim()}
                  onClick={handleSave}
                >
                  {saving ? "Saving..." : editingId ? "Save" : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
