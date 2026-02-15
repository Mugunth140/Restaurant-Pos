import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, renameSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import db from "./db";
import { generateReceiptPdf } from "./receipt-pdf";
import type { ReceiptPayload } from "./receipt-pdf";

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

const toLocalDateOnly = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const listDbBackups = (targetDir: string) => {
  if (!existsSync(targetDir)) return [] as Array<{ name: string; path: string; modified_at: string; size_bytes: number }>;
  const entries = readdirSync(targetDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".db"))
    .map((entry) => {
      const fullPath = join(targetDir, entry.name);
      const st = statSync(fullPath);
      return {
        name: entry.name,
        path: fullPath,
        modified_at: st.mtime.toISOString(),
        size_bytes: st.size,
      };
    })
    .sort((a, b) => (a.modified_at < b.modified_at ? 1 : -1));
};

const resolveBackupSource = (sourceOrDir: string) => {
  const raw = (sourceOrDir || "").trim();
  if (!raw || !existsSync(raw)) return null;
  const st = statSync(raw);
  if (st.isFile()) {
    return raw.toLowerCase().endsWith(".db") ? raw : null;
  }
  if (!st.isDirectory()) return null;
  const backups = listDbBackups(raw);
  if (backups.length === 0) return null;
  return backups[0].path;
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

      if (pathname === "/categories" && req.method === "GET") {
        const rows = db
          .prepare("SELECT id, name, is_active FROM categories ORDER BY name")
          .all();
        return json(rows);
      }

      if (pathname === "/products/search" && req.method === "GET") {
        const q = searchParams.get("q") ?? "";
        const rows = db
          .prepare(
            `SELECT p.id, p.item_no, p.name, c.name as category, p.price_cents, p.is_available
             FROM products p LEFT JOIN categories c ON p.category_id = c.id
             WHERE p.is_available = 1 AND (p.name LIKE ?1 OR CAST(p.item_no AS TEXT) LIKE ?1)
             ORDER BY (p.item_no IS NULL), p.item_no, p.name LIMIT 20`,
          )
          .all(`%${q}%`);
        return json(rows);
      }

      if (pathname === "/products" && req.method === "GET") {
        const rows = db
          .prepare(
            `SELECT p.id, p.item_no, p.name, c.name as category, p.price_cents, p.is_available
             FROM products p LEFT JOIN categories c ON p.category_id = c.id
             ORDER BY (p.item_no IS NULL), p.item_no, p.name`,
          )
          .all();
        return json(rows);
      }

      if (pathname === "/products" && req.method === "POST") {
        const body = (await req.json()) as {
          item_no?: number | null;
          name: string;
          category: string | null;
          price_cents: number;
        };
        const catId = resolveCategoryId(body.category);
        const rawNo = body.item_no;
        const itemNo =
          rawNo === null || rawNo === undefined || rawNo === ("" as unknown)
            ? null
            : Math.floor(Number(rawNo));
        const itemNoNorm =
          itemNo === null
            ? null
            : Number.isFinite(itemNo) && itemNo >= 1 && itemNo <= 9999
              ? itemNo
              : null;

        const insert = db.prepare(
          "INSERT INTO products(item_no, name, category_id, price_cents, is_available) VALUES(?1,?2,?3,?4,1)",
        );
        const selectMax = db.prepare(
          "SELECT COALESCE(MAX(item_no), 0) as max_no FROM products",
        );

        // If item_no is omitted, auto-assign next number.
        if (itemNoNorm === null) {
          for (let attempt = 0; attempt < 3; attempt++) {
            const row = selectMax.get() as { max_no: number } | undefined;
            const nextNo = Number(row?.max_no ?? 0) + 1;
            if (!Number.isFinite(nextNo) || nextNo < 1 || nextNo > 9999) {
              return textRes("Item No overflow", 400);
            }
            try {
              insert.run(nextNo, body.name, catId, body.price_cents);
              return json({ ok: true }, 201);
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              // Race/dup: retry with updated max.
              if (
                msg.toLowerCase().includes("unique") &&
                msg.toLowerCase().includes("item_no")
              ) {
                continue;
              }
              throw e;
            }
          }
          return textRes("Failed to allocate Item No", 500);
        }

        // If provided explicitly, validate uniqueness.
        try {
          insert.run(itemNoNorm, body.name, catId, body.price_cents);
          return json({ ok: true }, 201);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (
            msg.toLowerCase().includes("unique") &&
            msg.toLowerCase().includes("item_no")
          ) {
            return textRes("Item No already in use", 400);
          }
          throw e;
        }
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
          item_no?: number | null;
          name: string;
          category: string | null;
          price_cents: number;
        };
        const catId = resolveCategoryId(body.category);
        const rawNo = body.item_no;
        const itemNo =
          rawNo === null || rawNo === undefined || rawNo === ("" as unknown)
            ? null
            : Math.floor(Number(rawNo));
        const itemNoNorm =
          itemNo === null
            ? null
            : Number.isFinite(itemNo) && itemNo >= 1 && itemNo <= 9999
              ? itemNo
              : null;
        try {
          db.prepare(
            "UPDATE products SET item_no=?1, name=?2, category_id=?3, price_cents=?4, updated_at=datetime('now') WHERE id=?5",
          ).run(itemNoNorm, body.name, catId, body.price_cents, id);
          return json({ ok: true });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.toLowerCase().includes("unique") && msg.toLowerCase().includes("item_no")) {
            return textRes("Item No already in use", 400);
          }
          throw e;
        }
      }

      if (prodMatch && req.method === "DELETE") {
        const id = Number(prodMatch[1]);
        try {
          db.prepare("DELETE FROM products WHERE id = ?1").run(id);
          return json({ ok: true });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          // If the product was used in any bill_items row, hard delete is blocked.
          // In that case, soft-delete by marking it unavailable.
          if (msg.toLowerCase().includes("foreign key") || msg.toLowerCase().includes("constraint failed")) {
            db.prepare("UPDATE products SET is_available = 0 WHERE id = ?1").run(id);
            return json({ ok: true, disabled: true });
          }
          throw e;
        }
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
          discount_rate_bps: number;
          payment_mode?: string;
          split_cash_cents?: number;
          split_online_cents?: number;
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
        const discountRateBps = Number(body.discount_rate_bps || 0);
        const discountCents = Math.round((subtotal * discountRateBps) / 10_000);
        const total = subtotal - discountCents;
        const paymentModeRaw = String(body.payment_mode || "cash").toLowerCase();
        const paymentMode = ["cash", "online", "split"].includes(paymentModeRaw)
          ? paymentModeRaw
          : "cash";
        const splitCashRaw = Number(body.split_cash_cents ?? 0);
        const splitOnlineRaw = Number(body.split_online_cents ?? 0);
        let splitCashCents = Number.isFinite(splitCashRaw) ? Math.max(0, Math.floor(splitCashRaw)) : 0;
        let splitOnlineCents = Number.isFinite(splitOnlineRaw) ? Math.max(0, Math.floor(splitOnlineRaw)) : 0;

        if (paymentMode === "split") {
          if (splitCashCents + splitOnlineCents !== total) {
            return textRes("Split amounts must match total", 400);
          }
        } else if (paymentMode === "cash") {
          splitCashCents = total;
          splitOnlineCents = 0;
        } else if (paymentMode === "online") {
          splitCashCents = 0;
          splitOnlineCents = total;
        }

        let billNo = "";

        const insertBill = db.prepare(
          "INSERT INTO bills(bill_no,subtotal_cents,discount_rate_bps,discount_cents,payment_mode,split_cash_cents,split_online_cents,total_cents) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
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
            discountRateBps,
            discountCents,
            paymentMode,
            splitCashCents,
            splitOnlineCents,
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
            `SELECT id,bill_no,subtotal_cents,discount_rate_bps,discount_cents,payment_mode,split_cash_cents,split_online_cents,total_cents,created_at
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

      if (billMatch && req.method === "DELETE") {
        const id = Number(billMatch[1]);
        const result = db.prepare("DELETE FROM bills WHERE id = ?1").run(id);
        if (Number(result.changes || 0) === 0) {
          return textRes("Bill not found", 404);
        }
        return json({ ok: true });
      }

      if (pathname === "/analytics/payments" && req.method === "GET") {
        const now = new Date();
        const today = toLocalDateOnly(now);
        const minDateObj = new Date(now);
        minDateObj.setDate(minDateObj.getDate() - 3);
        const minAllowedDate = toLocalDateOnly(minDateObj);

        let start = toDateOnly(searchParams.get("start")) ?? today;
        let end = toDateOnly(searchParams.get("end")) ?? start;
        if (start > end) [start, end] = [end, start];

        if (start < minAllowedDate || end > today) {
          return textRes("Date range must be within the last 3 days", 400);
        }

        const row = db
          .prepare(
            `SELECT
                COALESCE(SUM(CASE WHEN payment_mode = 'cash' THEN 1 ELSE 0 END), 0) as cash_bill_count,
                COALESCE(SUM(CASE WHEN payment_mode = 'online' THEN 1 ELSE 0 END), 0) as online_bill_count,
                COALESCE(SUM(CASE WHEN payment_mode = 'split' THEN 1 ELSE 0 END), 0) as split_bill_count,
                COALESCE(SUM(split_cash_cents), 0) as cash_total_cents,
                COALESCE(SUM(split_online_cents), 0) as online_total_cents,
                COALESCE(SUM(CASE WHEN payment_mode = 'split' THEN total_cents ELSE 0 END), 0) as split_total_cents
             FROM bills
             WHERE created_at >= ?1 AND created_at <= ?2`,
          )
          .get(`${start} 00:00:00`, `${end} 23:59:59`) as {
            cash_bill_count: number;
            online_bill_count: number;
            split_bill_count: number;
            cash_total_cents: number;
            online_total_cents: number;
            split_total_cents: number;
          } | undefined;

        const cash = {
          bill_count: Number(row?.cash_bill_count || 0),
          total_cents: Number(row?.cash_total_cents || 0),
        };
        const online = {
          bill_count: Number(row?.online_bill_count || 0),
          total_cents: Number(row?.online_total_cents || 0),
        };
        const split = {
          bill_count: Number(row?.split_bill_count || 0),
          total_cents: Number(row?.split_total_cents || 0),
        };

        return json({ cash, online, split });
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

      if (pathname === "/backup/files" && req.method === "GET") {
        const targetDir =
          searchParams.get("path") || getSetting("backup_path", DEFAULT_BACKUP_DIR);
        const files = listDbBackups(targetDir);
        return json({ files, backup_path: targetDir });
      }

      if (pathname === "/backup/run" && req.method === "POST") {
        const body = (await req.json()) as { target?: string };
        const target =
          body.target || getSetting("backup_path", DEFAULT_BACKUP_DIR);
        const file = doBackup(target);
        return json({ file });
      }

      if (pathname === "/backup/restore" && req.method === "POST") {
        const body = (await req.json()) as {
          source?: string;
          backup_path?: string;
          file_name?: string;
        };

        const requestedSource =
          body.source ||
          (body.file_name && body.backup_path
            ? join(body.backup_path, body.file_name)
            : body.backup_path || "");

        const source = resolveBackupSource(requestedSource);
        if (!source) {
          return textRes("Backup .db file not found", 404);
        }

        try {
          db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        } catch {}

        try {
          db.close();
        } catch {}

        try {
          rmSync(`${DB_PATH}-wal`, { force: true });
        } catch {}
        try {
          rmSync(`${DB_PATH}-shm`, { force: true });
        } catch {}

        cpSync(source, DB_PATH, { force: true });
        return json({ ok: true, restored_from: source });
      }

      /* ══════════════════════════════════════════════════════════════════
         PRINT (SumatraPDF silent printing)
         ══════════════════════════════════════════════════════════════════ */

      if (pathname === "/print" && req.method === "POST") {
        const body = (await req.json()) as {
          printerName?: string;
          payload: ReceiptPayload;
        };
        const printerName = (body.printerName || getSetting("printer_name", "Rugtek printer")).trim();
        const payload = body.payload;
        if (!payload || !payload.billNo) return textRes("Invalid receipt payload", 400);

        // 1. Generate receipt PDF
        const pdfBytes = await generateReceiptPdf(payload);
        const tmpFile = join(tmpdir(), `meateat_receipt_${Date.now()}.pdf`);
        writeFileSync(tmpFile, pdfBytes);

        // 2. Locate SumatraPDF.exe
        const envPath = (process.env.SUMATRA_PDF_PATH || "").trim();
        const candidates = [
          envPath,
          join(process.cwd(), "tools", "SumatraPDF.exe"),
          "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe",
          "C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe",
          join(process.env.LOCALAPPDATA || "", "SumatraPDF", "SumatraPDF.exe"),
        ].filter(Boolean);

        let sumatraPath = "";
        for (const candidate of candidates) {
          if (candidate && existsSync(candidate)) {
            sumatraPath = candidate;
            break;
          }
        }
        if (!sumatraPath) {
          try { unlinkSync(tmpFile); } catch {}
          return textRes(
            "SumatraPDF.exe not found. Place it in the tools/ folder or set SUMATRA_PDF_PATH env variable.",
            500,
          );
        }

        // 3. Print silently via SumatraPDF
        try {
          const proc = Bun.spawn([
            sumatraPath,
            "-print-to", printerName,
            "-silent",
            "-print-settings", "noscale,portrait",
            tmpFile,
          ], { stdout: "pipe", stderr: "pipe" });

          const exitCode = await proc.exited;
          // Clean up temp file after printing
          setTimeout(() => { try { unlinkSync(tmpFile); } catch {} }, 3000);

          if (exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text();
            return textRes(`SumatraPDF exited with code ${exitCode}: ${stderr}`, 500);
          }
          return json({ ok: true });
        } catch (e: unknown) {
          try { unlinkSync(tmpFile); } catch {}
          return textRes(
            `Print failed: ${e instanceof Error ? e.message : String(e)}`,
            500,
          );
        }
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
