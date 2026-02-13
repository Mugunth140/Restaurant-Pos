import React from "react";
import type { PageKey } from "../../App";

type Props = {
  active: PageKey;
  onChange: (page: PageKey) => void;
  open?: boolean;
  onClose?: () => void;
};

const navItems: { key: PageKey; label: string }[] = [
  { key: "billing", label: "Billing" },
  { key: "categories", label: "Menu Items" },
  { key: "history", label: "Bill History" },
  { key: "backup", label: "Backup" },
];

const Sidebar: React.FC<Props> = ({ active, onChange, open = false, onClose }) => {
  const go = (p: PageKey) => {
    onChange(p);
    onClose?.();
  };

  return (
    <aside className={"sidebar" + (open ? " open" : "")}>
      <div className="brand">Meet &amp; Eat</div>
      {navItems.map((item) => (
        <button
          key={item.key}
          className={"nav-button" + (active === item.key ? " active" : "")}
          onClick={() => go(item.key)}
        >
          {item.label}
        </button>
      ))}
      <div className="sidebar-footer">v1.0.0</div>
    </aside>
  );
};

export default Sidebar;
