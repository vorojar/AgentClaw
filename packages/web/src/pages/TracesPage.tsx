import { useState, useEffect, useCallback } from "react";
import { getTraces, type TraceInfo, type TraceStep } from "../api/client";
import { getStoredApiKey } from "../auth";
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

/** Group raw steps into a structured timeline:
 *  - llm_call → standalone node
 *  - tool_call + tool_result → merged into one ToolNode */
interface LLMNode {
  kind: "llm";
  iteration: number;
  tokensIn: number;
  tokensOut: number;
}

interface ToolNode {
  kind: "tool";
  name: string;
  input?: Record<string, unknown>;
  content?: string;
  isError?: boolean;
}

type TimelineNode = LLMNode | ToolNode;

function buildTimeline(steps: TraceStep[]): TimelineNode[] {
  const nodes: TimelineNode[] = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    if (step.type === "llm_call") {
      nodes.push({
        kind: "llm",
        iteration: step.iteration ?? 0,
        tokensIn: step.tokensIn ?? 0,
        tokensOut: step.tokensOut ?? 0,
      });
      i++;
    } else if (step.type === "tool_call") {
      const node: ToolNode = {
        kind: "tool",
        name: step.name ?? "unknown",
        input: step.input,
      };
      // Look ahead for matching tool_result
      if (i + 1 < steps.length && steps[i + 1].type === "tool_result") {
        node.content = steps[i + 1].content;
        node.isError = steps[i + 1].isError;
        i += 2;
      } else {
        i++;
      }
      nodes.push(node);
    } else {
      // orphan tool_result
      nodes.push({
        kind: "tool",
        name: step.name ?? "unknown",
        content: step.content,
        isError: step.isError,
      });
      i++;
    }
  }
  return nodes;
}

function LLMStep({ node }: { node: LLMNode }) {
  return (
    <div className="tl-node tl-llm">
      <div className="tl-dot tl-dot-llm" />
      <div className="tl-body">
        <span className="tl-badge tl-badge-llm">LLM #{node.iteration}</span>
        <span className="tl-tokens">
          {formatNumber(node.tokensIn)}&uarr; {formatNumber(node.tokensOut)}
          &darr;
        </span>
      </div>
    </div>
  );
}

function ToolStep({ node }: { node: ToolNode }) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = node.input ? JSON.stringify(node.input) : "";
  const hasContent = !!(inputStr || node.content);
  const statusIcon =
    node.content !== undefined
      ? node.isError
        ? "\u2718"
        : "\u2714"
      : "\u23F3";

  return (
    <div className={`tl-node tl-tool ${node.isError ? "tl-tool-error" : ""}`}>
      <div
        className={`tl-dot ${node.isError ? "tl-dot-error" : "tl-dot-tool"}`}
      />
      <div className="tl-body">
        <div
          className="tl-tool-header"
          onClick={() => hasContent && setExpanded(!expanded)}
          style={{ cursor: hasContent ? "pointer" : "default" }}
        >
          <span className="tl-status-icon">{statusIcon}</span>
          <span className="tl-badge tl-badge-tool">{node.name}</span>
          {!expanded && inputStr && (
            <span className="tl-preview">
              {inputStr.length > 100
                ? inputStr.slice(0, 100) + "\u2026"
                : inputStr}
            </span>
          )}
          {hasContent && (
            <span className="tl-chevron">{expanded ? "\u25BC" : "\u25B6"}</span>
          )}
        </div>
        {expanded && (
          <div className="tl-detail">
            {inputStr && (
              <div className="tl-detail-section">
                <div className="tl-detail-label">Input</div>
                <pre className="tl-detail-pre">
                  {JSON.stringify(node.input, null, 2)}
                </pre>
              </div>
            )}
            {node.content && (
              <div className="tl-detail-section">
                <div className="tl-detail-label">
                  {node.isError ? "Error" : "Output"}
                </div>
                <pre
                  className={`tl-detail-pre ${node.isError ? "tl-detail-error" : ""}`}
                >
                  {node.content}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 复制 Trace API URL 到剪贴板 */
function CopyTraceButton({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      // 阻止事件冒泡，避免触发卡片展开/折叠
      e.stopPropagation();
      const apiKey = getStoredApiKey();
      const origin = window.location.origin;
      const url = apiKey
        ? `${origin}/api/traces/${traceId}?api_key=${encodeURIComponent(apiKey)}`
        : `${origin}/api/traces/${traceId}`;
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [traceId],
  );

  return (
    <button
      className="trace-copy-btn"
      onClick={handleCopy}
      title={copied ? "已复制" : "复制 Trace URL"}
    >
      {copied ? (
        // 已复制：对勾图标
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path
            d="M3 8.5L6.5 12L13 4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        // 复制图标
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect
            x="5"
            y="5"
            width="9"
            height="9"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      )}
    </button>
  );
}

function TraceCard({ trace }: { trace: TraceInfo }) {
  const [expanded, setExpanded] = useState(false);
  const steps = parseSteps(trace.steps);
  const timeline = buildTimeline(steps);

  return (
    <div className="card trace-card">
      <div className="trace-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="trace-card-left">
          <span className="trace-expand">{expanded ? "\u25BC" : "\u25B6"}</span>
          <span className="trace-input">{trace.userInput}</span>
        </div>
        <div className="trace-card-meta">
          {trace.error && (
            <span className="badge badge-error">{trace.error}</span>
          )}
          <span className="trace-tokens">
            {formatNumber(trace.tokensIn + trace.tokensOut)} tok
          </span>
          <span className="trace-duration">
            {formatDuration(trace.durationMs)}
          </span>
          <code className="model-name">{trace.model ?? "\u2014"}</code>
          <span className="trace-time">{formatTime(trace.createdAt)}</span>
          <CopyTraceButton traceId={trace.id} />
        </div>
      </div>

      {expanded && (
        <div className="trace-card-body">
          {/* Timeline */}
          <div className="tl-timeline">
            {timeline.map((node, i) =>
              node.kind === "llm" ? (
                <LLMStep key={i} node={node} />
              ) : (
                <ToolStep key={i} node={node} />
              ),
            )}
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
