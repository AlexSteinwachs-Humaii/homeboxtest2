import type { Database } from "bun:sqlite";

import { bytesToUuid, newUuidBytes, sqliteNow, uuidToBytes } from "../db/storage.ts";

// A new collection has to be able to file items the way the Go server does
// after registration and CreateGroup. Without an Item type and a Location type,
// the create dialogs have nothing to send as entityTypeId.
export function ensureDefaultEntityTypes(db: Database, groupId: Uint8Array | string): void {
  const bytes = groupId instanceof Uint8Array ? groupId : uuidToBytes(groupId);
  const text = groupId instanceof Uint8Array ? bytesToUuid(groupId) : groupId;
  const now = sqliteNow();
  for (const [name, isLocation] of [
    ["Item", 0],
    ["Location", 1],
  ] as const) {
    const existing = db
      .query(
        `SELECT id FROM entity_types
         WHERE (group_entity_types = ? OR group_entity_types = ?) AND is_location = ?
         LIMIT 1`,
      )
      .get(bytes, text, isLocation);
    if (existing) continue;
    db.run(
      `INSERT INTO entity_types (id, created_at, updated_at, name, description, is_location, group_entity_types)
       VALUES (?, ?, ?, ?, '', ?, ?)`,
      [newUuidBytes(), now, now, name, isLocation, bytes],
    );
  }
}
