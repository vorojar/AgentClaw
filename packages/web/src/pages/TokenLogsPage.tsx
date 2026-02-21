import { useState, useEffect, useCallback } from "react";
import { getTokenLogs, type TokenLogEntry } from "../api/client";
import "./TokenLogsPage.css";

const PAGE_SIZE = 50;

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function TokenLogsPage() {
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
      <div className="page-header">Token Logs</div>
      <div className="page-body">
        {error && <div className="token-logs-error">{error}</div>}

        <section className="card token-logs-section">
          <div className="token-logs-header">
            <span className="token-logs-total">
              {formatNumber(total)} records
            </span>
            <div className="token-logs-pager">
              <button
                className="btn-secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </button>
              <span className="token-logs-page-info">
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
            <div className="token-logs-loading">Loading...</div>
          ) : items.length === 0 ? (
            <div className="token-logs-empty">No token usage records yet</div>
          ) : (
            <div className="stats-table-wrapper">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Model</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className="token-logs-time">
                        {formatTime(row.createdAt)}
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
