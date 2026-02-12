import React, { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../../data/api";
import type { Product } from "../../data/types";
import InlineEditableRow from "../components/InlineEditableRow";

const MenuItemsPage: React.FC = () => {
  const [items, setItems] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [mealPeriod, setMealPeriod] = useState<"Breakfast" | "Lunch" | "Dinner">(
    "Breakfast",
  );
  const [price, setPrice] = useState("0");
  const [status, setStatus] = useState<string | null>(null);

  const load = async () => {
    const data = await apiGet<Product[]>("/products");
    setItems(data);
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    if (!name.trim()) return;
    setStatus(null);
    try {
      await apiPost("/products", {
        name: name.trim(),
        category: mealPeriod,
        price_cents: Math.round(Number(price || "0") * 100),
      });
      setName("");
      setMealPeriod("Breakfast");
      setPrice("0");
      await load();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to add item");
    }
  };

  const save = async (next: Product) => {
    await apiPut(`/products/${next.id}`, next);
    await load();
  };

  const toggle = async (id: number, enabled: boolean) => {
    await apiPut(`/products/${id}/availability`, { is_available: enabled ? 1 : 0 });
    await load();
  };

  const remove = async (id: number) => {
    setStatus(null);
    try {
      await apiDelete(`/products/${id}`);
      await load();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to delete item");
    }
  };

  return (
    <div>
      <div className="page-title">Menu Items</div>
      <div className="card">
        <div className="row" style={{ gap: 16 }}>
          <input
            className="input"
            placeholder="Product Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 2, minWidth: 120 }}
          />
          <select
            className="select"
            value={mealPeriod}
            onChange={(e) => setMealPeriod(e.target.value as typeof mealPeriod)}
            style={{ width: 170, minWidth: 150 }}
          >
            <option value="Breakfast">Breakfast</option>
            <option value="Lunch">Lunch</option>
            <option value="Dinner">Dinner</option>
          </select>
          <input
            className="input"
            placeholder="Price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={{ flex: 1, minWidth: 80, textAlign: "right" }}
          />
          <button className="button success" style={{ minWidth: 80 }} onClick={add}>
            Add
          </button>
        </div>
        {status ? <div className="muted" style={{ marginTop: 8 }}>{status}</div> : null}
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th style={{ textAlign: "center", width: "10%" }}>Item No</th>
              <th style={{ textAlign: "left", width: "30%" }}>Name</th>
              <th style={{ textAlign: "left", width: "18%" }}>Meals Period</th>
              <th style={{ textAlign: "right", width: "14%" }}>Price</th>
              <th style={{ textAlign: "center", width: "14%" }}>Availability</th>
              <th style={{ textAlign: "center", width: "14%" }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <InlineEditableRow
                key={it.id}
                item={it}
                onSave={save}
                onToggle={toggle}
                onDelete={remove}
              />
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">No items yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MenuItemsPage;
