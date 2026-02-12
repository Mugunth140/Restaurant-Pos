import React, { useEffect, useMemo, useState } from "react";
import type { Product } from "../../data/types";

type Props = {
  onSelect: (product: Product) => void;
  search: (q: string) => Promise<Product[]>;
  inputId?: string;
};

const ProductSearch: React.FC<Props> = ({ onSelect, search, inputId }) => {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      if (!query.trim()) { setItems([]); setActive(0); return; }
      const result = await search(query.trim());
      if (alive) { setItems(result); setActive(0); }
    }, 80);
    return () => { alive = false; clearTimeout(t); };
  }, [query, search]);

  const pick = (p: Product) => {
    onSelect(p);
    setQuery("");
    setItems([]);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (items.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((v) => (v + 1) % items.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((v) => (v - 1 + items.length) % items.length); }
    if (e.key === "Enter") { e.preventDefault(); pick(items[active]); }
  };

  const hint = useMemo(() => {
    if (!query) return "Type item name or number";
    if (items.length === 0) return "No matches";
    return items.length + " match" + (items.length !== 1 ? "es" : "") + " \u2014 \u2191\u2193 to select, Enter to add";
  }, [query, items.length]);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <input
          id={inputId}
          className="input"
          style={{ flex: 1 }}
          placeholder="Search by name or item no"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          autoFocus
        />
        <span className="muted" style={{ marginLeft: 12, fontSize: 13, whiteSpace: "nowrap" }}>{hint}</span>
      </div>
      {items.length > 0 && (
        <div className="search-dropdown list">
          {items.map((p, i) => (
            <div
              key={p.id}
              className={"search-item" + (i === active ? " active" : "")}
              onMouseDown={() => pick(p)}
            >
              <div className="row" style={{ gap: 8 }}>
                {p.item_no ? <span className="badge">{p.item_no}</span> : null}
                <strong>{p.name}</strong>
                {p.category ? <span className="muted" style={{ fontSize: 13 }}>  {p.category}</span> : null}
              </div>
              <strong>₹{(p.price_cents / 100).toFixed(2)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductSearch;
