import React from "react";
import QtyStepper from "./QtyStepper";
import type { BillItem } from "../../data/types";

type Props = {
  items: BillItem[];
  onQtyChange: (productId: number, qty: number) => void;
  onRemove: (productId: number) => void;
};

const BillTable: React.FC<Props> = ({ items, onQtyChange, onRemove }) => {
  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Price</th>
            <th>Qty</th>
            <th>Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.product_id}>
              <td>{it.product_name}</td>
              <td>₹{(it.unit_price_cents / 100).toFixed(2)}</td>
              <td>
                <QtyStepper
                  value={it.qty}
                  onChange={(q) => onQtyChange(it.product_id, q)}
                />
              </td>
              <td>₹{(it.line_total_cents / 100).toFixed(2)}</td>
              <td>
                <button className="button danger" onClick={() => onRemove(it.product_id)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">No items added</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default React.memo(BillTable);
