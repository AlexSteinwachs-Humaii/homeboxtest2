import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

// Applied in code. The Go driver's `_pragma` / `_fk` query string is stripped
// before open and is never forwarded to bun:sqlite.
export const BUSY_TIMEOUT_MS = 2000;

export type ConnectionPragmas = {
  journalMode: string;
  foreignKeys: number;
  busyTimeout: number;
};

export function openDatabase(filePath: string): Database {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath, { create: true });
  applyConnectionPragmas(db);
  return db;
}

export function applyConnectionPragmas(db: Database): ConnectionPragmas {
  const journal = db.query("PRAGMA journal_mode = WAL").get() as { journal_mode: string };
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  const foreignKeys = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
  const busy = db.query("PRAGMA busy_timeout").get() as { timeout: number };
  return {
    journalMode: String(journal.journal_mode).toLowerCase(),
    foreignKeys: Number(foreignKeys.foreign_keys),
    busyTimeout: Number(busy.timeout),
  };
}
