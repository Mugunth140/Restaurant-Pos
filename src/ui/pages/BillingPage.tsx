import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../data/api";
import type { BillItem, Product } from "../../data/types";
import BillSummary from "../components/BillSummary";
import BillTable from "../components/BillTable";
import ProductSearch from "../components/ProductSearch";

const BillingPage: React.FC = () => {
  const [items, setItems] = useState<BillItem[]>([]);
  const [discountRateBps, setDiscountRateBps] = useState(0);
  const [saving, setSaving] = useState(false);
  const [billNo, setBillNo] = useState<string | null>(null);

  const search = useCallback(
    (q: string) => apiGet<Product[]>("/products/search?q=" + encodeURIComponent(q)),
    [],
  );

  const addItem = useCallback((p: Product) => {
    setItems((prev) => {
      const existing = prev.find((x) => x.product_id === p.id);
      if (existing) {
        return prev.map((x) =>
          x.product_id === p.id
            ? { ...x, qty: x.qty + 1, line_total_cents: (x.qty + 1) * x.unit_price_cents }
            : x,
        );
      }
      return [
        ...prev,
        {
          product_id: p.id,
          product_name: p.name,
          unit_price_cents: p.price_cents,
          qty: 1,
          line_total_cents: p.price_cents,
        },
      ];
    });
    setBillNo(null);
  }, []);

  const subtotal = useMemo(() => items.reduce((s, it) => s + it.line_total_cents, 0), [items]);
  const discountCents = useMemo(() => Math.round((subtotal * discountRateBps) / 10000), [subtotal, discountRateBps]);
  const total = subtotal - discountCents;

  const onQtyChange = (productId: number, qty: number) => {
    setItems((prev) =>
      prev.map((x) =>
        x.product_id === productId ? { ...x, qty, line_total_cents: qty * x.unit_price_cents } : x,
      ),
    );
  };

  const onRemove = (productId: number) => {
    setItems((prev) => prev.filter((x) => x.product_id !== productId));
  };

  const generateBill = useCallback(async () => {
    if (items.length === 0) return;
    setSaving(true);
    setBillNo(null);
    try {
      const res = await apiPost<{ bill_no: string }>("/bills", {
        items,
        discount_rate_bps: discountRateBps,
      });
      setBillNo(res.bill_no);
      setItems([]);
    } finally {
      setSaving(false);
    }
  }, [discountRateBps, items]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving && items.length > 0) {
          void generateBill();
        }
        return;
      }

      if (e.key === "Tab" && !e.shiftKey) {
        const activeEl = document.activeElement as HTMLElement | null;
        if (activeEl?.id === "billing-search-input") return;
        e.preventDefault();
        const searchInput = document.getElementById("billing-search-input") as HTMLInputElement | null;
        searchInput?.focus();
        searchInput?.select();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [generateBill, items.length, saving]);

  const clearOrder = () => {
    setItems([]);
    setBillNo(null);
  };

  return (
    <div className="billing-page">
      <div className="page-title">Billing</div>
      <div className="split billing-split">
        <div>
          <ProductSearch onSelect={addItem} search={search} inputId="billing-search-input" />
          <BillTable items={items} onQtyChange={onQtyChange} onRemove={onRemove} />
        </div>
        <div className="billing-right">
          <BillSummary
            subtotal={subtotal}
            discountRateBps={discountRateBps}
            discountCents={discountCents}
            total={total}
            onDiscountRateChange={setDiscountRateBps}
          />
          <div className="card billing-actions">
            <button className="button success" onClick={generateBill} disabled={saving || items.length === 0}>
              {saving ? "Saving" : "Generate Bill"}
            </button>
            <button className="button" onClick={() => window.print()} disabled={items.length === 0}>
              Print
            </button>
            {items.length > 0 && (
              <button className="button ghost" onClick={clearOrder}>
                Clear
              </button>
            )}
          </div>
          {billNo && (
            <div className="bill-saved-banner">
               Bill <strong>{billNo}</strong> saved successfully
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BillingPage;
