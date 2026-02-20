import { useState, useEffect, useCallback, useRef } from "react";
import { searchMemories, deleteMemory, type MemoryInfo } from "../api/client";
import "./MemoryPage.css";

const MEMORY_TYPES = ["all", "fact", "preference", "entity", "episodic"];

type SortMode = "importance" | "time";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function typeBadgeClass(type: string): string {
  switch (type) {
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
  const [memories, setMemories] = useState<MemoryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("importance");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMemories = useCallback(async (q: string, t: string) => {
    try {
      setLoading(true);
      const typeParam = t === "all" ? undefined : t;
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
      <div className="page-header">Memory</div>
      <div className="page-body">
        <div className="memory-toolbar">
          <div className="memory-search-row">
            <input
              type="text"
              className="memory-search-input"
              placeholder="Search memories..."
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
            />
            <select
              className="memory-type-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              {MEMORY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === "all" ? "All Types" : t}
                </option>
              ))}
            </select>
          </div>
          <div className="memory-sort-row">
            <span className="memory-sort-label">Sort by:</span>
            <button
              className={`btn-secondary memory-sort-btn ${sortMode === "importance" ? "active" : ""}`}
              onClick={() => setSortMode("importance")}
            >
              Importance
            </button>
            <button
              className={`btn-secondary memory-sort-btn ${sortMode === "time" ? "active" : ""}`}
              onClick={() => setSortMode("time")}
            >
              Time
            </button>
            <span className="memory-count">
              {memories.length} {memories.length === 1 ? "memory" : "memories"}
            </span>
          </div>
        </div>

        {error && <div className="memory-error">{error}</div>}

        {loading && memories.length === 0 && (
          <div className="memory-loading">Loading memories...</div>
        )}

        {!loading && !error && memories.length === 0 && (
          <div className="memory-empty">No memories found</div>
        )}

        <div className="memory-list">
          {sortedMemories.map((mem) => (
            <div key={mem.id} className="card memory-card">
              <div className="memory-card-top">
                <div className="memory-card-left">
                  <span className={typeBadgeClass(mem.type)}>{mem.type}</span>
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
                      <span className="memory-confirm-text">Delete?</span>
                      <button
                        className="btn-danger memory-delete-btn"
                        onClick={() => handleDelete(mem.id)}
                        disabled={deletingId === mem.id}
                      >
                        {deletingId === mem.id ? "..." : "Yes"}
                      </button>
                      <button
                        className="btn-secondary memory-cancel-btn"
                        onClick={cancelDelete}
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn-secondary memory-delete-btn"
                      onClick={() => handleDelete(mem.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <div className="memory-content">{mem.content}</div>
              <div className="memory-card-meta">
                <span>Created: {formatTime(mem.createdAt)}</span>
                <span>Accessed: {formatTime(mem.accessedAt)}</span>
                <span>Views: {mem.accessCount}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
