import React, { useState } from "react";
import type { Product } from "../../data/types";

type Props = {
  item: Product;
  categories: string[];
  onSave: (next: Product) => void;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (id: number) => void;
};

const InlineEditableRow: React.FC<Props> = ({ item, categories, onSave, onToggle, onDelete }) => {
  const [editing, setEditing] = useState(false);
  // default category to "Breakfast" when missing so selector shows a sensible default
  const [draft, setDraft] = useState<Product>({ ...item, category: item.category ?? "Breakfast" });

  const save = () => {
    setEditing(false);
    onSave({ ...draft, category: (draft.category ?? "Breakfast") as string });
  };
  const cancel = () => { setEditing(false); setDraft({ ...item, category: item.category ?? "Breakfast" }); };

  return (
    <tr>
      <td className="text-center">
        {item.item_no ? <span className="badge">{item.item_no}</span> : <span className="muted">—</span>}
      </td>
      <td>
        {editing ? (
          <input className="input" style={{ width: "100%" }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        ) : (
          <strong>{item.name}</strong>
        )}
      </td>
      <td>
        {editing ? (
          <select className="select" value={(draft.category ?? "Breakfast") as string} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          (item.category ?? "Breakfast") || <span className="muted">—</span>
        )}
      </td>
      <td className="text-right">
        {editing ? (
          <input className="input" style={{ width: 90, textAlign: "right" }} value={(draft.price_cents / 100).toFixed(2)} onChange={(e) => setDraft({ ...draft, price_cents: Math.round(Number(e.target.value || "0") * 100) })} />
        ) : (
          <span>{"\u20B9" + (item.price_cents / 100).toFixed(2)}</span>
        )}
      </td>
      <td className="text-center">
        <button
          className={"button button-sm" + (item.is_available ? "" : " danger")}
          onClick={() => onToggle(item.id, item.is_available !== 1)}
          style={{ minWidth: 80 }}
        >
          <span className={"status-dot" + (item.is_available ? " active" : "")} />
          {item.is_available ? "Active" : "Inactive"}
        </button>
      </td>
      <td className="text-center">
        {editing ? (
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="button button-sm success" onClick={save}>Save</button>
            <button className="button button-sm" onClick={cancel}>Cancel</button>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="button button-sm" onClick={() => { setDraft(item); setEditing(true); }}>Edit</button>
            <button className="button button-sm danger" onClick={() => onDelete(item.id)}>Delete</button>
          </div>
        )}
      </td>
    </tr>
  );
};

export default InlineEditableRow;
