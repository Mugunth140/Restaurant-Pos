import React, { useEffect, useState } from "react";
import InlineEditableRow from "../components/InlineEditableRow";
import { apiDelete, apiGet, apiPost, apiPut } from "../../data/api";
import type { Product } from "../../data/types";

const CategoriesPage: React.FC = () => {
  const [items, setItems] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("0");

  const load = async () => {
    const data = await apiGet<Product[]>("/products");
    setItems(data);
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    if (!name.trim()) return;
    await apiPost("/products", {
      name: name.trim(),
      category: category.trim() || null,
      price_cents: Math.round(Number(price || "0") * 100)
    });
    setName("");
    setCategory("");
    setPrice("0");
    await load();
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
    await apiDelete(`/products/${id}`);
    await load();
  };

  return (
    <div>
      <div className="page-title">Categories</div>
      <div className="card">
        <div className="row">
          <input
            className="input"
            placeholder="Product Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input"
            placeholder="Category (optional)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <input
            className="input"
            placeholder="Price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <button className="button success" onClick={add}>
            Add
          </button>
        </div>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Price</th>
              <th>Availability</th>
              <th></th>
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
                <td colSpan={5} className="muted">No items yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CategoriesPage;
