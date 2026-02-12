import React from "react";

type Props = {
  subtotal: number;
  taxRateBps: number;
  taxCents: number;
  total: number;
  onTaxRateChange: (bps: number) => void;
};

const fmt = (cents: number) => "\u20B9" + (cents / 100).toFixed(2);

const BillSummary: React.FC<Props> = ({
  subtotal,
  taxRateBps,
  taxCents,
  total,
  onTaxRateChange,
}) => (
  <div className="card">
    <div className="card-header">Order Summary</div>
    <div className="summary-row">
      <span>Subtotal</span>
      <strong>{fmt(subtotal)}</strong>
    </div>
    <div className="summary-row">
      <div className="row">
        <span>Tax</span>
        <input
          className="input"
          style={{ width: 72, marginLeft: 8, textAlign: "right" }}
          value={(taxRateBps / 100).toFixed(2)}
          onChange={(e) => {
            const v = Number(e.target.value);
            onTaxRateChange(Number.isFinite(v) ? Math.round(v * 100) : 0);
          }}
        />
        <span className="muted">%</span>
      </div>
      <strong>{fmt(taxCents)}</strong>
    </div>
    <div className="summary-row">
      <span style={{ fontSize: 16, fontWeight: 600 }}>Total</span>
      <span className="summary-total">{fmt(total)}</span>
    </div>
  </div>
);

export default BillSummary;
