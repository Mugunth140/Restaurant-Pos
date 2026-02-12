import React from "react";
import type { PageKey } from "../../App";

type Props = {
  active: PageKey;
  onChange: (page: PageKey) => void;
  open?: boolean;
  onClose?: () => void;
};

const Sidebar: React.FC<Props> = ({ active, onChange, open = false, onClose }) => {
  const go = (p: PageKey) => {
    onChange(p);
    onClose?.();
  };

  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand">Meet & Eat</div>
      <button className="nav-button mobile-only no-print" onClick={() => onClose?.()}>
        Close
      </button>
      <button
        className={`nav-button ${active === "billing" ? "active" : ""}`}
        onClick={() => go("billing")}
      >
        Billing
      </button>
      <button
        className={`nav-button ${active === "categories" ? "active" : ""}`}
        onClick={() => go("categories")}
      >
        Menu Items
      </button>
      <button
        className={`nav-button ${active === "history" ? "active" : ""}`}
        onClick={() => go("history")}
      >
        Bill History
      </button>
      <button
        className={`nav-button ${active === "backup" ? "active" : ""}`}
        onClick={() => go("backup")}
      >
        Backup
      </button>
    </aside>
  );
};

export default Sidebar;
