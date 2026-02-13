#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, create_dir_all, read_dir, remove_file, write};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Manager, State};

// -- app state ----------------------------------------------------------------

struct AppState {
    db: Mutex<Option<Connection>>,
    db_path: PathBuf,
    backup_dir: PathBuf,
}

fn with_db<F, R>(state: &AppState, f: F) -> Result<R, String>
where
    F: FnOnce(&Connection) -> Result<R, String>,
{
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Database not available")?;
    f(conn)
}

// -- schema -------------------------------------------------------------------

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_no INTEGER,
  name TEXT NOT NULL,
  category_id INTEGER,
  price_cents INTEGER NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(is_available);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_item_no ON products(item_no) WHERE item_no IS NOT NULL;
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no TEXT NOT NULL UNIQUE,
  subtotal_cents INTEGER NOT NULL,
  discount_rate_bps INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bills_created_at ON bills(created_at);
CREATE INDEX IF NOT EXISTS idx_bills_bill_no ON bills(bill_no);
CREATE TABLE IF NOT EXISTS bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_items_product_id ON bill_items(product_id);
INSERT OR IGNORE INTO settings(key, value) VALUES ('bill_seq', '0');
INSERT OR IGNORE INTO settings(key, value) VALUES ('discount_rate_bps', '0');
"#;

fn init_db(path: &PathBuf) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| format!("Cannot open DB: {e}"))?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        PRAGMA wal_autocheckpoint = 1000;
        PRAGMA cache_size = -20000;
        PRAGMA mmap_size = 268435456;
        ",
    )
    .map_err(|e| format!("DB pragma init failed: {e}"))?;
    let _ = conn.execute_batch("ALTER TABLE products ADD COLUMN item_no INTEGER;");
    conn.execute_batch(SCHEMA).map_err(|e| format!("Schema init failed: {e}"))?;
    let _ = conn.execute_batch("PRAGMA optimize;");
    Ok(conn)
}

// -- helpers ------------------------------------------------------------------

fn get_setting(conn: &Connection, key: &str, fallback: &str) -> String {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| {
        r.get::<_, String>(0)
    })
    .unwrap_or_else(|_| fallback.to_string())
}

fn set_setting(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    );
}

fn resolve_category_id(conn: &Connection, name: &str) -> Option<i64> {
    if name.is_empty() { return None; }
    let _ = conn.execute("INSERT OR IGNORE INTO categories(name) VALUES (?1)", params![name]);
    conn.query_row("SELECT id FROM categories WHERE name = ?1", params![name], |r| {
        r.get::<_, i64>(0)
    }).ok()
}

fn parse_qs(path: &str) -> (String, std::collections::HashMap<String, String>) {
    let mut map = std::collections::HashMap::new();
    let parts: Vec<&str> = path.splitn(2, '?').collect();
    let base = parts[0].to_string();
    if let Some(qs) = parts.get(1) {
        for pair in qs.split('&') {
            let kv: Vec<&str> = pair.splitn(2, '=').collect();
            if kv.len() == 2 {
                let k = kv[0].to_string();
                let v = percent_decode(kv[1]);
                map.insert(k, v);
            }
        }
    }
    (base, map)
}

fn percent_decode(input: &str) -> String {
    let mut result = String::new();
    let mut chars = input.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hi = chars.next().unwrap_or('0');
            let lo = chars.next().unwrap_or('0');
            let byte = u8::from_str_radix(&format!("{}{}", hi, lo), 16).unwrap_or(b'?');
            result.push(byte as char);
        } else if c == '+' {
            result.push(' ');
        } else {
            result.push(c);
        }
    }
    result
}

fn to_date_only(value: &str) -> Option<String> {
    let t = value.trim();
    if t.len() == 10 && t.chars().nth(4) == Some('-') && t.chars().nth(7) == Some('-') {
        Some(t.to_string())
    } else {
        None
    }
}

// -- receipt formatting -------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptItem {
    name: String,
    qty: i32,
    unit_price_cents: i32,
    line_total_cents: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptPayload {
    bill_no: String,
    printed_at: String,
    subtotal_cents: i32,
    discount_rate_bps: i32,
    discount_cents: i32,
    total_cents: i32,
    items: Vec<ReceiptItem>,
}

fn cents_to_rs(cents: i32) -> String { format!("{:.2}", (cents as f64) / 100.0) }

fn pad_right(value: &str, width: usize) -> String {
    if value.len() >= width { return value.to_string(); }
    format!("{}{}", value, " ".repeat(width - value.len()))
}

fn pad_left(value: &str, width: usize) -> String {
    if value.len() >= width { return value.to_string(); }
    format!("{}{}", " ".repeat(width - value.len()), value)
}

fn fit_text(value: &str, width: usize) -> String { value.trim().chars().take(width).collect() }

fn line_two_col(left: &str, right: &str, w: usize) -> String {
    if right.len() >= w { return fit_text(right, w); }
    let lr = w.saturating_sub(right.len() + 1);
    let lt = fit_text(left, lr);
    let sp = w.saturating_sub(lt.len() + right.len());
    format!("{}{}{}", lt, " ".repeat(sp), right)
}

fn sep(w: usize) -> String { "-".repeat(w) }

fn format_receipt(payload: &ReceiptPayload) -> String {
    let w = 48usize;
    let mut l: Vec<String> = Vec::new();
    l.push(sep(w));
    l.push(line_two_col(&format!("Bill: {}", payload.bill_no), &payload.printed_at, w));
    l.push(sep(w));
    l.push(format!("{} {} {} {}", pad_right("Item", 20), pad_left("Qty", 4), pad_left("Rate", 9), pad_left("Amount", 12)));
    l.push(sep(w));
    for it in &payload.items {
        let n = fit_text(&it.name, 20);
        l.push(format!("{} {} {} {}", pad_right(&n, 20), pad_left(&it.qty.to_string(), 4), pad_left(&cents_to_rs(it.unit_price_cents), 9), pad_left(&cents_to_rs(it.line_total_cents), 12)));
    }
    l.push(sep(w));
    l.push(line_two_col("Subtotal", &format!("Rs {}", cents_to_rs(payload.subtotal_cents)), w));
    l.push(line_two_col(&format!("Discount ({:.2}%)", (payload.discount_rate_bps as f64) / 100.0), &format!("-Rs {}", cents_to_rs(payload.discount_cents)), w));
    l.push(line_two_col("TOTAL", &format!("Rs {}", cents_to_rs(payload.total_cents)), w));
    l.push(sep(w));
    l.join("\r\n")
}

fn ps_escape(s: &str) -> String { s.replace('\'', "''").replace('"', "`\"") }

fn do_print(printer: &str, payload: &ReceiptPayload) -> Result<(), String> {
    let receipt = format_receipt(payload);
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis();
    let tmp = std::env::temp_dir().join(format!("meateat_{}.txt", ms));

    // ESC/POS raw bytes: init, center header, left body, bottom feed, then cut.
    let mut raw: Vec<u8> = Vec::new();
    raw.extend_from_slice(&[0x1B, 0x40]); // ESC @ initialize
    raw.extend_from_slice(&[0x1B, 0x61, 0x01]); // ESC a 1 (center)
    // Prominent branding: double-width + double-height + emphasized
    raw.extend_from_slice(&[0x1D, 0x21, 0x11]); // GS ! n -> double width & double height
    raw.extend_from_slice(&[0x1B, 0x45, 0x01]); // ESC E 1 -> emphasize on
    raw.extend_from_slice(b"MEET & EAT\r\n");
    raw.extend_from_slice(&[0x1B, 0x45, 0x00]); // emphasize off
    raw.extend_from_slice(&[0x1D, 0x21, 0x00]); // ensure normal size
    // Slightly bold slogan
    raw.extend_from_slice(&[0x1B, 0x45, 0x01]);
    raw.extend_from_slice(b"Fresh Food | Fast Service\r\n");
    raw.extend_from_slice(&[0x1B, 0x45, 0x00]);
    raw.extend_from_slice(&[0x1B, 0x61, 0x00]); // ESC a 0 (left)

    raw.extend_from_slice(receipt.as_bytes());

    // Centered thank-you line (printed after body)
    raw.extend_from_slice(&[0x1B, 0x61, 0x01]);
    raw.extend_from_slice(b"Thank you. Visit again!\r\n");
    raw.extend_from_slice(&[0x1B, 0x61, 0x00]);

    raw.extend_from_slice(b"\r\n\r\n\r\n"); // bottom margin
    raw.extend_from_slice(&[0x1D, 0x56, 0x41, 0x03]); // GS V A n (cut after feed)

    write(&tmp, raw).map_err(|e| format!("Write receipt: {e}"))?;

    let p_esc = ps_escape(&tmp.to_string_lossy());
    let pr_esc = ps_escape(printer.trim());

    // Use Win32 raw printing to send text directly to the thermal printer.
    // This bypasses the GDI driver so the printer uses its own built-in font
    // at full paper width instead of shrinking everything to fit an A4 page.
    let cmd = format!(r#"
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class RawPrint {{
    [StructLayout(LayoutKind.Sequential)] public struct DOCINFOA {{
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }}
    [DllImport("winspool.drv", CharSet=CharSet.Ansi, SetLastError=true)]
    public static extern bool OpenPrinter(string p, out IntPtr hPrinter, IntPtr d);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOA di);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int count, out int written);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    public static bool Send(string printer, string docName, byte[] data) {{
        IntPtr hPrinter; if (!OpenPrinter(printer, out hPrinter, IntPtr.Zero)) return false;
        var di = new DOCINFOA {{ pDocName = docName, pDataType = "RAW" }};
        if (!StartDocPrinter(hPrinter, 1, ref di)) {{ ClosePrinter(hPrinter); return false; }}
        StartPagePrinter(hPrinter);
        IntPtr pUnmanaged = Marshal.AllocCoTaskMem(data.Length);
        Marshal.Copy(data, 0, pUnmanaged, data.Length);
        int written; WritePrinter(hPrinter, pUnmanaged, data.Length, out written);
        Marshal.FreeCoTaskMem(pUnmanaged);
        EndPagePrinter(hPrinter); EndDocPrinter(hPrinter); ClosePrinter(hPrinter);
        return true;
    }}
}}
"@
$bytes = [System.IO.File]::ReadAllBytes('{p_esc}')
$ok = [RawPrint]::Send('{pr_esc}', 'Receipt', $bytes)
if (-not $ok) {{ throw "Raw print failed for printer '{pr_esc}'" }}
"#);

    let out = Command::new("powershell")
        .arg("-NoProfile").arg("-WindowStyle").arg("Hidden")
        .arg("-ExecutionPolicy").arg("Bypass")
        .arg("-Command").arg(&cmd)
        .output()
        .map_err(|e| format!("Print failed: {e}"))?;

    let _ = remove_file(&tmp);
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(format!("Print on '{}': {}", printer, stderr));
    }
    Ok(())
}

// -- backup -------------------------------------------------------------------

fn list_backups(dir: &PathBuf) -> Vec<Value> {
    let Ok(entries) = read_dir(dir) else { return vec![] };
    let mut results: Vec<(String, String, u64, String)> = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() && p.extension().map(|e| e == "db").unwrap_or(false) {
            let name = entry.file_name().to_string_lossy().to_string();
            let full = p.to_string_lossy().to_string();
            if let Ok(meta) = fs::metadata(&p) {
                let modified = meta.modified().ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs().to_string())
                    .unwrap_or_default();
                results.push((name, full, meta.len(), modified));
            }
        }
    }
    results.sort_by(|a, b| b.3.cmp(&a.3));
    results.into_iter().map(|(name, path, size, modified)| {
        json!({ "name": name, "path": path, "modified_at": modified, "size_bytes": size })
    }).collect()
}

fn do_backup(conn: &Connection, db_path: &PathBuf, target_dir: &PathBuf) -> Result<String, String> {
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    let ts = simple_ts();
    let fname = format!("meet-eat-{}.db", ts);
    create_dir_all(target_dir).map_err(|e| format!("Backup dir: {e}"))?;
    let dst = target_dir.join(&fname);
    fs::copy(db_path, &dst).map_err(|e| format!("Backup copy: {e}"))?;
    Ok(dst.to_string_lossy().to_string())
}

fn simple_ts() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let days = secs / 86400;
    let tod = secs % 86400;
    let (y, m, d) = days_to_ymd(days);
    format!("{:04}{:02}{:02}_{:02}{:02}{:02}", y, m, d, tod / 3600, (tod % 3600) / 60, tod % 60)
}

fn days_to_ymd(days: i64) -> (i64, i64, i64) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if m <= 2 { y + 1 } else { y };
    (yr, m, d)
}

// -- API router ---------------------------------------------------------------

#[tauri::command]
fn api_call(
    state: State<AppState>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let (base, qs) = parse_qs(&path);
    let base = base.as_str();
    let method = method.as_str();

    match (method, base) {
        ("GET", "/health") => Ok(json!({ "ok": true })),

        ("GET", "/metrics") => with_db(state.inner(), |conn| {
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM bills", [], |r| r.get(0)).unwrap_or(0);
            let size = fs::metadata(&state.db_path).map(|m| m.len()).unwrap_or(0);
            Ok(json!({ "bills": count, "db_size_bytes": size }))
        }),

        // -- categories -------------------------------------------------------
        ("GET", "/categories") => with_db(state.inner(), |conn| {
            let mut stmt = conn.prepare("SELECT id, name, is_active FROM categories ORDER BY name").map_err(|e| e.to_string())?;
            let rows: Vec<Value> = stmt.query_map([], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "name": r.get::<_, String>(1)?, "is_active": r.get::<_, i64>(2)? }))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            Ok(json!(rows))
        }),

        // -- products ---------------------------------------------------------
        ("GET", "/products/search") => with_db(state.inner(), |conn| {
            let q = qs.get("q").cloned().unwrap_or_default();
            let pat = format!("%{}%", q);
            let mut stmt = conn.prepare(
                "SELECT p.id, p.item_no, p.name, c.name as category, p.price_cents, p.is_available FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.is_available = 1 AND (p.name LIKE ?1 OR CAST(p.item_no AS TEXT) LIKE ?1) ORDER BY (p.item_no IS NULL), p.item_no, p.name LIMIT 20"
            ).map_err(|e| e.to_string())?;
            let rows: Vec<Value> = stmt.query_map(params![pat], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "item_no": r.get::<_, Option<i64>>(1)?, "name": r.get::<_, String>(2)?, "category": r.get::<_, Option<String>>(3)?, "price_cents": r.get::<_, i64>(4)?, "is_available": r.get::<_, i64>(5)? }))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            Ok(json!(rows))
        }),

        ("GET", "/products") => with_db(state.inner(), |conn| {
            let mut stmt = conn.prepare(
                "SELECT p.id, p.item_no, p.name, c.name as category, p.price_cents, p.is_available FROM products p LEFT JOIN categories c ON p.category_id = c.id ORDER BY (p.item_no IS NULL), p.item_no, p.name"
            ).map_err(|e| e.to_string())?;
            let rows: Vec<Value> = stmt.query_map([], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "item_no": r.get::<_, Option<i64>>(1)?, "name": r.get::<_, String>(2)?, "category": r.get::<_, Option<String>>(3)?, "price_cents": r.get::<_, i64>(4)?, "is_available": r.get::<_, i64>(5)? }))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            Ok(json!(rows))
        }),

        ("POST", "/products") => with_db(state.inner(), |conn| {
            let b = body.as_ref().ok_or("Missing body")?;
            let name = b["name"].as_str().ok_or("name required")?.trim().to_string();
            let cat = b["category"].as_str().unwrap_or("");
            let price = b["price_cents"].as_i64().ok_or("price_cents required")?;
            let cat_id = resolve_category_id(conn, cat);
            let raw_no = b.get("item_no").and_then(|v| v.as_i64());

            if let Some(n) = raw_no {
                if n >= 1 && n <= 9999 {
                    conn.execute("INSERT INTO products(item_no, name, category_id, price_cents, is_available) VALUES(?1,?2,?3,?4,1)", params![n, name, cat_id, price]).map_err(|e| {
                        let m = e.to_string().to_lowercase();
                        if m.contains("unique") && m.contains("item_no") { "Item No already in use".to_string() } else { e.to_string() }
                    })?;
                    return Ok(json!({ "ok": true }));
                }
            }
            for _ in 0..3 {
                let mx: i64 = conn.query_row("SELECT COALESCE(MAX(item_no), 0) FROM products", [], |r| r.get(0)).unwrap_or(0);
                let nx = mx + 1;
                if nx < 1 || nx > 9999 { return Err("Item No overflow".to_string()); }
                match conn.execute("INSERT INTO products(item_no, name, category_id, price_cents, is_available) VALUES(?1,?2,?3,?4,1)", params![nx, name, cat_id, price]) {
                    Ok(_) => return Ok(json!({ "ok": true })),
                    Err(e) => {
                        let m = e.to_string().to_lowercase();
                        if m.contains("unique") && m.contains("item_no") { continue; }
                        return Err(e.to_string());
                    }
                }
            }
            Err("Failed to allocate Item No".to_string())
        }),

        _ if method == "PUT" && base.ends_with("/availability") => {
            let id_str = base.trim_start_matches("/products/").trim_end_matches("/availability");
            let id: i64 = id_str.parse().map_err(|_| "Invalid product id".to_string())?;
            let b = body.as_ref().ok_or("Missing body")?;
            let avail = b["is_available"].as_i64().unwrap_or(1);
            with_db(state.inner(), |conn| {
                conn.execute("UPDATE products SET is_available = ?1 WHERE id = ?2", params![avail, id]).map_err(|e| e.to_string())?;
                Ok(json!({ "ok": true }))
            })
        }

        _ if method == "PUT" && base.starts_with("/products/") => {
            let id: i64 = base.trim_start_matches("/products/").parse().map_err(|_| "Invalid id".to_string())?;
            let b = body.as_ref().ok_or("Missing body")?;
            let name = b["name"].as_str().ok_or("name required")?.trim().to_string();
            let cat = b["category"].as_str().unwrap_or("");
            let price = b["price_cents"].as_i64().ok_or("price_cents required")?;
            let raw_no = b.get("item_no").and_then(|v| v.as_i64());
            let item_no = raw_no.and_then(|n| if n >= 1 && n <= 9999 { Some(n) } else { None });
            with_db(state.inner(), |conn| {
                let cat_id = resolve_category_id(conn, cat);
                conn.execute("UPDATE products SET item_no=?1, name=?2, category_id=?3, price_cents=?4, updated_at=datetime('now') WHERE id=?5", params![item_no, name, cat_id, price, id]).map_err(|e| {
                    let m = e.to_string().to_lowercase();
                    if m.contains("unique") && m.contains("item_no") { "Item No already in use".to_string() } else { e.to_string() }
                })?;
                Ok(json!({ "ok": true }))
            })
        }

        _ if method == "DELETE" && base.starts_with("/products/") => {
            let id: i64 = base.trim_start_matches("/products/").parse().map_err(|_| "Invalid id".to_string())?;
            with_db(state.inner(), |conn| {
                match conn.execute("DELETE FROM products WHERE id = ?1", params![id]) {
                    Ok(_) => Ok(json!({ "ok": true })),
                    Err(e) => {
                        let m = e.to_string().to_lowercase();
                        if m.contains("foreign key") || m.contains("constraint") {
                            conn.execute("UPDATE products SET is_available = 0 WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
                            Ok(json!({ "ok": true, "disabled": true }))
                        } else { Err(e.to_string()) }
                    }
                }
            })
        }

        // -- bills ------------------------------------------------------------
        ("POST", "/bills") => {
            let b = body.as_ref().ok_or("Missing body")?;
            let raw = b["items"].as_array().ok_or("items required")?;
            if raw.is_empty() { return Err("No items".to_string()); }

            struct It { pid: i64, pname: String, unit: i64, qty: i64, lt: i64 }
            let items: Vec<It> = raw.iter().filter_map(|it| {
                let pid = it["product_id"].as_i64().unwrap_or(0);
                let pn = it["product_name"].as_str().unwrap_or("").trim().to_string();
                let u = it["unit_price_cents"].as_i64().unwrap_or(0).max(0);
                let q = it["qty"].as_i64().unwrap_or(0).max(1).min(1000);
                if pid > 0 && !pn.is_empty() { Some(It { pid, pname: pn, unit: u, qty: q, lt: q * u }) } else { None }
            }).collect();
            if items.is_empty() { return Err("No valid items".to_string()); }

            let subtotal: i64 = items.iter().map(|i| i.lt).sum();
            let dr = b["discount_rate_bps"].as_i64().unwrap_or(0);
            let dc = ((subtotal as f64 * dr as f64) / 10_000.0).round() as i64;
            let total = subtotal - dc;

            with_db(state.inner(), |conn| {
                let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
                tx.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('bill_seq','0')", []).map_err(|e| e.to_string())?;
                tx.execute("UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'bill_seq'", []).map_err(|e| e.to_string())?;
                let seq: i64 = tx.query_row("SELECT value FROM settings WHERE key = 'bill_seq'", [], |r| r.get::<_, String>(0).map(|v| v.parse::<i64>().unwrap_or(1))).unwrap_or(1);
                let bill_no = format!("MNE-{:06}", seq);
                tx.execute("INSERT INTO bills(bill_no,subtotal_cents,discount_rate_bps,discount_cents,total_cents) VALUES(?1,?2,?3,?4,?5)", params![bill_no, subtotal, dr, dc, total]).map_err(|e| e.to_string())?;
                let bill_id = tx.last_insert_rowid();
                for it in &items {
                    tx.execute("INSERT INTO bill_items(bill_id,product_id,product_name,unit_price_cents,qty,line_total_cents) VALUES(?1,?2,?3,?4,?5,?6)", params![bill_id, it.pid, it.pname, it.unit, it.qty, it.lt]).map_err(|e| e.to_string())?;
                }
                tx.commit().map_err(|e| e.to_string())?;
                Ok(json!({ "bill_no": bill_no }))
            })
        }

        ("GET", "/bills") => with_db(state.inner(), |conn| {
            let page: i64 = qs.get("page").and_then(|v| v.parse().ok()).unwrap_or(1).max(1);
            let limit: i64 = qs.get("limit").and_then(|v| v.parse().ok()).unwrap_or(10).max(1).min(100);
            let bnq = qs.get("bill_no").cloned().unwrap_or_default();
            let start = qs.get("start").and_then(|v| to_date_only(v));
            let end = qs.get("end").and_then(|v| to_date_only(v));

            let mut wc = Vec::new();
            let mut bv: Vec<String> = Vec::new();
            if !bnq.is_empty() { wc.push("bill_no LIKE ?".to_string()); bv.push(format!("%{}%", bnq)); }
            if let Some(s) = &start { wc.push("created_at >= ?".to_string()); bv.push(format!("{} 00:00:00", s)); }
            if let Some(e) = &end { wc.push("created_at <= ?".to_string()); bv.push(format!("{} 23:59:59", e)); }

            let wsql = if wc.is_empty() { String::new() } else { format!("WHERE {}", wc.join(" AND ")) };

            let csql = format!("SELECT COUNT(*) FROM bills {}", wsql);
            let mut cs = conn.prepare(&csql).map_err(|e| e.to_string())?;
            let cparams: Vec<&dyn rusqlite::types::ToSql> = bv.iter().map(|v| v as &dyn rusqlite::types::ToSql).collect();
            let total: i64 = cs.query_row(cparams.as_slice(), |r| r.get(0)).unwrap_or(0);

            let dsql = format!("SELECT id,bill_no,subtotal_cents,discount_rate_bps,discount_cents,total_cents,created_at FROM bills {} ORDER BY created_at DESC LIMIT ? OFFSET ?", wsql);
            let mut ds = conn.prepare(&dsql).map_err(|e| e.to_string())?;
            let offset = (page - 1) * limit;
            let mut ap: Vec<Box<dyn rusqlite::types::ToSql>> = bv.iter().map(|v| Box::new(v.clone()) as Box<dyn rusqlite::types::ToSql>).collect();
            ap.push(Box::new(limit));
            ap.push(Box::new(offset));
            let pr: Vec<&dyn rusqlite::types::ToSql> = ap.iter().map(|v| v.as_ref()).collect();

            let rows: Vec<Value> = ds.query_map(pr.as_slice(), |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "bill_no": r.get::<_, String>(1)?, "subtotal_cents": r.get::<_, i64>(2)?, "discount_rate_bps": r.get::<_, i64>(3)?, "discount_cents": r.get::<_, i64>(4)?, "total_cents": r.get::<_, i64>(5)?, "created_at": r.get::<_, String>(6)? }))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            Ok(json!({ "rows": rows, "total": total }))
        }),

        _ if method == "GET" && base.starts_with("/bills/") => {
            let id: i64 = base.trim_start_matches("/bills/").parse().map_err(|_| "Invalid id".to_string())?;
            with_db(state.inner(), |conn| {
                let mut stmt = conn.prepare("SELECT product_id,product_name,unit_price_cents,qty,line_total_cents FROM bill_items WHERE bill_id=?1").map_err(|e| e.to_string())?;
                let rows: Vec<Value> = stmt.query_map(params![id], |r| Ok(json!({ "product_id": r.get::<_, i64>(0)?, "product_name": r.get::<_, String>(1)?, "unit_price_cents": r.get::<_, i64>(2)?, "qty": r.get::<_, i64>(3)?, "line_total_cents": r.get::<_, i64>(4)? }))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
                Ok(json!({ "items": rows }))
            })
        }

        // -- backup -----------------------------------------------------------
        ("GET", "/backup/settings") => with_db(state.inner(), |conn| {
            let bp = get_setting(conn, "backup_path", &state.backup_dir.to_string_lossy());
            let iv = get_setting(conn, "backup_interval_minutes", "1440");
            Ok(json!({ "backup_path": bp, "backup_interval_minutes": iv.parse::<i64>().unwrap_or(1440) }))
        }),

        ("POST", "/backup/settings") => with_db(state.inner(), |conn| {
            let b = body.as_ref().ok_or("Missing body")?;
            let fallback = state.backup_dir.to_string_lossy().to_string();
            let bp = b["backup_path"].as_str().unwrap_or(&fallback);
            let iv = b["backup_interval_minutes"].as_i64().unwrap_or(1440);
            set_setting(conn, "backup_path", bp);
            set_setting(conn, "backup_interval_minutes", &iv.to_string());
            Ok(json!({ "ok": true }))
        }),

        ("GET", "/backup/files") => with_db(state.inner(), |conn| {
            let t = qs.get("path").cloned().unwrap_or_else(|| get_setting(conn, "backup_path", &state.backup_dir.to_string_lossy()));
            let files = list_backups(&PathBuf::from(&t));
            Ok(json!({ "files": files, "backup_path": t }))
        }),

        ("POST", "/backup/run") => with_db(state.inner(), |conn| {
            let b = body.as_ref();
            let t = b.and_then(|v| v["target"].as_str()).map(|s| s.to_string()).unwrap_or_else(|| get_setting(conn, "backup_path", &state.backup_dir.to_string_lossy()));
            let file = do_backup(conn, &state.db_path, &PathBuf::from(&t))?;
            Ok(json!({ "file": file }))
        }),

        ("POST", "/backup/restore") => {
            let b = body.as_ref().ok_or("Missing body")?;
            let src_raw = b.get("source").and_then(|v| v.as_str()).map(|s| s.to_string())
                .or_else(|| { let bp = b.get("backup_path").and_then(|v| v.as_str())?; let f = b.get("file_name").and_then(|v| v.as_str())?; Some(format!("{}\\{}", bp, f)) })
                .or_else(|| b.get("backup_path").and_then(|v| v.as_str()).map(|s| s.to_string()))
                .unwrap_or_default();
            if src_raw.is_empty() { return Err("No backup source".to_string()); }

            let sp = PathBuf::from(&src_raw);
            let actual = if sp.is_file() { sp } else if sp.is_dir() {
                let bks = list_backups(&sp);
                let first = bks.first().and_then(|v| v["path"].as_str().map(PathBuf::from));
                first.ok_or("No backup files in directory")?
            } else { return Err("Backup not found".to_string()); };

            let mut guard = state.db.lock().map_err(|e| e.to_string())?;
            if let Some(c) = guard.take() {
                let _ = c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
                let _ = c.close();
            }
            let _ = fs::remove_file(format!("{}-wal", state.db_path.to_string_lossy()));
            let _ = fs::remove_file(format!("{}-shm", state.db_path.to_string_lossy()));
            fs::copy(&actual, &state.db_path).map_err(|e| format!("Restore: {e}"))?;
            let nc = init_db(&state.db_path)?;
            *guard = Some(nc);
            Ok(json!({ "ok": true, "restored_from": actual.to_string_lossy() }))
        }

        // -- print ------------------------------------------------------------
        ("POST", "/print") => {
            let b = body.as_ref().ok_or("Missing body")?;
            let printer = b["printerName"].as_str().unwrap_or("Rugtek printer").to_string();
            let pv = b.get("payload").ok_or("Missing payload")?;
            let payload: ReceiptPayload = serde_json::from_value(pv.clone()).map_err(|e| format!("Bad payload: {e}"))?;
            do_print(&printer, &payload)?;
            Ok(json!({ "ok": true }))
        }

        _ => Err(format!("Not found: {} {}", method, path)),
    }
}

// -- main ---------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![api_call])
        .setup(|app| {
            let data_dir = app.path_resolver().app_data_dir().unwrap_or_else(|| {
                let ad = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
                PathBuf::from(ad).join("com.meetandeat.app")
            });
            let _ = create_dir_all(&data_dir);
            let db_path = data_dir.join("app.db");
            let backup_dir = data_dir.join("backups");
            let _ = create_dir_all(&backup_dir);
            let conn = init_db(&db_path).expect("Failed to initialise database");
            let backup_dir_str = backup_dir.to_string_lossy().to_string();
            set_setting(&conn, "backup_path", &backup_dir_str);
            set_setting(&conn, "backup_interval_minutes", "1440");
            app.manage(AppState { db: Mutex::new(Some(conn)), db_path, backup_dir });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
