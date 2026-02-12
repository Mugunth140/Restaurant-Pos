import React, { useEffect, useState } from "react";
import { apiGet } from "../../data/api";
import type { Bill, BillItem } from "../../data/types";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 15;
const fmt = (cents: number) => "\u20B9" + (cents / 100).toFixed(2);

const BillHistoryPage: React.FC = () => {
  const [bills, setBills] = useState<Bill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [billNo, setBillNo] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [appliedBillNo, setAppliedBillNo] = useState("");
  const [appliedStart, setAppliedStart] = useState("");
  const [appliedEnd, setAppliedEnd] = useState("");
  const [selected, setSelected] = useState<Bill | null>(null);
  const [items, setItems] = useState<BillItem[]>([]);

  const applyFilters = () => {
    let s = start, e = end;
    if (s && e && s > e) [s, e] = [e, s];
    setAppliedBillNo(billNo.trim());
    setAppliedStart(s);
    setAppliedEnd(e);
    setPage(1);
  };

  const clearFilters = () => {
    setBillNo(""); setStart(""); setEnd("");
    setAppliedBillNo(""); setAppliedStart(""); setAppliedEnd("");
    setPage(1);
  };

  const load = async () => {
    const params = new URLSearchParams({
      page: String(page), limit: String(PAGE_SIZE),
      bill_no: appliedBillNo, start: appliedStart, end: appliedEnd,
    });
    const data = await apiGet<{ rows: Bill[]; total: number }>("/bills?" + params.toString());
    setBills(data.rows);
    setTotal(data.total);
  };

  useEffect(() => { void load(); }, [page, appliedBillNo, appliedStart, appliedEnd]);

  const viewBill = async (bill: Bill) => {
    setSelected(bill);
    const data = await apiGet<{ items: BillItem[] }>("/bills/" + bill.id);
    setItems(data.items);
  };

  const hasFilters = appliedBillNo || appliedStart || appliedEnd;

  return (
    <div>
      <div className="page-title">Bill History</div>

      <div className="card no-print">
        <div className="history-filters">
          <input
            className="input"
            placeholder="Bill number"
            value={billNo}
            onChange={(e) => setBillNo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
          />
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          <button className="button primary" onClick={applyFilters}>Filter</button>
          {hasFilters && (
            <button className="button ghost" onClick={clearFilters}>Clear</button>
          )}
        </div>
      </div>

      <div className="card">
        <table className="table history-table">
          <colgroup>
            <col className="col-billno" />
            <col className="col-money" />
            <col className="col-money" />
            <col className="col-money" />
            <col className="col-date" />
            <col className="col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>Bill No</th>
              <th className="text-right">Subtotal</th>
              <th className="text-right">Tax</th>
              <th className="text-right">Total</th>
              <th>Date</th>
              <th className="text-right"></th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id}>
                <td><strong>{b.bill_no}</strong></td>
                <td className="text-right">{fmt(b.subtotal_cents)}</td>
                <td className="text-right">{fmt(b.tax_cents)}</td>
                <td className="text-right"><strong>{fmt(b.total_cents)}</strong></td>
                <td className="muted">{b.created_at}</td>
                <td className="text-right">
                  <button className="button button-sm" onClick={() => viewBill(b)}>View</button>
                </td>
              </tr>
            ))}
            {bills.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">No bills found</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
      </div>

      {selected && (
        <div className="card bill-detail">
          <div className="card-header">
            <span>Bill #{selected.bill_no}</span>
            <div className="row" style={{ gap: 6 }}>
              <button className="button button-sm" onClick={() => window.print()}>Reprint</button>
              <button className="button button-sm ghost" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: "45%" }}>Item</th>
                <th className="text-center" style={{ width: "15%" }}>Qty</th>
                <th className="text-right" style={{ width: "20%" }}>Price</th>
                <th className="text-right" style={{ width: "20%" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.product_id}>
                  <td>{it.product_name}</td>
                  <td className="text-center">{it.qty}</td>
                  <td className="text-right">{fmt(it.unit_price_cents)}</td>
                  <td className="text-right"><strong>{fmt(it.line_total_cents)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bill-detail-summary">
            <div>Subtotal<strong>{fmt(selected.subtotal_cents)}</strong></div>
            <div>Tax ({(selected.tax_rate_bps / 100).toFixed(2)}%)<strong>{fmt(selected.tax_cents)}</strong></div>
            <div>Total<strong style={{ color: "var(--accent)" }}>{fmt(selected.total_cents)}</strong></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillHistoryPage;
