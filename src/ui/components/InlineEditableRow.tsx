import React, { useState } from "react";
import type { Product } from "../../data/types";

type Props = {
  item: Product;
  onSave: (next: Product) => void;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (id: number) => void;
};

const InlineEditableRow: React.FC<Props> = ({ item, onSave, onToggle, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Product>(item);

  const save = () => {
    setEditing(false);
    onSave(draft);
  };

  return (
    <tr>
      <td>
        {editing ? (
          <input
            className="input"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        ) : (
          item.name
        )}
      </td>
      <td>
        {editing ? (
          <input
            className="input"
            value={draft.category ?? ""}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          />
        ) : (
          item.category || "—"
        )}
      </td>
      <td>
        {editing ? (
          <input
            className="input"
            value={(draft.price_cents / 100).toFixed(2)}
            onChange={(e) =>
              setDraft({
                ...draft,
                price_cents: Math.round(Number(e.target.value || "0") * 100)
              })
            }
          />
        ) : (
          `₹${(item.price_cents / 100).toFixed(2)}`
        )}
      </td>
      <td>
        <button
          className="button"
          onClick={() => onToggle(item.id, item.is_available !== 1)}
        >
          {item.is_available ? "Enabled" : "Disabled"}
        </button>
      </td>
      <td>
        {editing ? (
          <div className="row">
            <button className="button success" onClick={save}>
              Save
            </button>
            <button className="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="row">
            <button className="button" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="button danger" onClick={() => onDelete(item.id)}>
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  );
};

export default InlineEditableRow;
