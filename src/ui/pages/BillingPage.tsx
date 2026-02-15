import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../data/api";
import type { BillItem, PaymentMode, Product } from "../../data/types";
import BillSummary from "../components/BillSummary";
import BillTable from "../components/BillTable";
import ProductSearch from "../components/ProductSearch";

const THERMAL_PRINTER_NAME = "Rugtek printer";
const fmt = (cents: number) => `₹${(cents / 100).toFixed(2)}`;

type ReceiptPayload = {
  billNo: string;
  printedAt: string;
  subtotalCents: number;
  discountRateBps: number;
  discountCents: number;
  totalCents: number;
  items: Array<{
    name: string;
    qty: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
};

const BillingPage: React.FC = () => {
  const [items, setItems] = useState<BillItem[]>([]);
  const [discountRateBps, setDiscountRateBps] = useState(0);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<ReceiptPayload | null>(null);
  const [billNo, setBillNo] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("cash");
  const [splitCashInput, setSplitCashInput] = useState("");
  const [splitOnlineInput, setSplitOnlineInput] = useState("");

  const parseInputToCents = (value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  };

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
  const splitCashCents = useMemo(() => parseInputToCents(splitCashInput), [splitCashInput]);
  const splitOnlineCents = useMemo(() => parseInputToCents(splitOnlineInput), [splitOnlineInput]);
  const isSplitMode = paymentMode === "split";
  const splitTotalCents = splitCashCents + splitOnlineCents;
  const splitDiffCents = total - splitTotalCents;
  const splitMatchesTotal = !isSplitMode || splitDiffCents === 0;

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

  const buildReceiptPayload = useCallback((billNumber: string, billItems: BillItem[]) => {
    const now = new Date();
    return {
      billNo: billNumber,
      printedAt: now.toLocaleString("en-IN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      subtotalCents: subtotal,
      discountRateBps,
      discountCents,
      totalCents: total,
      items: billItems.map((item) => ({
        name: item.product_name,
        qty: item.qty,
        unitPriceCents: item.unit_price_cents,
        lineTotalCents: item.line_total_cents,
      })),
    };
  }, [discountCents, discountRateBps, subtotal, total]);

  const printReceipt = useCallback(async (payload: ReceiptPayload) => {
    setPrinting(true);
    setPrintError(null);
    try {
      await apiPost("/print", {
        printerName: THERMAL_PRINTER_NAME,
        payload,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to print receipt.";
      setPrintError(message);
    } finally {
      setPrinting(false);
    }
  }, []);

  const generateBill = useCallback(async () => {
    if (items.length === 0) return;
    if (isSplitMode && !splitMatchesTotal) {
      setPrintError("Split amount must exactly match bill total.");
      return;
    }
    const billItems = items.map((item) => ({ ...item }));
    setSaving(true);
    setBillNo(null);
    setPrintError(null);
    try {
      const res = await apiPost<{ bill_no: string }>("/bills", {
        items: billItems,
        discount_rate_bps: discountRateBps,
        payment_mode: paymentMode,
        split_cash_cents: isSplitMode ? splitCashCents : undefined,
        split_online_cents: isSplitMode ? splitOnlineCents : undefined,
      });
      const payload = buildReceiptPayload(res.bill_no, billItems);
      setLastReceipt(payload);
      await printReceipt(payload);
      setBillNo(res.bill_no);
      setItems([]);
      setSplitCashInput("");
      setSplitOnlineInput("");
    } finally {
      setSaving(false);
    }
  }, [buildReceiptPayload, discountRateBps, isSplitMode, items, paymentMode, printReceipt, splitCashCents, splitMatchesTotal, splitOnlineCents]);

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
    setSplitCashInput("");
    setSplitOnlineInput("");
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
          <div className="card payment-mode-card">
            <div className="payment-mode-row">
              <label htmlFor="payment-mode" className="muted">Payment</label>
              <select
                id="payment-mode"
                className="select"
                value={paymentMode}
                onChange={(e) => {
                  const next = e.target.value as PaymentMode;
                  setPaymentMode(next);
                  if (next !== "split") {
                    setSplitCashInput("");
                    setSplitOnlineInput("");
                  }
                }}
              >
                <option value="cash">Cash</option>
                <option value="online">Online</option>
                <option value="split">Split</option>
              </select>
            </div>
            {isSplitMode && (
              <div className="split-payment-grid">
                <div>
                  <label className="muted" htmlFor="split-cash">Cash amount</label>
                  <input
                    id="split-cash"
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={splitCashInput}
                    onChange={(e) => setSplitCashInput(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="muted" htmlFor="split-online">Online amount</label>
                  <input
                    id="split-online"
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={splitOnlineInput}
                    onChange={(e) => setSplitOnlineInput(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className={"split-tally " + (splitMatchesTotal ? "ok" : "warn")}>
                  <span>Total: {fmt(total)}</span>
                  <span>Entered: {fmt(splitTotalCents)}</span>
                  <span>Difference: {fmt(Math.abs(splitDiffCents))}</span>
                </div>
              </div>
            )}
          </div>
          <BillSummary
            subtotal={subtotal}
            discountRateBps={discountRateBps}
            discountCents={discountCents}
            total={total}
            onDiscountRateChange={setDiscountRateBps}
          />
          <div className="card billing-actions">
            <button className="button success" onClick={generateBill} disabled={saving || printing || items.length === 0 || !splitMatchesTotal}>
              {saving ? "Saving" : printing ? "Printing" : "Generate Bill"}
            </button>
            <button className="button" onClick={() => { if (lastReceipt) void printReceipt(lastReceipt); }} disabled={!lastReceipt || printing || saving}>
              {printing ? "Printing" : "Reprint"}
            </button>
            {items.length > 0 && (
              <button className="button ghost" onClick={clearOrder}>
                Clear
              </button>
            )}
          </div>
          {printError && (
            <div className="bill-saved-banner" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
              {printError}
            </div>
          )}
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
