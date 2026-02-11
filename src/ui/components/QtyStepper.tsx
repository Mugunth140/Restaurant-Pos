import React from "react";

type Props = {
  value: number;
  onChange: (next: number) => void;
};

const QtyStepper: React.FC<Props> = ({ value, onChange }) => {
  return (
    <div className="row">
      <button className="button" onClick={() => onChange(Math.max(1, value - 1))}>
        -
      </button>
      <div style={{ minWidth: 24, textAlign: "center" }}>{value}</div>
      <button className="button" onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
};

export default QtyStepper;
