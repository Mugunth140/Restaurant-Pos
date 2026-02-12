import React, { useEffect, useMemo, useState } from "react";
import type { Product } from "../../data/types";

type Props = {
  onSelect: (product: Product) => void;
  search: (q: string) => Promise<Product[]>;
};

const ProductSearch: React.FC<Props> = ({ onSelect, search }) => {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setItems([]);
        setActive(0);
        return;
      }
      const result = await search(query.trim());
      if (alive) {
        setItems(result);
        setActive(0);
      }
    }, 50);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, search]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((v) => (v + 1) % items.length);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((v) => (v - 1 + items.length) % items.length);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      onSelect(items[active]);
      setQuery("");
      setItems([]);
    }
  };

  const hint = useMemo(() => {
    if (!query) return "Type item name…";
    if (items.length === 0) return "No items";
    return "↑ ↓ to select, Enter to add";
  }, [query, items.length]);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Search items (Idly, Dosa, Pongal…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          autoFocus
        />
        <span className="muted" style={{ marginLeft: 12 }}>{hint}</span>
      </div>
      {items.length > 0 && (
        <div className="list" style={{ marginTop: 8 }}>
          {items.map((p, i) => (
            <div
              key={p.id}
              className="row"
              style={{
                padding: "6px 8px",
                background: i === active ? "var(--list-active-bg)" : "transparent",
                borderRadius: 6,
                cursor: "pointer",
                justifyContent: "space-between"
              }}
              onMouseDown={() => onSelect(p)}
            >
              <div>
                {p.item_no ? <span className="badge" style={{ marginRight: 8 }}>{p.item_no}</span> : null}
                <strong>{p.name}</strong>
                {p.category ? <span className="muted"> · {p.category}</span> : null}
              </div>
              <div>₹{(p.price_cents / 100).toFixed(2)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductSearch;
