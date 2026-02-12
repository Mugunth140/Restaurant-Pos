import React from "react";
import QtyStepper from "./QtyStepper";
import type { BillItem } from "../../data/types";

type Props = {
  items: BillItem[];
  onQtyChange: (productId: number, qty: number) => void;
  onRemove: (productId: number) => void;
};

const fmt = (cents: number) => "\u20B9" + (cents / 100).toFixed(2);

const BillTable: React.FC<Props> = ({ items, onQtyChange, onRemove }) => (
  <div className="card">
    <div className="card-header">Current Order ({items.length} item{items.length !== 1 ? "s" : ""})</div>
    <table className="table bill-table">
      <colgroup>
        <col className="col-item" />
        <col className="col-price" />
        <col className="col-qty" />
        <col className="col-total" />
        <col className="col-actions" />
      </colgroup>
      <thead>
        <tr>
          <th>Item</th>
          <th className="text-right">Price</th>
          <th className="text-center">Qty</th>
          <th className="text-right">Total</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.product_id}>
            <td><strong>{it.product_name}</strong></td>
            <td className="text-right">{fmt(it.unit_price_cents)}</td>
            <td className="text-center">
              <QtyStepper value={it.qty} onChange={(q) => onQtyChange(it.product_id, q)} />
            </td>
            <td className="text-right"><strong>{fmt(it.line_total_cents)}</strong></td>
            <td className="text-center">
              <button
                className="button button-sm danger"
                onClick={() => onRemove(it.product_id)}
                title="Remove item"
              >&times;</button>
            </td>
          </tr>
        ))}
        {items.length === 0 && (
          <tr>
            <td colSpan={5}>
              <div className="empty-state">Search above to add items to the order</div>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

export default React.memo(BillTable);
