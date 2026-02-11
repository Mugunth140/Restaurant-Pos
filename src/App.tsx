import React, { Suspense, useMemo, useState } from "react";
import Sidebar from "./ui/components/Sidebar";
import { pages } from "./app/lazy";

export type PageKey = "billing" | "categories" | "history" | "backup";

const App: React.FC = () => {
  const [page, setPage] = useState<PageKey>("billing");

  const CurrentPage = useMemo(() => pages[page], [page]);

  return (
    <div className="app">
      <Sidebar active={page} onChange={setPage} />
      <main className="main">
        <Suspense fallback={<div className="card">Loading…</div>}>
          <CurrentPage />
        </Suspense>
      </main>
    </div>
  );
};

export default App;
