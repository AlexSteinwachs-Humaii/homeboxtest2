import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HomeboxClient } from "../../../mobile/src/api/client.ts";
import { createItem, loadInventory, updateItem } from "../../../mobile/src/inventory/inventory.ts";
import { createApp } from "../app.ts";
import { createSession } from "../auth/users.ts";
import { prepareDatabase } from "../boot.ts";
import { loadConfig } from "../config.ts";
import { insertEntity, insertEntityType, insertGroup, insertUser } from "../db/inventory.ts";
import { bytesToUuid, uuidToBytes } from "../db/storage.ts";

const migrationsDir = join(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const pepper = "test-pepper-not-for-production-use!!";

function openDb() {
  const dir = mkdtempSync(join(tmpdir(), "hb-mobile-inventory-"));
  return prepareDatabase({
    HBOX_DATABASE_SQLITE_PATH: join(dir, "homebox.db"),
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_AUTH_API_KEY_PEPPER: pepper,
    HBOX_WEB_PORT: "0",
  }).db;
}

test("the phone client files an item through the API and the row is a 16-byte id in this group's table", async () => {
  const db = openDb();
  const groupA = insertGroup(db, { name: "Home", currency: "usd" });
  const groupB = insertGroup(db, { name: "Cabin", currency: "eur" });
  const owner = insertUser(db, { name: "Ada", email: "ada@home.test", groupId: groupA });
  db.run(`INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, ?)`, [uuidToBytes(owner), uuidToBytes(groupB), "member"]);
  const itemType = insertEntityType(db, { name: "Item", groupId: groupA, isLocation: 0 });
  const locationType = insertEntityType(db, { name: "Location", groupId: groupA, isLocation: 1 });
  const otherType = insertEntityType(db, { name: "Item", groupId: groupB, isLocation: 0 });
  const kitchen = insertEntity(db, { name: "Kitchen", groupId: groupA, entityTypeId: locationType });
  insertEntity(db, { name: "Secret", groupId: groupB, entityTypeId: otherType });
  const session = createSession(db, uuidToBytes(owner), false);

  const bucket = mkdtempSync(join(tmpdir(), "hb-mobile-blobs-"));
  const config = loadConfig(
    {
      HBOX_DATABASE_SQLITE_PATH: ":memory:",
      HBOX_AUTH_API_KEY_PEPPER: pepper,
      HBOX_OPTIONS_ALLOW_REGISTRATION: "true",
      HBOX_STORAGE_PREFIX_PATH: ".data",
      HBOX_STORAGE_CONN_STRING: `file://${bucket}`,
    },
    [],
    migrationsDir,
  );
  const app = createApp(config, process.env, { db });
  const client = new HomeboxClient("http://127.0.0.1:7745", `Bearer ${session.raw}`, (url, init) => app.request(url, init));

  const home = await loadInventory(client, groupA, groupA);
  expect(home.ok).toBe(true);
  if (!home.ok) return;
  expect(home.data.items.map((item) => item.name)).not.toContain("Secret");
  expect(home.data.locations.map((item) => item.name)).toContain("Kitchen");
  expect(home.data.itemTypeId).toBe(itemType);

  const created = await createItem(client, groupA, {
    name: "Drill",
    description: "cordless",
    quantity: 2,
    parentId: kitchen,
    entityTypeId: itemType,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.message);
  expect(created.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(created.data.name).toBe("Drill");
  expect(created.data.description).toBe("cordless");
  expect(created.data.quantity).toBe(2);
  expect(created.data.parentId).toBe(kitchen);

  const row = db.query(`SELECT id, name, description, quantity, group_entities FROM entities WHERE name = ?`).get("Drill") as {
    id: Uint8Array;
    name: string;
    description: string | null;
    quantity: number;
    group_entities: Uint8Array;
  };
  expect(row.id).toBeInstanceOf(Uint8Array);
  expect(row.id.byteLength).toBe(16);
  expect(bytesToUuid(row.id)).toBe(created.data.id);
  expect(row.group_entities.byteLength).toBe(16);
  expect(bytesToUuid(row.group_entities)).toBe(groupA);
  expect(row.description).toBe("cordless");
  expect(row.quantity).toBe(2);

  const edited = await updateItem(client, groupA, created.data, {
    name: "Drill press",
    description: "bench",
    quantity: 3,
    parentId: kitchen,
  });
  expect(edited.ok).toBe(true);
  if (!edited.ok) throw new Error(edited.message);
  expect(edited.data.id).toBe(created.data.id);

  const updated = db.query(`SELECT id, name, description, quantity FROM entities WHERE name = ?`).get("Drill press") as {
    id: Uint8Array;
    name: string;
    description: string | null;
    quantity: number;
  };
  expect(updated.id.byteLength).toBe(16);
  expect(bytesToUuid(updated.id)).toBe(created.data.id);
  expect(updated.description).toBe("bench");
  expect(updated.quantity).toBe(3);

  const again = await loadInventory(client, groupA, groupA);
  expect(again.ok).toBe(true);
  if (!again.ok) return;
  expect(again.data.items.map((item) => item.name)).toContain("Drill press");
  expect(again.data.items.map((item) => item.name)).not.toContain("Secret");

  const other = await loadInventory(client, groupB, groupA);
  expect(other.ok).toBe(true);
  if (!other.ok) return;
  expect(other.data.items.map((item) => item.name)).toEqual(["Secret"]);
  expect(other.data.items.map((item) => item.id)).not.toContain(created.data.id);

  client.setGroup(groupB);
  const hidden = await client.getEntity(created.data.id);
  expect(hidden.ok).toBe(false);
  if (hidden.ok) return;
  expect(hidden.status).toBe(404);
});
