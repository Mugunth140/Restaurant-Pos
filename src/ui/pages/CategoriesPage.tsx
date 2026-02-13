import React, { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../../data/api";
import type { Product } from "../../data/types";
import InlineEditableRow from "../components/InlineEditableRow";

const FIXED_CATEGORIES = ["Breakfast", "Lunch", "Dinner"];

const MenuItemsPage: React.FC = () => {
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(FIXED_CATEGORIES);
  const [name, setName] = useState("");
  // default category for new items
  const [category, setCategory] = useState("Breakfast");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "error">("success");

  const load = async () => {
    // always keep the three fixed categories available even if APIs fail
    setCategories(FIXED_CATEGORIES);
    setCategory((c) => (c && FIXED_CATEGORIES.includes(c) ? c : "Breakfast"));

    const productsResult = await Promise.allSettled([apiGet<Product[]>("/products")]);

    if (productsResult[0].status === "fulfilled") {
      setItems(productsResult[0].value);
    } else {
      // keep previous list to avoid wiping UI on temporary backend/network failures
      showStatus("Unable to refresh menu items. Please check backend connection.", "error");
    }
  };

  useEffect(() => { void load(); }, []);

  const showStatus = (msg: string, type: "success" | "error" = "success") => {
    setStatus(msg);
    setStatusType(type);
    setTimeout(() => setStatus(null), 3000);
  };

  const add = async () => {
    if (!name.trim()) return;
    const priceCents = Math.round(Number(price || "0") * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      showStatus("Enter a valid price", "error");
      return;
    }
    setSaving(true);
    try {
      await apiPost("/products", {
        name: name.trim(),
        category: category || null,
        price_cents: priceCents,
      });
      setName(""); setCategory("Breakfast"); setPrice("");
      showStatus("Item added successfully");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add item";
      showStatus(msg.includes("fetch") ? "Cannot reach backend. Start app backend and retry." : msg, "error");
    } finally {
      setSaving(false);
    }
  };

  const save = async (next: Product) => {
    try {
      await apiPut("/products/" + next.id, next);
      showStatus("Item updated");
      await load();
    } catch (e) {
      showStatus(e instanceof Error ? e.message : "Failed to update", "error");
    }
  };

  const toggle = async (id: number, enabled: boolean) => {
    await apiPut("/products/" + id + "/availability", { is_available: enabled ? 1 : 0 });
    await load();
  };

  const remove = async (id: number) => {
    try {
      await apiDelete("/products/" + id);
      showStatus("Item removed");
      await load();
    } catch (e) {
      showStatus(e instanceof Error ? e.message : "Failed to delete", "error");
    }
  };

  return (
    <div>
      <div className="page-title">Menu Items</div>

      <div className="card">
        <div className="card-header">Add New Item</div>
        <div className="add-item-form">
          <input
            className="input"
            placeholder="Product name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          />
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            className="input"
            placeholder="Price (₹)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={{ textAlign: "right" }}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          />
          <button className="button success" onClick={add} disabled={saving}>
            {saving ? "Adding" : "Add Item"}
          </button>
        </div>
        {status && <div className={"toast toast-" + statusType}>{status}</div>}
      </div>

      <div className="card">
        <div className="card-header">{items.length} Item{items.length !== 1 ? "s" : ""}</div>
        <table className="table menu-table">
          <colgroup>
            <col className="col-no" />
            <col className="col-name" />
            <col className="col-category" />
            <col className="col-price" />
            <col className="col-status" />
            <col className="col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th className="text-center">No</th>
              <th>Name</th>
              <th>Category</th>
              <th className="text-right">Price</th>
              <th className="text-center">Status</th>
              <th className="text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <InlineEditableRow
                key={it.id}
                item={it}
                categories={categories}
                onSave={save}
                onToggle={toggle}
                onDelete={remove}
              />
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">No menu items yet. Add one above.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MenuItemsPage;
