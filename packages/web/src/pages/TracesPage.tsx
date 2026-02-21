import { useState, useEffect, useCallback } from "react";
import {
  getTraces,
  type TraceInfo,
  type TraceStep,
} from "../api/client";
import "./TracesPage.css";

const PAGE_SIZE = 20;

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function parseSteps(steps: TraceStep[] | string): TraceStep[] {
  if (typeof steps === "string") {
    try {
      return JSON.parse(steps);
    } catch {
      return [];
    }
  }
  return steps ?? [];
}

function StepRow({ step }: { step: TraceStep }) {
  const [expanded, setExpanded] = useState(false);

  if (step.type === "llm_call") {
    return (
      <div className="trace-step trace-step-llm">
        <span className="step-icon">LLM</span>
        <span className="step-detail">
          {formatNumber(step.tokensIn ?? 0)} in / {formatNumber(step.tokensOut ?? 0)} out
        </span>
      </div>
    );
  }

  if (step.type === "tool_call") {
    const inputStr = step.input ? JSON.stringify(step.input) : "";
    return (
      <div className="trace-step trace-step-call">
        <span className="step-icon step-icon-call" onClick={() => inputStr && setExpanded(!expanded)}>
          {expanded ? "\u25BC" : "\u25B6"} {step.name}
        </span>
        {!expanded && inputStr.length > 0 && (
          <span className="step-preview">{inputStr.slice(0, 80)}{inputStr.length > 80 ? "..." : ""}</span>
        )}
        {expanded && (
          <pre className="step-expanded">{JSON.stringify(step.input, null, 2)}</pre>
        )}
      </div>
    );
  }

  if (step.type === "tool_result") {
    const content = step.content ?? "";
    return (
      <div className={`trace-step trace-step-result ${step.isError ? "trace-step-error" : ""}`}>
        <span
          className="step-icon step-icon-result"
          onClick={() => content && setExpanded(!expanded)}
        >
          {step.isError ? "\u2717" : "\u2713"} {step.name}
        </span>
        {!expanded && content.length > 0 && (
          <span className="step-preview">{content.slice(0, 100)}{content.length > 100 ? "..." : ""}</span>
        )}
        {expanded && <pre className="step-expanded">{content}</pre>}
      </div>
    );
  }

  return null;
}

function TraceCard({ trace }: { trace: TraceInfo }) {
  const [expanded, setExpanded] = useState(false);
  const steps = parseSteps(trace.steps);
  const skillMatch = trace.skillMatch
    ? (() => { try { return JSON.parse(trace.skillMatch); } catch { return null; } })()
    : null;

  return (
    <div className="card trace-card">
      <div className="trace-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="trace-card-left">
          <span className="trace-expand">{expanded ? "\u25BC" : "\u25B6"}</span>
          <span className="trace-input">{trace.userInput}</span>
        </div>
        <div className="trace-card-meta">
          {skillMatch && (
            <span className="badge badge-info">{skillMatch.name}</span>
          )}
          {trace.error && (
            <span className="badge badge-error">{trace.error}</span>
          )}
          <span className="trace-tokens">
            {formatNumber(trace.tokensIn + trace.tokensOut)} tok
          </span>
          <span className="trace-duration">{formatDuration(trace.durationMs)}</span>
          <code className="model-name">{trace.model ?? "—"}</code>
          <span className="trace-time">{formatTime(trace.createdAt)}</span>
        </div>
      </div>

      {expanded && (
        <div className="trace-card-body">
          {/* Steps */}
          <div className="trace-steps">
            {steps.map((step, i) => (
              <StepRow key={i} step={step} />
            ))}
          </div>

          {/* Response */}
          {trace.response && (
            <div className="trace-response">
              <div className="trace-section-label">Response</div>
              <pre className="trace-response-text">{trace.response}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TracesPage() {
  const [items, setItems] = useState<TraceInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (p: number) => {
    try {
      setLoading(true);
      setError(null);
      const res = await getTraces(PAGE_SIZE, p * PAGE_SIZE);
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load traces");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(page);
  }, [page, fetchPage]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page-header">Traces</div>
      <div className="page-body">
        {error && <div className="traces-error">{error}</div>}

        <div className="traces-toolbar">
          <span className="traces-total">{formatNumber(total)} traces</span>
          <div className="traces-pager">
            <button
              className="btn-secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </button>
            <span className="traces-page-info">
              {page + 1} / {totalPages}
            </span>
            <button
              className="btn-secondary"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>

        {loading ? (
          <div className="traces-loading">Loading...</div>
        ) : items.length === 0 ? (
          <div className="traces-empty">No traces yet</div>
        ) : (
          <div className="traces-list">
            {items.map((t) => (
              <TraceCard key={t.id} trace={t} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
