import React, { useCallback, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../data/api";
import type { BillItem, Product } from "../../data/types";
import BillSummary from "../components/BillSummary";
import BillTable from "../components/BillTable";
import ProductSearch from "../components/ProductSearch";

const BillingPage: React.FC = () => {
  const [items, setItems] = useState<BillItem[]>([]);
  const [taxRateBps, setTaxRateBps] = useState(0);
  const [saving, setSaving] = useState(false);
  const [billNo, setBillNo] = useState<string | null>(null);

  const search = useCallback(async (q: string) => {
    return apiGet<Product[]>(`/products/search?q=${encodeURIComponent(q)}`);
  }, []);

  const addItem = useCallback((p: Product) => {
    setItems((prev) => {
      const existing = prev.find((x) => x.product_id === p.id);
      if (existing) {
        return prev.map((x) =>
          x.product_id === p.id
            ? {
                ...x,
                qty: x.qty + 1,
                line_total_cents: (x.qty + 1) * x.unit_price_cents
              }
            : x
        );
      }
      return [
        ...prev,
        {
          product_id: p.id,
          product_name: p.name,
          unit_price_cents: p.price_cents,
          qty: 1,
          line_total_cents: p.price_cents
        }
      ];
    });
  }, []);

  // (no numeric shortcut add)

  const subtotal = useMemo(
    () => items.reduce((sum, it) => sum + it.line_total_cents, 0),
    [items]
  );
  const taxCents = useMemo(
    () => Math.round((subtotal * taxRateBps) / 10000),
    [subtotal, taxRateBps]
  );
  const total = subtotal + taxCents;

  const onQtyChange = (productId: number, qty: number) => {
    setItems((prev) =>
      prev.map((x) =>
        x.product_id === productId
          ? { ...x, qty, line_total_cents: qty * x.unit_price_cents }
          : x
      )
    );
  };

  const onRemove = (productId: number) => {
    setItems((prev) => prev.filter((x) => x.product_id !== productId));
  };

  const generateBill = async () => {
    if (items.length === 0) return;
    setSaving(true);
    setBillNo(null);
    try {
      const res = await apiPost<{ bill_no: string }>("/bills", {
        items,
        tax_rate_bps: taxRateBps
      });
      setBillNo(res.bill_no);
      setItems([]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-title">Billing</div>
      <div className="split">
        <div>
          <ProductSearch onSelect={addItem} search={search} />
          <BillTable items={items} onQtyChange={onQtyChange} onRemove={onRemove} />
        </div>
        <div>
          <BillSummary
            subtotal={subtotal}
            taxRateBps={taxRateBps}
            taxCents={taxCents}
            total={total}
            onTaxRateChange={setTaxRateBps}
          />
          <div className="card">
            <button className="button success" onClick={generateBill} disabled={saving}>
              {saving ? "Saving…" : "Generate Bill"}
            </button>
            <button className="button" style={{ marginLeft: 8 }} onClick={() => window.print()}>
              Print
            </button>
            {billNo && (
              <div style={{ marginTop: 8 }}>
                Bill saved: <strong>{billNo}</strong>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BillingPage;
