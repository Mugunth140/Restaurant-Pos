import React, { useEffect, useState } from "react";
import { apiGet } from "../../data/api";
import type { Bill, BillItem } from "../../data/types";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 10;

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

  const load = async () => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      bill_no: appliedBillNo,
      start: appliedStart,
      end: appliedEnd,
    });
    const data = await apiGet<{ rows: Bill[]; total: number }>(
      `/bills?${params}`,
    );
    setBills(data.rows);
    setTotal(data.total);
  };

  useEffect(() => {
    void load();
  }, [page, appliedBillNo, appliedStart, appliedEnd]);

  const viewBill = async (bill: Bill) => {
    setSelected(bill);
    const data = await apiGet<{ items: BillItem[] }>(`/bills/${bill.id}`);
    setItems(data.items);
  };

  return (
    <div>
      <div className="page-title">Bill History</div>
      <div className="card no-print">
        <div className="row">
          <input
            className="input"
            placeholder="Bill number"
            value={billNo}
            onChange={(e) => setBillNo(e.target.value)}
          />
          <input
            className="input"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <input
            className="input"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
          <button
            className="button"
            onClick={() => {
              setAppliedBillNo(billNo);
              setAppliedStart(start);
              setAppliedEnd(end);
              setPage(1);
            }}
          >
            Filter
          </button>
        </div>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Bill No</th>
              <th>Subtotal</th>
              <th>Tax</th>
              <th>Total</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id}>
                <td>{b.bill_no}</td>
                <td>₹{(b.subtotal_cents / 100).toFixed(2)}</td>
                <td>₹{(b.tax_cents / 100).toFixed(2)}</td>
                <td>₹{(b.total_cents / 100).toFixed(2)}</td>
                <td>{b.created_at}</td>
                <td>
                  <button className="button" onClick={() => viewBill(b)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
            {bills.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No bills found
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onChange={setPage}
        />
      </div>
      {selected && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Bill #{selected.bill_no}</strong>
            <button className="button" onClick={() => window.print()}>
              Reprint
            </button>
          </div>
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.product_id}>
                  <td>{it.product_name}</td>
                  <td>{it.qty}</td>
                  <td>₹{(it.unit_price_cents / 100).toFixed(2)}</td>
                  <td>₹{(it.line_total_cents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default BillHistoryPage;
