import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import {
  listSkills,
  updateSkillEnabled,
  importSkillFromGithub,
  importSkillFromZip,
  deleteSkill,
  type SkillInfo,
} from "../api/client";
import "./SkillsPage.css";

export function SkillsPage() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Import
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);

  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listSkills();
      setSkills(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleToggle = async (skill: SkillInfo) => {
    try {
      await updateSkillEnabled(skill.id, !skill.enabled);
      setSkills((prev) =>
        prev.map((s) =>
          s.id === skill.id ? { ...s, enabled: !s.enabled } : s,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle skill");
    }
  };

  const handleDelete = async (skill: SkillInfo) => {
    if (!confirm(`Delete skill "${skill.name}"?`)) return;
    try {
      await deleteSkill(skill.id);
      setSkills((prev) => prev.filter((s) => s.id !== skill.id));
    } catch (err) {
      setError(
        "Delete failed: " + (err instanceof Error ? err.message : String(err)),
      );
    }
  };

  const handleImportGithub = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    try {
      await importSkillFromGithub(importUrl.trim());
      setImportUrl("");
      setImportOpen(false);
      const updated = await listSkills();
      setSkills(updated);
    } catch (err) {
      setError(
        "Import failed: " + (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setImporting(false);
    }
  };

  const handleImportZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      await importSkillFromZip(file);
      setImportOpen(false);
      const updated = await listSkills();
      setSkills(updated);
    } catch (err) {
      setError(
        "Import failed: " + (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const filtered = search
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase()),
      )
    : skills;

  const enabledCount = skills.filter((s) => s.enabled).length;

  if (loading) {
    return (
      <>
        <PageHeader>{t("skills.title")}</PageHeader>
        <div className="page-body">
          <div className="skills-page-loading">{t("skills.loadingSkills")}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader>{t("skills.title")}</PageHeader>
      <div className="page-body">
        {error && (
          <div className="skills-page-error">
            {error}
            <button onClick={() => setError(null)}>
              {t("common.dismiss")}
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="skills-toolbar">
          <div className="skills-toolbar-left">
            <input
              type="text"
              className="skills-search"
              placeholder={t("skills.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="skills-summary">
              {t("skills.enabledCount", {
                enabled: enabledCount,
                total: skills.length,
              })}
            </span>
          </div>
          <button
            className="btn-primary skills-import-btn"
            onClick={() => setImportOpen((v) => !v)}
          >
            {importOpen ? t("common.cancel") : t("skills.import")}
          </button>
        </div>

        {/* Import panel */}
        {importOpen && (
          <div className="skills-import-panel">
            <div className="skills-import-row">
              <input
                type="text"
                placeholder={t("skills.githubPlaceholder")}
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleImportGithub()}
              />
              <button
                onClick={handleImportGithub}
                disabled={importing || !importUrl.trim()}
              >
                {importing ? t("skills.importing") : t("skills.clone")}
              </button>
            </div>
            <div className="skills-import-row">
              <label className="skills-upload-btn">
                {t("skills.uploadZip")}
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleImportZip}
                  hidden
                />
              </label>
            </div>
          </div>
        )}

        {/* Card grid */}
        {filtered.length === 0 ? (
          <div className="skills-page-empty">
            {search ? t("skills.noMatching") : t("skills.noSkills")}
          </div>
        ) : (
          <div className="skills-grid">
            {filtered.map((skill) => (
              <div
                key={skill.id}
                className={`skill-card${skill.enabled ? "" : " skill-card-disabled"}`}
              >
                <div className="skill-card-header">
                  <span className="skill-card-name">{skill.name}</span>
                  <div className="skill-card-actions">
                    <span
                      className={`skill-toggle ${skill.enabled ? "enabled" : "disabled"}`}
                      onClick={() => handleToggle(skill)}
                    >
                      <span className="skill-toggle-knob" />
                    </span>
                    <button
                      className="skill-card-delete"
                      onClick={() => handleDelete(skill)}
                      title={t("skills.deleteSkill")}
                    >
                      &times;
                    </button>
                  </div>
                </div>
                <div className="skill-card-desc">{skill.description}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
