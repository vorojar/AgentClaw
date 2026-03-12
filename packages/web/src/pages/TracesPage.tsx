import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { getTraces, type TraceInfo, type TraceStep } from "../api/client";
import { getStoredApiKey } from "../auth";
import { formatDateTime, formatDuration, formatNumber } from "../utils/format";
import "./TracesPage.css";

const PAGE_SIZE = 20;

/* ── Tool call statistics ─────────────────── */

interface ToolStat {
  name: string;
  total: number;
  success: number;
  errors: number;
  totalDurationMs: number;
}

interface ToolStats {
  totalCalls: number;
  totalSuccess: number;
  totalErrors: number;
  byTool: ToolStat[];
}

function computeToolStats(items: TraceInfo[]): ToolStats {
  const map = new Map<string, ToolStat>();
  let totalCalls = 0;
  let totalSuccess = 0;
  let totalErrors = 0;

  for (const trace of items) {
    const steps = parseSteps(trace.steps);
    for (const step of steps) {
      if (step.type !== "tool_result") continue;
      const name = step.name ?? "unknown";
      totalCalls++;
      const isErr = !!step.isError;
      if (isErr) totalErrors++;
      else totalSuccess++;

      let stat = map.get(name);
      if (!stat) {
        stat = { name, total: 0, success: 0, errors: 0, totalDurationMs: 0 };
        map.set(name, stat);
      }
      stat.total++;
      if (isErr) stat.errors++;
      else stat.success++;
      stat.totalDurationMs +=
        ((step as Record<string, unknown>).durationMs as number) ?? 0;
    }
  }

  const byTool = Array.from(map.values()).sort((a, b) => b.total - a.total);
  return { totalCalls, totalSuccess, totalErrors, byTool };
}

function ToolStatsPanel({ items }: { items: TraceInfo[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const stats = useMemo(() => computeToolStats(items), [items]);

  if (stats.totalCalls === 0) return null;

  const successRate =
    stats.totalCalls > 0
      ? ((stats.totalSuccess / stats.totalCalls) * 100).toFixed(1)
      : "0";

  return (
    <div className="card tool-stats-panel">
      <div className="tool-stats-header" onClick={() => setExpanded(!expanded)}>
        <div className="tool-stats-summary">
          <span className="tool-stats-item">
            <span className="tool-stats-label">
              {t("traces.stats.totalCalls")}
            </span>
            <span className="tool-stats-value">{stats.totalCalls}</span>
          </span>
          <span className="tool-stats-item">
            <span className="tool-stats-label">
              {t("traces.stats.successRate")}
            </span>
            <span className="tool-stats-value tool-stats-success">
              {successRate}%
            </span>
          </span>
          <span className="tool-stats-item">
            <span className="tool-stats-label">{t("traces.stats.errors")}</span>
            <span
              className={`tool-stats-value${stats.totalErrors > 0 ? " tool-stats-error" : ""}`}
            >
              {stats.totalErrors}
            </span>
          </span>
          <span className="tool-stats-item">
            <span className="tool-stats-label">
              {t("traces.stats.toolTypes")}
            </span>
            <span className="tool-stats-value">{stats.byTool.length}</span>
          </span>
        </div>
        <span className="tl-chevron" style={{ fontSize: 12 }}>
          {expanded ? "\u25BC" : "\u25B6"}
        </span>
      </div>

      {expanded && (
        <div className="tool-stats-table-wrap">
          <table className="tool-stats-table">
            <thead>
              <tr>
                <th>{t("traces.stats.toolName")}</th>
                <th>{t("traces.stats.calls")}</th>
                <th>{t("traces.stats.successRate")}</th>
                <th>{t("traces.stats.errorsCol")}</th>
                <th>{t("traces.stats.avgDuration")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.byTool.map((s) => {
                const rate =
                  s.total > 0 ? ((s.success / s.total) * 100).toFixed(1) : "0";
                const avgMs =
                  s.total > 0 ? Math.round(s.totalDurationMs / s.total) : 0;
                return (
                  <tr key={s.name}>
                    <td>
                      <code className="tool-stats-name">{s.name}</code>
                    </td>
                    <td>{s.total}</td>
                    <td>
                      <span
                        className={
                          Number(rate) >= 90
                            ? "tool-stats-success"
                            : Number(rate) >= 50
                              ? "tool-stats-warn"
                              : "tool-stats-error"
                        }
                      >
                        {rate}%
                      </span>
                    </td>
                    <td>
                      <span className={s.errors > 0 ? "tool-stats-error" : ""}>
                        {s.errors}
                      </span>
                    </td>
                    <td>
                      <span className="tool-stats-duration">
                        {formatDuration(avgMs)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
  const { t } = useTranslation();
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
                <div className="tl-detail-label">{t("traces.input")}</div>
                <pre className="tl-detail-pre">
                  {JSON.stringify(node.input, null, 2)}
                </pre>
              </div>
            )}
            {node.content && (
              <div className="tl-detail-section">
                <div className="tl-detail-label">
                  {node.isError
                    ? t("traces.errorLabel")
                    : t("traces.outputLabel")}
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
  const { t } = useTranslation();

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
      title={copied ? t("traces.urlCopied") : t("traces.copyTraceUrl")}
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

function TraceCard({ trace, nested }: { trace: TraceInfo; nested?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const steps = parseSteps(trace.steps);
  const timeline = buildTimeline(steps);

  return (
    <div className={`card trace-card${nested ? " trace-card-nested" : ""}`}>
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
            {formatNumber(trace.tokensIn)}&uarr; {formatNumber(trace.tokensOut)}
            &darr;
          </span>
          <span className="trace-duration">
            {formatDuration(trace.durationMs)}
          </span>
          {trace.channel && (
            <span className="badge badge-channel">{trace.channel}</span>
          )}
          <code className="model-name">{trace.model ?? "\u2014"}</code>
          <span className="trace-time">{formatDateTime(trace.createdAt)}</span>
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
              <div className="trace-section-label">{t("traces.response")}</div>
              <pre className="trace-response-text">{trace.response}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Group consecutive traces that share the same conversationId */
interface TraceGroup {
  conversationId: string;
  traces: TraceInfo[];
  totalTokensIn: number;
  totalTokensOut: number;
  totalDurationMs: number;
}

function groupTraces(items: TraceInfo[]): (TraceInfo | TraceGroup)[] {
  const result: (TraceInfo | TraceGroup)[] = [];
  let i = 0;
  while (i < items.length) {
    const current = items[i];
    // Look ahead for consecutive traces with the same conversationId
    let j = i + 1;
    while (
      j < items.length &&
      items[j].conversationId === current.conversationId
    ) {
      j++;
    }
    if (j - i === 1) {
      // Single trace — no grouping needed
      result.push(current);
    } else {
      const group = items.slice(i, j);
      result.push({
        conversationId: current.conversationId,
        traces: group,
        totalTokensIn: group.reduce((s, t) => s + t.tokensIn, 0),
        totalTokensOut: group.reduce((s, t) => s + t.tokensOut, 0),
        totalDurationMs: group.reduce((s, t) => s + t.durationMs, 0),
      });
    }
    i = j;
  }
  return result;
}

function TraceGroupCard({ group }: { group: TraceGroup }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const firstTrace = group.traces[0];
  const lastTrace = group.traces[group.traces.length - 1];

  return (
    <div className="card trace-group">
      <div
        className="trace-group-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="trace-card-left">
          <span className="trace-expand">{expanded ? "\u25BC" : "\u25B6"}</span>
          <span className="trace-group-label">{firstTrace.userInput}</span>
          <span className="trace-group-count">
            {t("traces.turnCount", { count: group.traces.length })}
          </span>
        </div>
        <div className="trace-card-meta">
          <span className="trace-tokens">
            {formatNumber(group.totalTokensIn)}&uarr;{" "}
            {formatNumber(group.totalTokensOut)}&darr;
          </span>
          <span className="trace-duration">
            {formatDuration(group.totalDurationMs)}
          </span>
          <code className="model-name">{firstTrace.model ?? "\u2014"}</code>
          <span className="trace-time">
            {formatDateTime(lastTrace.createdAt)}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="trace-group-body">
          {group.traces.map((tr) => (
            <TraceCard key={tr.id} trace={tr} nested />
          ))}
        </div>
      )}
    </div>
  );
}

function isTraceGroup(item: TraceInfo | TraceGroup): item is TraceGroup {
  return "traces" in item;
}

export function TracesPage() {
  const { t } = useTranslation();
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
      <PageHeader>{t("traces.title")}</PageHeader>
      <div className="page-body">
        {error && <div className="traces-error">{error}</div>}

        <div className="traces-toolbar">
          <span className="traces-total">
            {t("traces.tracesCount", { count: formatNumber(total) })}
          </span>
          <div className="traces-pager">
            <button
              className="btn-secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              {t("common.prev")}
            </button>
            <span className="traces-page-info">
              {page + 1} / {totalPages}
            </span>
            <button
              className="btn-secondary"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("common.next")}
            </button>
          </div>
        </div>

        {!loading && items.length > 0 && <ToolStatsPanel items={items} />}

        {loading ? (
          <div className="traces-loading">{t("common.loading")}</div>
        ) : items.length === 0 ? (
          <div className="traces-empty">{t("traces.noTraces")}</div>
        ) : (
          <div className="traces-list">
            {groupTraces(items).map((item, i) =>
              isTraceGroup(item) ? (
                <TraceGroupCard key={item.conversationId + i} group={item} />
              ) : (
                <TraceCard key={item.id} trace={item} />
              ),
            )}
          </div>
        )}
      </div>
    </>
  );
}
