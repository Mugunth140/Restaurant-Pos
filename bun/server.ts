import { cpSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import db from "./db";

const PORT = Number(process.env.MEATEAT_POS_PORT || "7777");
const DEFAULT_DB_DIR = join(process.cwd(), "db");
const ENV_DB_DIR_RAW = (
  process.env.MEATEAT_POS_DATA_DIR ??
  process.env.POS_DATA_DIR ??
  process.env.MEATEAT_DATA_DIR ??
  process.env.MEATEAT_DB_DIR ??
  ""
).trim();
const DB_DIR = ENV_DB_DIR_RAW || DEFAULT_DB_DIR;
const DB_PATH = join(DB_DIR, "app.db");
// Default backups live alongside the database directory when DB_DIR points to a db folder.
const DEFAULT_BACKUP_DIR =
  basename(DB_DIR) === "db"
    ? join(DB_DIR, "..", "backups")
    : join(DB_DIR, "backups");

// ── helpers ──────────────────────────────────────────────────────────────────

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const textRes = (msg: string, status = 200) =>
  new Response(msg, {
    status,
    headers: { "Content-Type": "text/plain", ...corsHeaders },
  });

const getSetting = (key: string, fallback: string): string => {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
};

const setSetting = (key: string, value: string) => {
  db.prepare(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, value);
};

const toDateOnly = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
};

// ── backup logic ─────────────────────────────────────────────────────────────

let backupTimer: ReturnType<typeof globalThis.setInterval> | null = null;

const scheduleBackup = () => {
  if (backupTimer) clearInterval(backupTimer);
  const minutes = Number(getSetting("backup_interval_minutes", "1440"));
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  backupTimer = setInterval(() => {
    try {
      const target = getSetting("backup_path", DEFAULT_BACKUP_DIR);
      doBackup(target);
      console.log("[backup] auto-backup OK");
    } catch (e) {
      console.error("[backup] auto-backup failed:", e);
    }
  }, minutes * 60_000);
};

const doBackup = (targetDir: string): string => {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
  const fileName = `meet-eat-${ts}.db`;
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  const src = DB_PATH;
  const dst = join(targetDir, fileName);
  const tmp = `${dst}.tmp`;
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {}
  cpSync(src, tmp);
  renameSync(tmp, dst);
  return dst;
};

scheduleBackup();

// ── category helper ──────────────────────────────────────────────────────────

const resolveCategoryId = (name: string | null | undefined): number | null => {
  if (!name) return null;
  db.prepare("INSERT OR IGNORE INTO categories(name) VALUES (?)").run(name);
  const row = db
    .prepare("SELECT id FROM categories WHERE name = ?")
    .get(name) as {
    id: number;
  };
  return row.id;
};

// ── server ───────────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  fetch: async (req: Request): Promise<Response> => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(req.url);
    const { pathname, searchParams } = url;

    try {
      /* ────── health ────── */
      if (pathname === "/health") return json({ ok: true });

      /* ────── metrics ──────
         Exposes small monitoring info useful for scaling checks:
         - total number of bills in the database
         - current database file size (bytes)
      */
      if (pathname === "/metrics" && req.method === "GET") {
        try {
          const row = db
            .prepare("SELECT COUNT(*) as count FROM bills")
            .get() as { count: number } | undefined;
          const dbStat = statSync(DB_PATH);
          return json({
            bills: Number(row?.count ?? 0),
            db_size_bytes: dbStat.size,
          });
        } catch (e: unknown) {
          console.error("[metrics] error:", e);
          return json(
            { error: e instanceof Error ? e.message : String(e) },
            500,
          );
        }
      }

      /* ══════════════════════════════════════════════════════════════════
         PRODUCTS
         ══════════════════════════════════════════════════════════════════ */

      if (pathname === "/products/search" && req.method === "GET") {
        const q = searchParams.get("q") ?? "";
        const rows = db
          .prepare(
            `SELECT p.id, p.name, c.name as category, p.price_cents, p.is_available
             FROM products p LEFT JOIN categories c ON p.category_id = c.id
             WHERE p.is_available = 1 AND p.name LIKE ?1
             ORDER BY p.name LIMIT 20`,
          )
          .all(`%${q}%`);
        return json(rows);
      }

      if (pathname === "/products" && req.method === "GET") {
        const rows = db
          .prepare(
            `SELECT p.id, p.name, c.name as category, p.price_cents, p.is_available
             FROM products p LEFT JOIN categories c ON p.category_id = c.id
             ORDER BY p.name`,
          )
          .all();
        return json(rows);
      }

      if (pathname === "/products" && req.method === "POST") {
        const body = (await req.json()) as {
          name: string;
          category: string | null;
          price_cents: number;
        };
        const catId = resolveCategoryId(body.category);
        db.prepare(
          "INSERT INTO products(name, category_id, price_cents, is_available) VALUES(?1,?2,?3,1)",
        ).run(body.name, catId, body.price_cents);
        return json({ ok: true }, 201);
      }

      // /products/:id/availability
      const availMatch = pathname.match(/^\/products\/(\d+)\/availability$/);
      if (availMatch && req.method === "PUT") {
        const id = Number(availMatch[1]);
        const body = (await req.json()) as { is_available: number };
        db.prepare("UPDATE products SET is_available = ?1 WHERE id = ?2").run(
          body.is_available,
          id,
        );
        return json({ ok: true });
      }

      // /products/:id
      const prodMatch = pathname.match(/^\/products\/(\d+)$/);
      if (prodMatch && req.method === "PUT") {
        const id = Number(prodMatch[1]);
        const body = (await req.json()) as {
          name: string;
          category: string | null;
          price_cents: number;
        };
        const catId = resolveCategoryId(body.category);
        db.prepare(
          "UPDATE products SET name=?1, category_id=?2, price_cents=?3, updated_at=datetime('now') WHERE id=?4",
        ).run(body.name, catId, body.price_cents, id);
        return json({ ok: true });
      }

      if (prodMatch && req.method === "DELETE") {
        const id = Number(prodMatch[1]);
        db.prepare("DELETE FROM products WHERE id = ?1").run(id);
        return json({ ok: true });
      }

      /* ══════════════════════════════════════════════════════════════════
         BILLS
         ══════════════════════════════════════════════════════════════════ */

      if (pathname === "/bills" && req.method === "POST") {
        const body = (await req.json()) as {
          items: Array<{
            product_id: number;
            product_name: string;
            unit_price_cents: number;
            qty: number;
            line_total_cents: number;
          }>;
          tax_rate_bps: number;
        };
        const rawItems = Array.isArray(body.items) ? body.items : [];
        if (rawItems.length === 0) return textRes("No items", 400);

        const items = rawItems
          .map((it) => {
            const qty = Math.max(
              1,
              Math.min(1000, Math.floor(Number(it.qty || 0))),
            );
            const unit = Math.max(
              0,
              Math.floor(Number(it.unit_price_cents || 0)),
            );
            const productId = Math.floor(Number(it.product_id || 0));
            const productName = String(it.product_name || "").trim();
            const lineTotal = qty * unit;
            return {
              product_id: productId,
              product_name: productName,
              unit_price_cents: unit,
              qty,
              line_total_cents: lineTotal,
            };
          })
          .filter((it) => it.product_id > 0 && it.product_name.length > 0);

        if (items.length === 0) return textRes("No valid items", 400);

        const subtotal = items.reduce((s, it) => s + it.line_total_cents, 0);
        const taxRateBps = Number(body.tax_rate_bps || 0);
        const taxCents = Math.round((subtotal * taxRateBps) / 10_000);
        const total = subtotal + taxCents;

        let billNo = "";

        const insertBill = db.prepare(
          "INSERT INTO bills(bill_no,subtotal_cents,tax_rate_bps,tax_cents,total_cents) VALUES(?1,?2,?3,?4,?5)",
        );
        const insertItem = db.prepare(
          "INSERT INTO bill_items(bill_id,product_id,product_name,unit_price_cents,qty,line_total_cents) VALUES(?1,?2,?3,?4,?5,?6)",
        );
        const ensureSeq = db.prepare(
          "INSERT OR IGNORE INTO settings(key,value) VALUES('bill_seq','0')",
        );
        const incrementSeq = db.prepare(
          "UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'bill_seq'",
        );
        const selectSeq = db.prepare(
          "SELECT value FROM settings WHERE key = 'bill_seq'",
        );

        const tx = db.transaction(() => {
          ensureSeq.run();
          incrementSeq.run();
          const row = selectSeq.get() as { value: string | number } | undefined;
          const seq = Math.max(1, Number(row?.value ?? 0));
          billNo = `MNE-${String(seq).padStart(6, "0")}`;
          const result = insertBill.run(
            billNo,
            subtotal,
            taxRateBps,
            taxCents,
            total,
          );
          const billId = Number(result.lastInsertRowid);
          for (const it of items) {
            insertItem.run(
              billId,
              it.product_id,
              it.product_name,
              it.unit_price_cents,
              it.qty,
              it.line_total_cents,
            );
          }
        });
        tx();
        return json({ bill_no: billNo }, 201);
      }

      if (pathname === "/bills" && req.method === "GET") {
        const pg = Math.max(1, Number(searchParams.get("page") || "1"));
        const limit = Math.min(
          100,
          Math.max(1, Number(searchParams.get("limit") || "10")),
        );
        const billNoQ = searchParams.get("bill_no") || "";
        const startD = toDateOnly(searchParams.get("start"));
        const endD = toDateOnly(searchParams.get("end"));
        const startTs = startD ? `${startD} 00:00:00` : null;
        const endTs = endD ? `${endD} 23:59:59` : null;

        const clauses: string[] = [];
        const vals: (string | number)[] = [];
        if (billNoQ) {
          clauses.push("bill_no LIKE ?");
          vals.push(`%${billNoQ}%`);
        }
        if (startTs) {
          clauses.push("created_at >= ?");
          vals.push(startTs);
        }
        if (endTs) {
          clauses.push("created_at <= ?");
          vals.push(endTs);
        }

        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

        const countRow = db
          .prepare(`SELECT COUNT(*) as count FROM bills ${where}`)
          .get(...vals) as { count: number };

        const rows = db
          .prepare(
            `SELECT id,bill_no,subtotal_cents,tax_rate_bps,tax_cents,total_cents,created_at
             FROM bills ${where}
             ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(...vals, limit, (pg - 1) * limit);

        return json({ rows, total: countRow.count });
      }

      const billMatch = pathname.match(/^\/bills\/(\d+)$/);
      if (billMatch && req.method === "GET") {
        const id = Number(billMatch[1]);
        const rows = db
          .prepare(
            "SELECT product_id,product_name,unit_price_cents,qty,line_total_cents FROM bill_items WHERE bill_id=?1",
          )
          .all(id);
        return json({ items: rows });
      }

      /* ══════════════════════════════════════════════════════════════════
         BACKUP
         ══════════════════════════════════════════════════════════════════ */

      if (pathname === "/backup/settings" && req.method === "GET") {
        return json({
          backup_path: getSetting("backup_path", DEFAULT_BACKUP_DIR),
          backup_interval_minutes: Number(
            getSetting("backup_interval_minutes", "1440"),
          ),
        });
      }

      if (pathname === "/backup/settings" && req.method === "POST") {
        const body = (await req.json()) as {
          backup_path?: string;
          backup_interval_minutes?: number;
        };
        setSetting("backup_path", body.backup_path || DEFAULT_BACKUP_DIR);
        setSetting(
          "backup_interval_minutes",
          String(body.backup_interval_minutes ?? 1440),
        );
        scheduleBackup();
        return json({ ok: true });
      }

      if (pathname === "/backup/run" && req.method === "POST") {
        const body = (await req.json()) as { target?: string };
        const target =
          body.target || getSetting("backup_path", DEFAULT_BACKUP_DIR);
        const file = doBackup(target);
        return json({ file });
      }

      if (pathname === "/backup/restore" && req.method === "POST") {
        const body = (await req.json()) as { source: string };
        if (!body.source || !existsSync(body.source)) {
          return textRes("Backup file not found", 404);
        }
        const dst = DB_PATH;
        cpSync(body.source, dst);
        return json({ ok: true });
      }

      return textRes("Not found", 404);
    } catch (err: unknown) {
      console.error("[error]", err);
      return textRes(
        err instanceof Error ? err.message : "Internal server error",
        500,
      );
    }
  },
});

console.log(`✓ Meet & Eat API → http://127.0.0.1:${PORT}`);
