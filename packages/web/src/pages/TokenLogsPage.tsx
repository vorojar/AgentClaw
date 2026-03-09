import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { getTokenLogs, type TokenLogEntry } from "../api/client";
import { formatDateTime, formatNumber } from "../utils/format";
import "./TokenLogsPage.css";

const PAGE_SIZE = 50;

export function TokenLogsPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<TokenLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (p: number) => {
    try {
      setLoading(true);
      setError(null);
      const res = await getTokenLogs(PAGE_SIZE, p * PAGE_SIZE);
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load token logs",
      );
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
      <PageHeader>{t('tokenLogs.title')}</PageHeader>
      <div className="page-body">
        {error && <div className="token-logs-error">{error}</div>}

        <section className="card token-logs-section">
          <div className="token-logs-header">
            <span className="token-logs-total">
              {t('tokenLogs.records', { count: formatNumber(total) })}
            </span>
            <div className="token-logs-pager">
              <button
                className="btn-secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('common.prev')}
              </button>
              <span className="token-logs-page-info">
                {page + 1} / {totalPages}
              </span>
              <button
                className="btn-secondary"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('common.next')}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="token-logs-loading">{t('common.loading')}</div>
          ) : items.length === 0 ? (
            <div className="token-logs-empty">{t('tokenLogs.noRecords')}</div>
          ) : (
            <div className="stats-table-wrapper">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>{t('tokenLogs.timeCol')}</th>
                    <th>{t('tokenLogs.traceCol')}</th>
                    <th>{t('tokenLogs.modelCol')}</th>
                    <th>{t('tokenLogs.inputCol')}</th>
                    <th>{t('tokenLogs.outputCol')}</th>
                    <th>{t('tokenLogs.totalCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className="token-logs-time">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td>
                        <code className="trace-id">
                          {row.traceId ? row.traceId.slice(0, 8) : "—"}
                        </code>
                      </td>
                      <td>
                        <code className="model-name">{row.model}</code>
                      </td>
                      <td>{formatNumber(row.tokensIn)}</td>
                      <td>{formatNumber(row.tokensOut)}</td>
                      <td className="token-logs-total-cell">
                        {formatNumber(row.tokensIn + row.tokensOut)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
