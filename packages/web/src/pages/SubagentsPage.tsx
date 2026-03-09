import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { listSubAgents, type SubAgentInfo } from "../api/client";
import { formatDateTime, formatDuration, formatNumber } from "../utils/format";
import "./SubagentsPage.css";

const PAGE_SIZE = 20;

type StatusFilter = "" | "running" | "completed" | "failed" | "killed";

function formatAgentDuration(
  createdAt: string,
  completedAt: string | undefined,
  t: (key: string) => string,
): string {
  if (!completedAt) return t("time.running");
  const ms = new Date(completedAt).getTime() - new Date(createdAt).getTime();
  return formatDuration(ms);
}

function StatusIcon({ status }: { status: SubAgentInfo["status"] }) {
  const { t } = useTranslation();
  switch (status) {
    case "running":
      return (
        <span
          className="sa-status-icon sa-status-running"
          title={t("subagents.running")}
        >
          &#9696;
        </span>
      );
    case "completed":
      return (
        <span
          className="sa-status-icon sa-status-completed"
          title={t("subagents.completed")}
        >
          &#10004;
        </span>
      );
    case "failed":
      return (
        <span
          className="sa-status-icon sa-status-failed"
          title={t("subagents.failed")}
        >
          &#10008;
        </span>
      );
    case "killed":
      return (
        <span
          className="sa-status-icon sa-status-killed"
          title={t("subagents.killed")}
        >
          &mdash;
        </span>
      );
  }
}

function SubagentCard({ agent }: { agent: SubAgentInfo }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();

  return (
    <div
      className={`card sa-card ${agent.status === "running" ? "sa-card-running" : ""}`}
    >
      <div className="sa-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="sa-card-left">
          <span className="sa-expand">{expanded ? "\u25BC" : "\u25B6"}</span>
          <StatusIcon status={agent.status} />
          <span className="sa-goal">{agent.goal}</span>
        </div>
        <div className="sa-card-meta">
          {agent.model && <code className="sa-model">{agent.model}</code>}
          <span className="sa-tokens">
            {formatNumber(agent.tokensIn)}&uarr; {formatNumber(agent.tokensOut)}
            &darr;
          </span>
          <span className="sa-iterations">
            {agent.iterations !== 1
              ? t("subagents.iters", { count: agent.iterations })
              : t("subagents.iter", { count: agent.iterations })}
          </span>
          <span className="sa-duration">
            {formatAgentDuration(agent.createdAt, agent.completedAt, t)}
          </span>
          <span className="sa-time">{formatDateTime(agent.createdAt)}</span>
        </div>
      </div>

      {expanded && (
        <div className="sa-card-body">
          {agent.result && (
            <div className="sa-section">
              <div className="sa-section-label">{t("subagents.result")}</div>
              <pre className="sa-section-pre">{agent.result}</pre>
            </div>
          )}

          {agent.error && (
            <div className="sa-section">
              <div className="sa-section-label">
                {t("subagents.errorLabel")}
              </div>
              <pre className="sa-section-pre sa-section-error">
                {agent.error}
              </pre>
            </div>
          )}

          {agent.toolsUsed.length > 0 && (
            <div className="sa-section">
              <div className="sa-section-label">{t("subagents.toolsUsed")}</div>
              <div className="sa-tools">
                {agent.toolsUsed.map((tool) => (
                  <span key={tool} className="sa-tool-chip">
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SubagentsPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<SubAgentInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const statusChips = [
    { label: t("subagents.all"), value: "" as StatusFilter },
    { label: t("subagents.running"), value: "running" as StatusFilter },
    { label: t("subagents.completed"), value: "completed" as StatusFilter },
    { label: t("subagents.failed"), value: "failed" as StatusFilter },
    { label: t("subagents.killed"), value: "killed" as StatusFilter },
  ];

  const fetchPage = useCallback(async (p: number, status: StatusFilter) => {
    try {
      setLoading(true);
      setError(null);
      const res = await listSubAgents(
        status || undefined,
        PAGE_SIZE,
        p * PAGE_SIZE,
      );
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subagents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(page, statusFilter);
  }, [page, statusFilter, fetchPage]);

  const handleFilterChange = useCallback((value: StatusFilter) => {
    setStatusFilter(value);
    setPage(0);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader>{t("subagents.title")}</PageHeader>
      <div className="page-body">
        {error && <div className="sa-error">{error}</div>}

        <div className="sa-filters">
          {statusChips.map((chip) => (
            <button
              key={chip.value}
              className={`sa-chip ${statusFilter === chip.value ? "sa-chip-active" : ""}`}
              onClick={() => handleFilterChange(chip.value)}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="sa-toolbar">
          <span className="sa-total">
            {total !== 1
              ? t("subagents.subagentsCount", { count: formatNumber(total) })
              : t("subagents.subagentCount", { count: formatNumber(total) })}
          </span>
          <div className="sa-pager">
            <button
              className="btn-secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              {t("common.prev")}
            </button>
            <span className="sa-page-info">
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

        {loading ? (
          <div className="sa-loading">{t("common.loading")}</div>
        ) : items.length === 0 ? (
          <div className="sa-empty">{t("subagents.noSubagents")}</div>
        ) : (
          <div className="sa-list">
            {items.map((agent) => (
              <SubagentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
