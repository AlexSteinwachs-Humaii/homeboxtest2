import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HomeboxClient } from "../../../mobile/src/api/client.ts";
import { completeMaintenance, loadMaintenance } from "../../../mobile/src/maintenance/maintenance.ts";
import { createApp } from "../app.ts";
import { createSession } from "../auth/users.ts";
import { prepareDatabase } from "../boot.ts";
import { loadConfig } from "../config.ts";
import { getMaintenanceEntryById, insertEntity, insertEntityType, insertGroup, insertMaintenanceEntry, insertUser } from "../db/inventory.ts";
import { uuidToBytes } from "../db/storage.ts";

const migrationsDir = join(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const pepper = "test-pepper-not-for-production-use!!";

function openDb() {
  const dir = mkdtempSync(join(tmpdir(), "hb-mobile-maint-"));
  return prepareDatabase({
    HBOX_DATABASE_SQLITE_PATH: join(dir, "homebox.db"),
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_AUTH_API_KEY_PEPPER: pepper,
    HBOX_WEB_PORT: "0",
  }).db;
}

test("the phone lists this group's maintenance and a completed entry is stored on the server", async () => {
  const db = openDb();
  const groupA = insertGroup(db, { name: "Home", currency: "usd" });
  const groupB = insertGroup(db, { name: "Cabin", currency: "eur" });
  const owner = insertUser(db, { name: "Ada", email: "ada@home.test", groupId: groupA });
  db.run(`INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, ?)`, [uuidToBytes(owner), uuidToBytes(groupB), "member"]);
  const typeA = insertEntityType(db, { name: "Item", groupId: groupA, isLocation: 0 });
  const typeB = insertEntityType(db, { name: "Item", groupId: groupB, isLocation: 0 });
  const door = insertEntity(db, { name: "Front door", groupId: groupA, entityTypeId: typeA });
  const lamp = insertEntity(db, { name: "Cabin lamp", groupId: groupB, entityTypeId: typeB });
  const ours = insertMaintenanceEntry(db, {
    name: "Oil the hinge",
    entityId: door,
    description: "Annual",
    cost: 12.5,
    scheduledDate: "2026-10-01",
    date: null,
  });
  const theirs = insertMaintenanceEntry(db, {
    name: "Secret service",
    entityId: lamp,
    scheduledDate: "2026-09-01",
    date: null,
  });
  const session = createSession(db, uuidToBytes(owner), false);

  const config = loadConfig(
    {
      HBOX_DATABASE_SQLITE_PATH: ":memory:",
      HBOX_AUTH_API_KEY_PEPPER: pepper,
      HBOX_OPTIONS_ALLOW_REGISTRATION: "true",
    },
    [],
    migrationsDir,
  );
  const app = createApp(config, process.env, { db });
  const client = new HomeboxClient("http://127.0.0.1:7745", `Bearer ${session.raw}`, (url, init) => app.request(url, init));

  const listed = await loadMaintenance(client, groupA);
  expect(listed.ok).toBe(true);
  if (!listed.ok) throw new Error(listed.message);
  expect(listed.data.map((entry) => entry.name)).toEqual(["Oil the hinge"]);
  expect(listed.data.some((entry) => entry.id === theirs)).toBe(false);
  expect(listed.data[0]?.completedDate).toBe("");

  const otherGroup = await loadMaintenance(client, groupB);
  expect(otherGroup.ok).toBe(true);
  if (!otherGroup.ok) throw new Error(otherGroup.message);
  expect(otherGroup.data.map((entry) => entry.id)).toEqual([theirs]);

  const done = await completeMaintenance(client, groupA, listed.data[0]!, "2026-10-08");
  expect(done.ok).toBe(true);
  if (!done.ok) throw new Error(done.message);
  expect(done.data.find((entry) => entry.id === ours)?.completedDate).toBe("2026-10-08");
  expect(done.data.some((entry) => entry.id === theirs)).toBe(false);

  const stored = getMaintenanceEntryById(db, groupA, ours);
  expect(stored?.date).toBe("2026-10-08");
  expect(stored?.scheduledDate).toBe("2026-10-01");
  expect(getMaintenanceEntryById(db, groupB, theirs)?.date).toBeNull();

  const foreign = await completeMaintenance(
    client,
    groupA,
    {
      id: theirs,
      name: "Secret service",
      description: "",
      cost: "0",
      completedDate: "",
      scheduledDate: "2026-09-01",
      itemID: lamp,
      itemName: "Cabin lamp",
    },
    "2026-10-08",
  );
  expect(foreign.ok).toBe(false);
  expect(getMaintenanceEntryById(db, groupB, theirs)?.date).toBeNull();
});
