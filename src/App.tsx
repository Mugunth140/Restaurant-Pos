import React, { Suspense, useMemo, useState } from "react";
import { pages } from "./app/lazy";
import Sidebar from "./ui/components/Sidebar";

export type PageKey = "billing" | "categories" | "history" | "backup";

const App: React.FC = () => {
  const [page, setPage] = useState<PageKey>("billing");
  const [navOpen, setNavOpen] = useState(false);

  const CurrentPage = useMemo(() => pages[page], [page]);

  const changePage = (next: PageKey) => {
    setPage(next);
    setNavOpen(false);
  };

  return (
    <div className="app">
      {navOpen ? <div className="backdrop" onMouseDown={() => setNavOpen(false)} /> : null}

      <header className="topbar no-print">
        <button
          className="icon-button"
          aria-label="Open menu"
          onClick={() => setNavOpen(true)}
        >
          ☰
        </button>
        <div className="brand">Meet & Eat</div>
        <div style={{ width: 40 }} />
      </header>

      <Sidebar active={page} onChange={changePage} open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="main">
        <Suspense fallback={<div className="card">Loading…</div>}>
          <CurrentPage />
        </Suspense>
      </main>
    </div>
  );
};

export default App;
