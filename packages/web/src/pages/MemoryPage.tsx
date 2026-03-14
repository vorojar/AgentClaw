import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { searchMemories, deleteMemory, type MemoryInfo } from "../api/client";
import { formatDateTime } from "../utils/format";
import "./MemoryPage.css";

const MEMORY_TYPES = [
  "all",
  "identity",
  "fact",
  "preference",
  "entity",
  "episodic",
];

type SortMode = "importance" | "time";

function typeBadgeClass(type: string): string {
  switch (type) {
    case "identity":
      return "badge badge-accent";
    case "fact":
      return "badge badge-info";
    case "preference":
      return "badge badge-warning";
    case "entity":
      return "badge badge-success";
    case "episodic":
      return "badge badge-error";
    default:
      return "badge badge-muted";
  }
}

function renderImportance(importance: number): string {
  const stars = Math.min(Math.max(Math.round(importance), 0), 5);
  return "\u2605".repeat(stars) + "\u2606".repeat(5 - stars);
}

export function MemoryPage() {
  const { t } = useTranslation();
  const [memories, setMemories] = useState<MemoryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("importance");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMemories = useCallback(async (q: string, tp: string) => {
    try {
      setLoading(true);
      const typeParam = tp === "all" ? undefined : tp;
      const data = await searchMemories(q || undefined, typeParam, 100);
      setMemories(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemories(query, typeFilter);
  }, [typeFilter, fetchMemories]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      fetchMemories(value, typeFilter);
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    try {
      setDeletingId(id);
      await deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete memory");
    } finally {
      setDeletingId(null);
    }
  };

  const cancelDelete = () => {
    setConfirmDeleteId(null);
  };

  const sortedMemories = [...memories].sort((a, b) => {
    if (sortMode === "importance") {
      return b.importance - a.importance;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <>
      <PageHeader>{t("memory.title")}</PageHeader>
      <div className="page-body">
        <div className="memory-toolbar">
          <div className="memory-search-row">
            <input
              type="text"
              className="memory-search-input"
              placeholder={t("memory.searchPlaceholder")}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
            />
            <select
              className="memory-type-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              {MEMORY_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {tp === "all"
                    ? t("memory.allTypes")
                    : t(`memory.types.${tp}`, tp)}
                </option>
              ))}
            </select>
          </div>
          <div className="memory-sort-row">
            <span className="memory-sort-label">{t("memory.sortBy")}</span>
            <button
              className={`btn-secondary memory-sort-btn ${sortMode === "importance" ? "active" : ""}`}
              onClick={() => setSortMode("importance")}
            >
              {t("memory.importance")}
            </button>
            <button
              className={`btn-secondary memory-sort-btn ${sortMode === "time" ? "active" : ""}`}
              onClick={() => setSortMode("time")}
            >
              {t("memory.time")}
            </button>
            <span className="memory-count">
              {memories.length === 1
                ? t("memory.memoryCount", { count: memories.length })
                : t("memory.memoriesCount", { count: memories.length })}
            </span>
          </div>
        </div>

        {error && <div className="memory-error">{error}</div>}

        {loading && memories.length === 0 && (
          <div className="memory-loading">{t("memory.loadingMemories")}</div>
        )}

        {!loading && !error && memories.length === 0 && (
          <div className="memory-empty">{t("memory.noMemories")}</div>
        )}

        <div className="memory-list">
          {sortedMemories.map((mem) => (
            <div key={mem.id} className="card memory-card">
              <div className="memory-card-top">
                <div className="memory-card-left">
                  <span className={typeBadgeClass(mem.type)}>
                    {t(`memory.types.${mem.type}`, mem.type)}
                  </span>
                  <span
                    className="memory-importance"
                    title={`Importance: ${mem.importance}`}
                  >
                    {renderImportance(mem.importance)}
                  </span>
                </div>
                <div className="memory-card-actions">
                  {confirmDeleteId === mem.id ? (
                    <span className="memory-confirm-delete">
                      <span className="memory-confirm-text">
                        {t("memory.deleteConfirm")}
                      </span>
                      <button
                        className="btn-danger memory-delete-btn"
                        onClick={() => handleDelete(mem.id)}
                        disabled={deletingId === mem.id}
                      >
                        {deletingId === mem.id ? "..." : t("common.yes")}
                      </button>
                      <button
                        className="btn-secondary memory-cancel-btn"
                        onClick={cancelDelete}
                      >
                        {t("common.no")}
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn-secondary memory-delete-btn"
                      onClick={() => handleDelete(mem.id)}
                    >
                      {t("common.delete")}
                    </button>
                  )}
                </div>
              </div>
              <div className="memory-content">{mem.content}</div>
              <div className="memory-card-meta">
                <span>
                  {t("memory.created")} {formatDateTime(mem.createdAt)}
                </span>
                <span>
                  {t("memory.accessed")} {formatDateTime(mem.accessedAt)}
                </span>
                <span>
                  {t("memory.views")} {mem.accessCount}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
