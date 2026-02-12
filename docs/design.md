# Meet & Eat POS — Lightweight Desktop Billing System

## Goals

- Offline-only, fast startup, minimal RAM/CPU usage.
- Keyboard-first, large fonts, clean Tamil restaurant style.
- Tauri + React (functional) + Bun backend + SQLite local DB.

---

## Database Schema (SQLite)

File: `db/schema.sql`

### Design choices

- Integer cents for price math (no float).
- WAL mode for speed and crash-safety.
- Indexed columns for fast product search & bill history.

---

## Folder Structure (proposed)

```text
Restaurant-Pos/
  src/
    ui/
      components/
        Sidebar.tsx
        ProductSearch.tsx
        QtyStepper.tsx
        BillSummary.tsx
        BillTable.tsx
        InlineEditableRow.tsx
        Pagination.tsx
      pages/
        BillingPage.tsx
        CategoriesPage.tsx
        BillHistoryPage.tsx
        BackupPage.tsx
    data/
      db.ts
      queries.ts
      types.ts
    app/
      App.tsx
      lazy.ts
      theme.css
  src-tauri/
    tauri.conf.json
    src/
      main.rs
      commands.rs
  bun/
    server.ts
    db.ts
    migrations/
      schema.sql
  db/
    app.db
    schema.sql
  docs/
    design.md
```

Notes:

- `src/` is React UI bundle.
- `bun/` hosts lightweight API and SQLite access.
- Tauri bridges UI <-> Bun backend.

---

## Core React Components (functional)

### `Sidebar.tsx`

- 4 fixed items: Billing, Categories, Bill History, Backup
- No nested menus, no animation, minimal DOM

### `ProductSearch.tsx`

- Input with debounced lookup (30–50ms)
- Arrow-key navigation, Enter to add
- Uses indexed query: `products(name LIKE ? AND is_available = 1)`

### `QtyStepper.tsx`

- `-` and `+` buttons
- Keyboard shortcuts: `[` decrement, `]` increment

### `BillSummary.tsx`

- Subtotal, tax rate (bps), total
- Toggle to apply tax (stored in settings)

### `BillTable.tsx`

- Flat list, no virtualization needed for small bills
- Memoized row render to avoid re-renders

### `InlineEditableRow.tsx`

- For Categories page table
- Click-to-edit with inline inputs

### `Pagination.tsx`

- Simple prev/next + page number

---

## Page Details

### 1) Billing Page

- Default landing page
- Product search focused on load
- Add items quickly, adjust qty
- Total auto-calculated
- One-click **Generate Bill**
- Save bill + items in SQLite
- Print-friendly layout via CSS `@media print`
- Thermal printer support via Tauri print API

### 2) Categories Page

- CRUD for food items
- Simple table with inline edit
- Availability toggle
- Minimal validation
- Optimized queries: `INSERT/UPDATE` with prepared statements

### 3) Bill History Page

- List with pagination: `LIMIT ? OFFSET ?`
- Filters: date range + bill number
- Click row to view details
- Reprint button

### 4) Backup Page

- Manual backup
- Scheduled automatic backup (daily, configurable)
- Backup local DB file to folder or external drive
- Restore button

---

## Tauri + Bun Integration (recommended)

### Runtime model

- Bun runs as a local backend service with SQLite access.
- Tauri frontend makes IPC calls to Bun via local HTTP (localhost) or direct Tauri commands.

### Option A: Tauri command -> Bun

- Tauri invokes Bun executable for DB operations via commands.
- Pros: No HTTP server overhead.
- Cons: Slight complexity in command wiring.

### Option B: Bun server

- Bun starts a minimal local HTTP server at app launch.
- React calls local endpoints for DB queries.
- Pros: Simple API patterns.
- Cons: tiny server overhead.

### Recommendation

**Recommended for low-end hardware:** Option A with direct Tauri command calls.

---

## Backup Strategy

- Scheduled backups via Tauri background task (timer persisted in `settings`).
- Backups are file copies of `db/app.db` into:
  - Local folder (default: `~/MeetAndEat/backups/`)
  - Optional external drive path if available
- File naming: `meet-eat-YYYYMMDD-HHMMSS.db`
- Restore: select backup file -> replace active DB -> restart app.
- Ensure safe copy: copy to temp then rename.

---

## Performance Considerations

- Avoid global state; use local state + memoization.
- Use prepared statements in Bun.
- Use indexed queries for search & history.
- Lazy-load page components.
- Keep CSS minimal (no heavy UI frameworks).
- Avoid SVG-heavy icons; prefer text or simple inline SVG.
- Use `React.memo` for row components.

---

## Suggested Settings Defaults

- `tax_rate_bps = 0`
- `bill_seq = 0`
- `backup_interval_minutes = 1440` (daily)
- `backup_path = ~/MeetAndEat/backups`
