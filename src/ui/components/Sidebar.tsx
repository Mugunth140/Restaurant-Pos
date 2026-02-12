import React from "react";
import type { PageKey } from "../../App";

type Props = {
  active: PageKey;
  onChange: (page: PageKey) => void;
};

const Sidebar: React.FC<Props> = ({ active, onChange }) => {
  return (
    <aside className="sidebar">
      <div className="brand">Meet & Eat</div>
      <button
        className={`nav-button ${active === "billing" ? "active" : ""}`}
        onClick={() => onChange("billing")}
      >
        Billing
      </button>
      <button
        className={`nav-button ${active === "categories" ? "active" : ""}`}
        onClick={() => onChange("categories")}
      >
        Categories
      </button>
      <button
        className={`nav-button ${active === "history" ? "active" : ""}`}
        onClick={() => onChange("history")}
      >
        Bill History
      </button>
      <button
        className={`nav-button ${active === "backup" ? "active" : ""}`}
        onClick={() => onChange("backup")}
      >
        Backup
      </button>
    </aside>
  );
};

export default Sidebar;
