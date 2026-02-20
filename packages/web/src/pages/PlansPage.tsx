import { useState, useEffect, useCallback } from "react";
import { listPlans, type PlanInfo } from "../api/client";
import "./PlansPage.css";

function statusBadgeClass(status: string): string {
  switch (status) {
    case "completed":
      return "badge badge-success";
    case "active":
    case "in_progress":
      return "badge badge-info";
    case "failed":
      return "badge badge-error";
    case "cancelled":
      return "badge badge-warning";
    default:
      return "badge badge-muted";
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "completed":
      return "\u2713";
    case "active":
    case "in_progress":
      return "\u25B6";
    case "failed":
      return "\u2717";
    case "cancelled":
      return "\u2014";
    default:
      return "\u25CB";
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export function PlansPage() {
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    try {
      const data = await listPlans();
      setPlans(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
    const interval = setInterval(fetchPlans, 10000);
    return () => clearInterval(interval);
  }, [fetchPlans]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const completedSteps = (plan: PlanInfo): number =>
    plan.steps.filter((s) => s.status === "completed").length;

  return (
    <>
      <div className="page-header">Plans</div>
      <div className="page-body">
        {loading && plans.length === 0 && (
          <div className="plans-loading">Loading plans...</div>
        )}

        {error && <div className="plans-error">{error}</div>}

        {!loading && !error && plans.length === 0 && (
          <div className="plans-empty">No plans yet</div>
        )}

        <div className="plans-list">
          {plans.map((plan) => (
            <div key={plan.id} className="card plan-card">
              <div
                className="plan-card-header"
                onClick={() => toggleExpand(plan.id)}
              >
                <div className="plan-card-left">
                  <span className="plan-expand-icon">
                    {expandedId === plan.id ? "\u25BC" : "\u25B6"}
                  </span>
                  <div className="plan-info">
                    <div className="plan-goal">{plan.goal}</div>
                    <div className="plan-meta">
                      <span className="plan-time">
                        {formatTime(plan.createdAt)}
                      </span>
                      {plan.completedAt && (
                        <span className="plan-completed-time">
                          Completed: {formatTime(plan.completedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="plan-card-right">
                  <span className="plan-progress">
                    {completedSteps(plan)}/{plan.steps.length}
                  </span>
                  <span className={statusBadgeClass(plan.status)}>
                    {plan.status}
                  </span>
                </div>
              </div>

              {expandedId === plan.id && (
                <div className="plan-steps">
                  <div className="steps-header">Steps</div>
                  {plan.steps.length === 0 && (
                    <div className="steps-empty">No steps defined</div>
                  )}
                  {plan.steps.map((step, index) => (
                    <div key={step.id} className="step-item">
                      <div className="step-connector">
                        <span className={`step-icon step-icon-${step.status}`}>
                          {statusIcon(step.status)}
                        </span>
                        {index < plan.steps.length - 1 && (
                          <div className="step-line" />
                        )}
                      </div>
                      <div className="step-content">
                        <div className="step-header">
                          <span className="step-description">
                            {step.description}
                          </span>
                          <span className={statusBadgeClass(step.status)}>
                            {step.status}
                          </span>
                        </div>
                        {step.result && (
                          <div className="step-result">
                            <span className="step-result-label">Result:</span>{" "}
                            {step.result}
                          </div>
                        )}
                        {step.error && (
                          <div className="step-error">
                            <span className="step-error-label">Error:</span>{" "}
                            {step.error}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
