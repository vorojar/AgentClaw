import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import {
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  type AgentInfo,
} from "../api/client";
import "./AgentsPage.css";

const EMOJI_PRESETS = [
  "🤖",
  "💻",
  "✍️",
  "🔬",
  "🎨",
  "📊",
  "🧠",
  "🎯",
  "🌐",
  "📚",
  "🛠️",
  "🎭",
  "🏢",
  "💡",
  "🔥",
];

interface AgentFormData {
  id: string;
  name: string;
  description: string;
  avatar: string;
  soul: string;
  model: string;
  temperature: string;
  maxIterations: string;
}

const emptyForm: AgentFormData = {
  id: "",
  name: "",
  description: "",
  avatar: "🤖",
  soul: "",
  model: "",
  temperature: "",
  maxIterations: "",
};

function agentToForm(a: AgentInfo): AgentFormData {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    avatar: a.avatar || "🤖",
    soul: a.soul ?? "",
    model: a.model ?? "",
    temperature: a.temperature !== undefined ? String(a.temperature) : "",
    maxIterations: a.maxIterations !== undefined ? String(a.maxIterations) : "",
  };
}

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = create
  const [form, setForm] = useState<AgentFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listAgents();
      setAgents(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
    setEmojiPickerOpen(false);
  };

  const openEdit = (agent: AgentInfo) => {
    setEditingId(agent.id);
    setForm(agentToForm(agent));
    setModalOpen(true);
    setEmojiPickerOpen(false);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setEmojiPickerOpen(false);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload: AgentInfo = {
        id: editingId ?? (form.id.trim().toLowerCase().replace(/\s+/g, "-") || form.name.trim().toLowerCase().replace(/\s+/g, "-")),
        name: form.name.trim(),
        description: form.description.trim(),
        avatar: form.avatar,
        soul: form.soul,
        model: form.model || undefined,
        temperature: form.temperature ? Number(form.temperature) : undefined,
        maxIterations: form.maxIterations
          ? Number(form.maxIterations)
          : undefined,
      };
      if (editingId) {
        await updateAgent(editingId, payload);
      } else {
        await createAgent(payload);
      }
      closeModal();
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (agent: AgentInfo) => {
    if (agent.id === "default") return;
    if (!confirm(`Delete agent "${agent.name}"?`)) return;
    try {
      await deleteAgent(agent.id);
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete agent",
      );
    }
  };

  const updateField = (field: keyof AgentFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <>
        <PageHeader>Agents</PageHeader>
        <div className="page-body">
          <div className="agents-loading">Loading agents...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader>Agents</PageHeader>
      <div className="page-body">
        {error && (
          <div className="agents-error">
            {error}
            <button onClick={() => setError(null)}>dismiss</button>
          </div>
        )}

        {/* Toolbar */}
        <div className="agents-toolbar">
          <span className="agents-count">{agents.length} agents</span>
          <button className="btn-primary agents-add-btn" onClick={openCreate}>
            + New Agent
          </button>
        </div>

        {/* Agent cards */}
        {agents.length === 0 ? (
          <div className="agents-empty">No agents configured</div>
        ) : (
          <div className="agents-grid">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className={`agent-card${agent.id === "default" ? " agent-card-default" : ""}`}
                onClick={() => openEdit(agent)}
              >
                <div className="agent-card-top">
                  <span className="agent-card-avatar">
                    {agent.avatar || "🤖"}
                  </span>
                  {agent.id !== "default" && (
                    <button
                      className="agent-card-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(agent);
                      }}
                      title="Delete"
                    >
                      &times;
                    </button>
                  )}
                </div>
                <div className="agent-card-name">{agent.name}</div>
                <div className="agent-card-desc">
                  {agent.description || "No description"}
                </div>
                {agent.model && (
                  <code className="agent-card-model">{agent.model}</code>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Modal */}
        {modalOpen && (
          <div className="agents-modal-backdrop" onClick={closeModal}>
            <div
              className="agents-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="agents-modal-header">
                <h3>{editingId ? "Edit Agent" : "New Agent"}</h3>
                <button className="agents-modal-close" onClick={closeModal}>
                  &times;
                </button>
              </div>

              <div className="agents-modal-body">
                {/* Avatar + Name row */}
                <div className="agents-form-row agents-form-identity">
                  <div className="agents-avatar-picker">
                    <button
                      className="agents-avatar-btn"
                      onClick={() => setEmojiPickerOpen((v) => !v)}
                      title="Pick avatar"
                    >
                      {form.avatar || "🤖"}
                    </button>
                    {emojiPickerOpen && (
                      <div className="agents-emoji-grid">
                        {EMOJI_PRESETS.map((e) => (
                          <button
                            key={e}
                            className={`agents-emoji-item${form.avatar === e ? " active" : ""}`}
                            onClick={() => {
                              updateField("avatar", e);
                              setEmojiPickerOpen(false);
                            }}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="agents-form-name-group">
                    <input
                      type="text"
                      placeholder="Agent Name"
                      value={form.name}
                      onChange={(e) => updateField("name", e.target.value)}
                      className="agents-input agents-input-name"
                      autoFocus
                    />
                    {!editingId && (
                      <input
                        type="text"
                        placeholder="ID (auto-generated from name)"
                        value={form.id}
                        onChange={(e) => updateField("id", e.target.value)}
                        className="agents-input agents-input-id"
                      />
                    )}
                  </div>
                </div>

                {/* Description */}
                <div className="agents-form-row">
                  <label className="agents-label">Description</label>
                  <input
                    type="text"
                    placeholder="Brief description of this agent's role"
                    value={form.description}
                    onChange={(e) =>
                      updateField("description", e.target.value)
                    }
                    className="agents-input"
                  />
                </div>

                {/* Soul */}
                <div className="agents-form-row">
                  <label className="agents-label">
                    Soul
                    <span className="agents-label-hint">
                      Personality & behavior instructions
                    </span>
                  </label>
                  <textarea
                    placeholder="You are a helpful coding assistant who excels at..."
                    value={form.soul}
                    onChange={(e) => updateField("soul", e.target.value)}
                    className="agents-textarea"
                    rows={6}
                  />
                </div>

                {/* Model + Temperature row */}
                <div className="agents-form-row agents-form-inline">
                  <div className="agents-form-field">
                    <label className="agents-label">Model</label>
                    <input
                      type="text"
                      placeholder="e.g. claude-sonnet-4-20250514"
                      value={form.model}
                      onChange={(e) => updateField("model", e.target.value)}
                      className="agents-input"
                    />
                  </div>
                  <div className="agents-form-field agents-form-field-sm">
                    <label className="agents-label">Temperature</label>
                    <input
                      type="number"
                      placeholder="0.7"
                      min="0"
                      max="2"
                      step="0.1"
                      value={form.temperature}
                      onChange={(e) =>
                        updateField("temperature", e.target.value)
                      }
                      className="agents-input"
                    />
                  </div>
                  <div className="agents-form-field agents-form-field-sm">
                    <label className="agents-label">Max Iterations</label>
                    <input
                      type="number"
                      placeholder="25"
                      min="1"
                      max="100"
                      value={form.maxIterations}
                      onChange={(e) =>
                        updateField("maxIterations", e.target.value)
                      }
                      className="agents-input"
                    />
                  </div>
                </div>
              </div>

              <div className="agents-modal-footer">
                <button className="agents-btn-cancel" onClick={closeModal}>
                  Cancel
                </button>
                <button
                  className="btn-primary agents-btn-save"
                  onClick={handleSave}
                  disabled={saving || !form.name.trim()}
                >
                  {saving ? "Saving..." : editingId ? "Save Changes" : "Create Agent"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
