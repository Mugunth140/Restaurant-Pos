import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DB_DIR = join(process.cwd(), "db");
const DB_PATH = join(DB_DIR, "app.db");

if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Apply schema on first run
const schemaPath = join(DB_DIR, "schema.sql");
if (existsSync(schemaPath)) {
  const sql = readFileSync(schemaPath, "utf8");
  // Execute each statement individually (bun:sqlite exec doesn't support multiple PRAGMAs well)
  for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
    try {
      db.exec(stmt + ";");
    } catch {
      // ignore duplicate index / table errors on re-run
    }
  }
}

export default db;
