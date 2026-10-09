import type { Database } from "bun:sqlite";

import { StartupError } from "../errors.ts";

// Port of backend/internal/data/migrations/sqlite3/20241226183416_sync_children.go.
// Goose records version 20241226183416 from the filename, not the function name.
export function syncChildren(db: Database): void {
  const existing = db
    .query("SELECT name FROM pragma_table_info('items') WHERE name = 'sync_child_items_locations'")
    .get();
  if (existing) return;

  try {
    db.exec(`
      PRAGMA foreign_keys = off;

      ALTER TABLE items
        ADD COLUMN sync_child_items_locations BOOLEAN NOT NULL DEFAULT FALSE;

      CREATE INDEX IF NOT EXISTS item_name           ON items(name);
      CREATE INDEX IF NOT EXISTS item_manufacturer   ON items(manufacturer);
      CREATE INDEX IF NOT EXISTS item_model_number   ON items(model_number);
      CREATE INDEX IF NOT EXISTS item_serial_number  ON items(serial_number);
      CREATE INDEX IF NOT EXISTS item_archived       ON items(archived);
      CREATE INDEX IF NOT EXISTS item_asset_id       ON items(asset_id);

      PRAGMA foreign_keys = on;
    `);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new StartupError(`failed to apply goose migration 20241226183416 (sync_children): ${message}`);
  }
}
