import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../data/api";

type AnalyticsResponse = {
  cash: { bill_count: number; total_cents: number };
  online: { bill_count: number; total_cents: number };
  split: { bill_count: number; total_cents: number };
};

const fmt = (cents: number) => `₹${(cents / 100).toFixed(2)}`;
const toDateInputUtc = (date: Date) => date.toISOString().slice(0, 10);

const AnalyticsPage: React.FC = () => {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => toDateInputUtc(new Date()));
  const [endDate, setEndDate] = useState(() => toDateInputUtc(new Date()));

  const today = useMemo(() => toDateInputUtc(new Date()), []);
  const minAllowedDate = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 3);
    return toDateInputUtc(d);
  }, []);

  const normalizedRange = useMemo(() => {
    let start = startDate || today;
    let end = endDate || start;
    if (start > end) [start, end] = [end, start];
    if (start < minAllowedDate) start = minAllowedDate;
    if (end > today) end = today;
    return { start, end };
  }, [endDate, minAllowedDate, startDate, today]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          start: normalizedRange.start,
          end: normalizedRange.end,
        });
        const res = await apiGet<AnalyticsResponse>("/analytics/payments?" + params.toString());
        setData(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load payments");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [normalizedRange.end, normalizedRange.start]);

  const total = useMemo(() => {
    if (!data) return 0;
    return data.cash.total_cents + data.online.total_cents;
  }, [data]);

  return (
    <div>
      <div className="page-title">Payments</div>

      <div className="card no-print">
        <div className="history-filters">
          <label className="muted" htmlFor="payments-start">From</label>
          <input
            id="payments-start"
            className="input"
            type="date"
            min={minAllowedDate}
            max={today}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <label className="muted" htmlFor="payments-end">To</label>
          <input
            id="payments-end"
            className="input"
            type="date"
            min={minAllowedDate}
            max={today}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

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
