import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import {
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  getConfig,
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
  name: string;
  description: string;
  avatar: string;
  soul: string;
  model: string;
  temperature: string;
  maxIterations: string;
}

const emptyForm: AgentFormData = {
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
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [defaultModel, setDefaultModel] = useState("");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = create
  const [form, setForm] = useState<AgentFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const [data, config] = await Promise.all([listAgents(), getConfig()]);
      setAgents(data);
      setDefaultModel(config.model || "");
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
    setShowAdvanced(false);
  };

  const openEdit = (agent: AgentInfo) => {
    setEditingId(agent.id);
    setForm(agentToForm(agent));
    setModalOpen(true);
    setEmojiPickerOpen(false);
    // 如果有自定义高级设置，自动展开
    setShowAdvanced(!!(agent.temperature !== undefined || agent.maxIterations !== undefined));
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setEmojiPickerOpen(false);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError(t('agents.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload: AgentInfo = {
        id: editingId ?? form.name.trim().toLowerCase().replace(/\s+/g, "-"),
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
        <PageHeader>{t('agents.title')}</PageHeader>
        <div className="page-body">
          <div className="agents-loading">{t('agents.loadingAgents')}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader>{t('agents.title')}</PageHeader>
      <div className="page-body">
        {error && (
          <div className="agents-error">
            {error}
            <button onClick={() => setError(null)}>{t('common.dismiss')}</button>
          </div>
        )}

        {/* Toolbar */}
        <div className="agents-toolbar">
          <span className="agents-count">{t('agents.agentsCount', { count: agents.length })}</span>
          <button className="btn-primary agents-add-btn" onClick={openCreate}>
            {t('agents.newAgent')}
          </button>
        </div>

        {/* Agent cards */}
        {agents.length === 0 ? (
          <div className="agents-empty">{t('agents.noAgents')}</div>
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
                      title={t('common.delete')}
                    >
                      &times;
                    </button>
                  )}
                </div>
                <div className="agent-card-name">{agent.name}</div>
                <div className="agent-card-desc">
                  {agent.description || t('agents.noDescription')}
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
                <h3>{editingId ? t('agents.editAgent') : t('agents.createAgent')}</h3>
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
                      title={t('agents.pickAvatar')}
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
                      placeholder={t('agents.agentName')}
                      value={form.name}
                      onChange={(e) => updateField("name", e.target.value)}
                      className="agents-input agents-input-name"
                      autoFocus
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="agents-form-row">
                  <label className="agents-label">{t('agents.description')}</label>
                  <input
                    type="text"
                    placeholder={t('agents.descPlaceholder')}
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
                    {t('agents.soul')}
                    <span className="agents-label-hint">
                      {t('agents.soulHint')}
                    </span>
                  </label>
                  <textarea
                    placeholder={t('agents.soulPlaceholder')}
                    value={form.soul}
                    onChange={(e) => updateField("soul", e.target.value)}
                    className="agents-textarea"
                    rows={6}
                  />
                </div>

                {/* Model */}
                <div className="agents-form-row">
                  <label className="agents-label">{t('agents.model')}</label>
                  <input
                    type="text"
                    placeholder={defaultModel ? `Default: ${defaultModel}` : t('agents.useSystemDefault')}
                    value={form.model}
                    onChange={(e) => updateField("model", e.target.value)}
                    className="agents-input"
                  />
                </div>

                {/* Advanced toggle */}
                <button
                  type="button"
                  className="agents-advanced-toggle"
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  {showAdvanced ? "▾" : "▸"} {t('agents.advanced')}
                </button>

                {showAdvanced && (
                  <div className="agents-form-row agents-form-inline">
                    <div className="agents-form-field">
                      <label className="agents-label">
                        {t('agents.temperature')}
                        <span className="agents-label-hint">{t('agents.temperatureHint')}</span>
                      </label>
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
                    <div className="agents-form-field">
                      <label className="agents-label">
                        {t('agents.maxIterations')}
                        <span className="agents-label-hint">{t('agents.maxIterationsHint')}</span>
                      </label>
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
                )}
              </div>

              <div className="agents-modal-footer">
                <button className="agents-btn-cancel" onClick={closeModal}>
                  {t('common.cancel')}
                </button>
                <button
                  className="btn-primary agents-btn-save"
                  onClick={handleSave}
                  disabled={saving || !form.name.trim()}
                >
                  {saving ? t('common.saving') : editingId ? t('agents.saveChanges') : t('agents.createAgentBtn')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
