import db from "./db";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const PORT = 7777;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });

const text = (data: string, status = 200) =>
  new Response(data, { status, headers: { "Content-Type": "text/plain" } });

const getSetting = (key: string, fallback: string) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
};

const setSetting = (key: string, value: string) => {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, value);
};

let backupTimer: ReturnType<typeof setInterval> | null = null;

const scheduleBackup = () => {
  if (backupTimer) clearInterval(backupTimer);
  const minutes = Number(getSetting("backup_interval_minutes", "1440"));
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  backupTimer = setInterval(() => {
    const target = getSetting("backup_path", join(process.cwd(), "backups"));
    runBackup(target);
  }, minutes * 60 * 1000);
};

const runBackup = (targetDir: string) => {
  const ts = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const file = `meat-eat-${ts}.db`;
  const outDir = targetDir;
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const src = join(process.cwd(), "db", "app.db");
  const dst = join(outDir, file);
  cpSync(src, dst);
  return dst;
};

scheduleBackup();

Bun.serve({
  port: PORT,
  fetch: async (req) => {
    const url = new URL(req.url);
    const { pathname, searchParams } = url;

    if (pathname === "/health") return json({ ok: true });

    if (pathname === "/products" && req.method === "GET") {
      const rows = db
        .prepare(
          "SELECT p.id, p.name, c.name as category, p.price_cents, p.is_available FROM products p LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.name"
        )
        .all();
      return json(rows);
    }

    if (pathname === "/products/search" && req.method === "GET") {
      const q = searchParams.get("q") ?? "";
      const rows = db
        .prepare(
          "SELECT p.id, p.name, c.name as category, p.price_cents, p.is_available FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.is_available = 1 AND p.name LIKE ? ORDER BY p.name LIMIT 20"
        )
        .all(`%${q}%`);
      return json(rows);
    }

    if (pathname === "/products" && req.method === "POST") {
      const body = await req.json();
      const categoryId = body.category
        ? (db.prepare("INSERT OR IGNORE INTO categories(name) VALUES (?)").run(body.category),
          (db.prepare("SELECT id FROM categories WHERE name = ?").get(body.category) as { id: number }).id)
        : null;
      db.prepare(
        "INSERT INTO products(name, category_id, price_cents, is_available) VALUES(?,?,?,1)"
      ).run(body.name, categoryId, body.price_cents);
      return json({ ok: true });
    }

    const productMatch = pathname.match(/^\/products\/(\d+)$/);
    if (productMatch && req.method === "PUT") {
      const id = Number(productMatch[1]);
      const body = await req.json();
      const categoryId = body.category
        ? (db.prepare("INSERT OR IGNORE INTO categories(name) VALUES (?)").run(body.category),
          (db.prepare("SELECT id FROM categories WHERE name = ?").get(body.category) as { id: number }).id)
        : null;
      db.prepare(
        "UPDATE products SET name = ?, category_id = ?, price_cents = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(body.name, categoryId, body.price_cents, id);
      return json({ ok: true });
    }

    const availabilityMatch = pathname.match(/^\/products\/(\d+)\/availability$/);
    if (availabilityMatch && req.method === "PUT") {
      const id = Number(availabilityMatch[1]);
      const body = await req.json();
      db.prepare("UPDATE products SET is_available = ? WHERE id = ?").run(
        body.is_available,
        id
      );
      return json({ ok: true });
    }

    if (productMatch && req.method === "DELETE") {
      const id = Number(productMatch[1]);
      db.prepare("DELETE FROM products WHERE id = ?").run(id);
      return json({ ok: true });
    }

    if (pathname === "/bills" && req.method === "POST") {
      const body = await req.json();
      const items = body.items as Array<{
        product_id: number;
        product_name: string;
        unit_price_cents: number;
        qty: number;
        line_total_cents: number;
      }>;
      const subtotal = items.reduce((sum, it) => sum + it.line_total_cents, 0);
      const taxRateBps = Number(body.tax_rate_bps || 0);
      const taxCents = Math.round((subtotal * taxRateBps) / 10000);
      const total = subtotal + taxCents;

      const seq = Number(getSetting("bill_seq", "0")) + 1;
      const billNo = `MNE-${String(seq).padStart(6, "0")}`;
      setSetting("bill_seq", String(seq));

      const result = db
        .prepare(
          "INSERT INTO bills(bill_no, subtotal_cents, tax_rate_bps, tax_cents, total_cents) VALUES(?,?,?,?,?)"
        )
        .run(billNo, subtotal, taxRateBps, taxCents, total);
      const billId = Number(result.lastInsertRowid);
      const stmt = db.prepare(
        "INSERT INTO bill_items(bill_id, product_id, product_name, unit_price_cents, qty, line_total_cents) VALUES(?,?,?,?,?,?)"
      );
      const tx = db.transaction(() => {
        for (const it of items) {
          stmt.run(billId, it.product_id, it.product_name, it.unit_price_cents, it.qty, it.line_total_cents);
        }
      });
      tx();
      return json({ bill_no: billNo });
    }

    if (pathname === "/bills" && req.method === "GET") {
      const page = Number(searchParams.get("page") || "1");
      const limit = Number(searchParams.get("limit") || "10");
      const billNo = searchParams.get("bill_no") || "";
      const start = searchParams.get("start") || "";
      const end = searchParams.get("end") || "";

      const where: string[] = [];
      const params: unknown[] = [];
      if (billNo) {
        where.push("bill_no LIKE ?");
        params.push(`%${billNo}%`);
      }
      if (start) {
        where.push("date(created_at) >= date(?)");
        params.push(start);
      }
      if (end) {
        where.push("date(created_at) <= date(?)");
        params.push(end);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const totalRow = db
        .prepare(`SELECT COUNT(*) as count FROM bills ${whereSql}`)
        .get(...params) as { count: number };
      const rows = db
        .prepare(
          `SELECT id, bill_no, subtotal_cents, tax_rate_bps, tax_cents, total_cents, created_at FROM bills ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
        )
        .all(...params, limit, (page - 1) * limit);
      return json({ rows, total: totalRow.count });
    }

    const billMatch = pathname.match(/^\/bills\/(\d+)$/);
    if (billMatch && req.method === "GET") {
      const id = Number(billMatch[1]);
      const items = db
        .prepare(
          "SELECT product_id, product_name, unit_price_cents, qty, line_total_cents FROM bill_items WHERE bill_id = ?"
        )
        .all(id);
      return json({ items });
    }

    if (pathname === "/backup/settings" && req.method === "GET") {
      const backup_path = getSetting("backup_path", join(process.cwd(), "backups"));
      const backup_interval_minutes = Number(getSetting("backup_interval_minutes", "1440"));
      return json({ backup_path, backup_interval_minutes });
    }

    if (pathname === "/backup/settings" && req.method === "POST") {
      const body = await req.json();
      setSetting("backup_path", body.backup_path || join(process.cwd(), "backups"));
      setSetting("backup_interval_minutes", String(body.backup_interval_minutes || 1440));
      scheduleBackup();
      return json({ ok: true });
    }

    if (pathname === "/backup/run" && req.method === "POST") {
      const body = await req.json();
      const target = body.target || getSetting("backup_path", join(process.cwd(), "backups"));
      const file = runBackup(target);
      return json({ file });
    }

    if (pathname === "/backup/restore" && req.method === "POST") {
      const body = await req.json();
      const src = body.source as string;
      if (!src || !existsSync(src)) return text("Backup not found", 404);
      const dst = join(process.cwd(), "db", "app.db");
      cpSync(src, dst);
      return json({ ok: true });
    }

    return text("Not found", 404);
  }
});

console.log(`Bun API running on http://127.0.0.1:${PORT}`);
