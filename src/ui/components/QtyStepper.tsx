import React from "react";

type Props = {
  value: number;
  onChange: (next: number) => void;
};

const QtyStepper: React.FC<Props> = ({ value, onChange }) => (
  <div className="qty-stepper">
    <button type="button" onClick={() => onChange(Math.max(1, value - 1))} aria-label="Decrease">&minus;</button>
    <div className="qty-value">{value}</div>
    <button type="button" onClick={() => onChange(value + 1)} aria-label="Increase">+</button>
  </div>
);

export default QtyStepper;
