import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Runtime PRAGMA settings for performance and stability
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA temp_store = MEMORY;");
db.exec("PRAGMA foreign_keys = ON;");
// Tune busy timeout & WAL checkpoint for heavy write loads:
// - Increase busy timeout so writers wait longer before failing (milliseconds)
db.exec("PRAGMA busy_timeout = 15000;");
// Smaller WAL checkpoint to keep WAL growth in check
db.exec("PRAGMA wal_autocheckpoint = 100;");

// Apply schema on first run
const ENV_SCHEMA_PATH = (
  process.env.MEATEAT_POS_SCHEMA_PATH ??
  process.env.POS_SCHEMA_PATH ??
  ""
).trim();
const schemaPath = ENV_SCHEMA_PATH || join(process.cwd(), "db", "schema.sql");
if (existsSync(schemaPath)) {
  const sql = readFileSync(schemaPath, "utf8");
  // Execute each statement individually (bun:sqlite exec doesn't support multiple PRAGMAs well)
  for (const stmt of sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      db.exec(stmt + ";");
    } catch {
      // ignore duplicate index / table errors on re-run
    }
  }
}

// Migration: Handle tax -> discount column rename for existing databases
try {
  const tableInfo = db
    .prepare("PRAGMA table_info(bills)")
    .all() as Array<{ name: string; type: string }>;
  const hasOldColumns = tableInfo.some((col) => col.name === "tax_rate_bps");
  const hasNewColumns = tableInfo.some((col) => col.name === "discount_rate_bps");

  if (hasOldColumns && !hasNewColumns) {
    // Migration: Rename old tax columns to discount columns
    db.exec("ALTER TABLE bills RENAME COLUMN tax_rate_bps TO discount_rate_bps;");
    db.exec("ALTER TABLE bills RENAME COLUMN tax_cents TO discount_cents;");
  }
} catch {
  // ignore if migration fails (table might not exist yet)
}

export default db;
