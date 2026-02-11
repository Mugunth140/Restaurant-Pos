import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DB_PATH = join(process.cwd(), "db", "app.db");

if (!existsSync(dirname(DB_PATH))) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);

const schemaPath = join(process.cwd(), "db", "schema.sql");
if (existsSync(schemaPath)) {
  const schema = readFileSync(schemaPath, "utf8");
  db.exec(schema);
}

export default db;
