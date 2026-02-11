import React from "react";

type Props = {
  subtotal: number;
  taxRateBps: number;
  taxCents: number;
  total: number;
  onTaxRateChange: (bps: number) => void;
};

const BillSummary: React.FC<Props> = ({
  subtotal,
  taxRateBps,
  taxCents,
  total,
  onTaxRateChange
}) => {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>Subtotal</div>
        <strong>₹{(subtotal / 100).toFixed(2)}</strong>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <div className="row">
          <span>Tax</span>
          <input
            className="input"
            style={{ width: 90, marginLeft: 8 }}
            value={(taxRateBps / 100).toFixed(2)}
            onChange={(e) => {
              const v = Number(e.target.value);
              onTaxRateChange(Number.isFinite(v) ? Math.round(v * 100) : 0);
            }}
          />
          <span className="muted">%</span>
        </div>
        <strong>₹{(taxCents / 100).toFixed(2)}</strong>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <div>Total</div>
        <strong>₹{(total / 100).toFixed(2)}</strong>
      </div>
    </div>
  );
};

export default BillSummary;
