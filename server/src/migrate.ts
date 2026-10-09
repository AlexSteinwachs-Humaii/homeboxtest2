import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "bun:sqlite";

import { StartupError } from "./errors.ts";
import { mergeEntities } from "./migrations/merge-entities.ts";
import { syncChildren } from "./migrations/sync-children.ts";

export const SYNC_CHILDREN_VERSION = 20241226183416;
export const MERGE_ENTITIES_VERSION = 20260416120001;

type SqlMigration = {
  version: number;
  name: string;
  kind: "sql";
  file: string;
  noTransaction: boolean;
  upSql: string;
};

type GoMigration = {
  version: number;
  name: string;
  kind: "go";
  run: (db: Database) => void;
};

export type Migration = SqlMigration | GoMigration;

const GO_RUNNERS: Record<number, (db: Database) => void> = {
  [SYNC_CHILDREN_VERSION]: syncChildren,
  [MERGE_ENTITIES_VERSION]: mergeEntities,
};

export type GooseRow = {
  id: number;
  versionId: number;
  isApplied: number;
};

export function resolveMigrationsDir(explicit: string | undefined): string {
  if (explicit) return explicit;
  const candidates = [
    resolve(import.meta.dir, "../../backend/internal/data/migrations/sqlite3"),
    resolve(import.meta.dir, "../migrations/sqlite3"),
  ];
  for (const candidate of candidates) {
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      // try the next layout (repo checkout vs container copy)
    }
  }
  return candidates[0];
}

export function collectMigrations(dir: string): Migration[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new StartupError(`cannot read sqlite migrations in ${dir}: ${message}`);
  }

  const migrations: Migration[] = [];
  for (const name of names) {
    const match = /^(\d+)_(.+)\.(sql|go)$/.exec(name);
    if (!match) continue;
    const version = Number(match[1]);
    const stem = match[2];
    const ext = match[3];
    if (ext === "sql") {
      const text = readFileSync(resolve(dir, name), "utf8");
      const parsed = parseGooseUp(text);
      migrations.push({
        version,
        name: stem,
        kind: "sql",
        file: resolve(dir, name),
        noTransaction: parsed.noTransaction,
        upSql: parsed.upSql,
      });
      continue;
    }
    const run = GO_RUNNERS[version];
    if (!run) {
      migrations.push({
        version,
        name: stem,
        kind: "go",
        run: () => {
          throw new StartupError(missingGoMigrationMessage(version, stem));
        },
      });
      continue;
    }
    migrations.push({ version, name: stem, kind: "go", run });
  }

  migrations.sort((a, b) => a.version - b.version);
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new StartupError(`duplicate goose version ${migration.version} in ${dir}`);
    }
    seen.add(migration.version);
  }
  return migrations;
}

export function missingGoMigrationMessage(version: number, name: string): string {
  return `refusing to start: goose migration ${version} (${name}) is not ported. History was not replayed and goose_db_version was not rewritten.`;
}

export function parseGooseUp(text: string): { upSql: string; noTransaction: boolean } {
  const lines = text.split(/\r?\n/);
  let mode: "none" | "up" | "down" = "none";
  let noTransaction = false;
  const up: string[] = [];
  for (const line of lines) {
    const directive = line.trim().match(/^--\s*\+goose\s+(.+)$/i);
    if (directive) {
      const command = directive[1].trim().toLowerCase();
      if (command === "up") mode = "up";
      else if (command === "down") mode = "down";
      else if (command === "no transaction" && mode === "up") noTransaction = true;
      continue;
    }
    if (mode === "up") up.push(line);
  }
  return { upSql: up.join("\n").trim(), noTransaction };
}

export function ensureGooseTable(db: Database): void {
  const existing = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'goose_db_version'")
    .get();
  if (existing) return;
  db.exec(`
    CREATE TABLE goose_db_version (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL,
      is_applied INTEGER NOT NULL,
      tstamp TIMESTAMP DEFAULT (datetime('now'))
    );
  `);
  db.run("INSERT INTO goose_db_version (version_id, is_applied) VALUES (?, 1)", [0]);
}

export function readGooseRows(db: Database): GooseRow[] {
  ensureGooseTable(db);
  const rows = db.query("SELECT id, version_id, is_applied FROM goose_db_version ORDER BY id ASC").all() as Array<{
    id: number;
    version_id: number | bigint;
    is_applied: number | bigint;
  }>;
  return rows.map((row) => ({
    id: Number(row.id),
    versionId: Number(row.version_id),
    isApplied: Number(row.is_applied),
  }));
}

export function appliedVersions(rows: GooseRow[]): Set<number> {
  const latest = new Map<number, number>();
  for (const row of rows) latest.set(row.versionId, row.isApplied);
  const applied = new Set<number>();
  for (const [version, isApplied] of latest) {
    if (isApplied === 1) applied.add(version);
  }
  return applied;
}

export type MigrateOptions = {
  // Test hook: apply only versions strictly below this number.
  maxVersionExclusive?: number;
};

export function runMigrations(db: Database, dir: string, options: MigrateOptions = {}): number[] {
  const migrations = collectMigrations(dir).filter((migration) =>
    options.maxVersionExclusive === undefined ? true : migration.version < options.maxVersionExclusive,
  );
  const rows = readGooseRows(db);
  const applied = appliedVersions(rows);
  const pending = migrations.filter((migration) => !applied.has(migration.version));

  const missing = pending.find((migration) => migration.kind === "go" && !GO_RUNNERS[migration.version]);
  if (missing) {
    throw new StartupError(missingGoMigrationMessage(missing.version, missing.name));
  }

  const appliedNow: number[] = [];
  for (const migration of pending) {
    applyOne(db, migration);
    appliedNow.push(migration.version);
    console.log(`[homebox] applied goose migration ${migration.version} (${migration.name})`);
  }
  if (appliedNow.length === 0) {
    console.log("[homebox] goose_db_version is current; no migrations replayed");
  }
  return appliedNow;
}

function applyOne(db: Database, migration: Migration): void {
  if (migration.kind === "go") {
    // sync_children is transactional in Goose. merge_entities is not: it toggles foreign_keys.
    if (migration.version === MERGE_ENTITIES_VERSION) {
      migration.run(db);
      recordVersion(db, migration.version);
      return;
    }
    db.exec("BEGIN");
    try {
      migration.run(db);
      recordVersion(db, migration.version);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return;
  }

  const sql = executableSql(migration.upSql);
  if (!sql) {
    recordVersion(db, migration.version);
    return;
  }
  if (migration.noTransaction) {
    try {
      db.exec(sql);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new StartupError(`failed to apply goose migration ${migration.version} (${migration.name}): ${message}`);
    }
    recordVersion(db, migration.version);
    return;
  }
  db.exec("BEGIN");
  try {
    db.exec(sql);
    recordVersion(db, migration.version);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    const message = err instanceof Error ? err.message : String(err);
    throw new StartupError(`failed to apply goose migration ${migration.version} (${migration.name}): ${message}`);
  }
}

// Bun rejects a comment-only script as an empty query. Goose still records that version.
function executableSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .trim();
}

function recordVersion(db: Database, version: number): void {
  // Insert only. Existing goose_db_version rows are never updated or deleted.
  db.run("INSERT INTO goose_db_version (version_id, is_applied) VALUES (?, 1)", [version]);
}
