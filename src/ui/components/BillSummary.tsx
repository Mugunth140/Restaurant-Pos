import React from "react";

type Props = {
  subtotal: number;
  discountRateBps: number;
  discountCents: number;
  total: number;
  onDiscountRateChange: (bps: number) => void;
};

const fmt = (cents: number) => "\u20B9" + (cents / 100).toFixed(2);

const BillSummary: React.FC<Props> = ({
  subtotal,
  discountRateBps,
  discountCents,
  total,
  onDiscountRateChange,
}) => (
  <div className="card">
    <div className="card-header">Order Summary</div>
    <div className="summary-row">
      <span>Subtotal</span>
      <strong>{fmt(subtotal)}</strong>
    </div>
    <div className="summary-row">
      <div className="row">
        <span>Discount</span>
        <input
          className="input"
          style={{ width: 72, marginLeft: 8, textAlign: "right" }}
          value={(discountRateBps / 100).toFixed(2)}
          onChange={(e) => {
            const v = Number(e.target.value);
            onDiscountRateChange(Number.isFinite(v) ? Math.round(v * 100) : 0);
          }}
        />
        <span className="muted">%</span>
      </div>
      <strong>-{fmt(discountCents)}</strong>
    </div>
    <div className="summary-row">
      <span style={{ fontSize: 16, fontWeight: 600 }}>Total</span>
      <span className="summary-total">{fmt(total)}</span>
    </div>
  </div>
);

export default BillSummary;
