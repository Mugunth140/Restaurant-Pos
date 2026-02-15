import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../data/api";

type AnalyticsResponse = {
  cash: { bill_count: number; total_cents: number };
  online: { bill_count: number; total_cents: number };
  split: { bill_count: number; total_cents: number };
};

const fmt = (cents: number) => `₹${(cents / 100).toFixed(2)}`;

const AnalyticsPage: React.FC = () => {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiGet<AnalyticsResponse>("/analytics/payments");
        setData(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load payments");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const total = useMemo(() => {
    if (!data) return 0;
    return data.cash.total_cents + data.online.total_cents;
  }, [data]);

  return (
    <div>
      <div className="page-title">Payments</div>

      {error && (
        <div className="toast toast-error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading && <div className="card">Loading payments...</div>}

      {!loading && data && (
        <div className="analytics-grid">
          <div className="card analytics-card">
            <div className="muted">Cash Sales</div>
            <div className="analytics-amount">{fmt(data.cash.total_cents)}</div>
            <div className="muted">Bills: {data.cash.bill_count}</div>
          </div>

          <div className="card analytics-card">
            <div className="muted">Online Sales</div>
            <div className="analytics-amount">{fmt(data.online.total_cents)}</div>
            <div className="muted">Bills: {data.online.bill_count}</div>
          </div>

          <div className="card analytics-card">
            <div className="muted">Split Bills</div>
            <div className="analytics-amount">{fmt(data.split.total_cents)}</div>
            <div className="muted">Bills: {data.split.bill_count}</div>
          </div>

          <div className="card analytics-card analytics-total">
            <div className="muted">Total Received (Cash + Online)</div>
            <div className="analytics-amount">{fmt(total)}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsPage;
