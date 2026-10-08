import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { HomeboxClient, type FetchLike } from "../../../mobile/src/api/client.ts";
import { createItem, loadInventory, updateItem } from "../../../mobile/src/inventory/inventory.ts";
import { completeMaintenance, isComplete, loadMaintenance } from "../../../mobile/src/maintenance/maintenance.ts";
import { MemorySessionStore, signIn } from "../../../mobile/src/session/session.ts";
import { createApp } from "../app.ts";
import { prepareDatabase } from "../boot.ts";
import { loadConfig } from "../config.ts";
import { setApiKeyPepper } from "../auth/token.ts";
import { bytesToUuid } from "../db/storage.ts";

// Web and phone are two sessions of the shared client. Neither is given the
// database path. A refresh is loadInventory / loadMaintenance, the same calls
// the shared screens make after pull-to-refresh.

const migrationsDir = resolve(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const pepper = "test-pepper-not-for-production-use!!";
const base = "http://127.0.0.1:7745";
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("a web inventory change is visible to the phone app for the same account after a refresh", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hb-cross-"));
  temps.push(dir);
  const sqlitePath = join(dir, "homebox.db");
  setApiKeyPepper(pepper);
  const prepared = prepareDatabase({
    HBOX_DATABASE_SQLITE_PATH: sqlitePath,
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_AUTH_API_KEY_PEPPER: pepper,
    HBOX_OPTIONS_ALLOW_REGISTRATION: "true",
    HBOX_WEB_PORT: "0",
  });
  const config = loadConfig(
    {
      HBOX_DATABASE_SQLITE_PATH: ":memory:",
      HBOX_AUTH_API_KEY_PEPPER: pepper,
      HBOX_OPTIONS_ALLOW_REGISTRATION: "true",
    },
    [],
    migrationsDir,
  );
  const app = createApp(config, process.env, { db: prepared.db });
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("homebox.db") || !new URL(target).pathname.startsWith("/api/v1")) {
      throw new Error(`client left /api/v1: ${target}`);
    }
    return app.request(target, init);
  };

  const registered = await app.request(`${base}/api/v1/users/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada", email: "ada-cross@example.com", password: "secret1" }),
  });
  expect(registered.status).toBe(204);
  const other = await app.request(`${base}/api/v1/users/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Bea", email: "bea-cross@example.com", password: "secret1" }),
  });
  expect(other.status).toBe(204);

  const webStore = new MemorySessionStore();
  const phoneStore = new MemorySessionStore();
  const webSignIn = await signIn(
    { store: webStore, fetch: fetchImpl },
    { serverUrl: base, username: "ada-cross@example.com", password: "secret1" },
  );
  const phoneSignIn = await signIn(
    { store: phoneStore, fetch: fetchImpl },
    { serverUrl: base, username: "ada-cross@example.com", password: "secret1" },
  );
  expect(webSignIn.ok).toBe(true);
  expect(phoneSignIn.ok).toBe(true);
  if (!webSignIn.ok || !phoneSignIn.ok) return;
  expect(webSignIn.account.email).toBe(phoneSignIn.account.email);
  expect(webSignIn.session.token).not.toBe(phoneSignIn.session.token);
  expect(webStore.value?.serverUrl).not.toContain("homebox.db");
  expect(phoneStore.value?.serverUrl).not.toContain("homebox.db");

  const web = new HomeboxClient(base, webSignIn.session.token, fetchImpl);
  const phone = new HomeboxClient(base, phoneSignIn.session.token, fetchImpl);

  const webHome = await loadInventory(web, webSignIn.account.defaultGroupId, webSignIn.account.defaultGroupId);
  expect(webHome.ok).toBe(true);
  if (!webHome.ok) throw new Error(webHome.message);
  const homeId = webHome.data.groupId;
  expect(webHome.data.itemTypeId).toBeTruthy();

  const created = await createItem(web, homeId, {
    name: "Desk lamp",
    description: "from the browser",
    quantity: 1,
    parentId: null,
    entityTypeId: webHome.data.itemTypeId!,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.message);

  const edited = await updateItem(web, homeId, created.data, {
    name: "Desk lamp edited",
    description: "renamed in the browser",
    quantity: 2,
    parentId: null,
  });
  expect(edited.ok).toBe(true);
  if (!edited.ok) throw new Error(edited.message);
  expect(edited.data.id).toBe(created.data.id);

  const phoneHome = await loadInventory(phone, homeId, homeId);
  expect(phoneHome.ok).toBe(true);
  if (!phoneHome.ok) throw new Error(phoneHome.message);
  const shown = phoneHome.data.items.find((item) => item.id === created.data.id);
  expect(shown?.name).toBe("Desk lamp edited");
  expect(phoneHome.data.items.map((item) => item.name)).not.toContain("Desk lamp");

  web.setGroup(homeId);
  const scheduled = await web.createMaintenance(created.data.id, "Replace bulb");
  expect(scheduled.ok).toBe(true);
  if (!scheduled.ok) throw new Error(scheduled.error);
  const webLog = await loadMaintenance(web, homeId);
  expect(webLog.ok).toBe(true);
  if (!webLog.ok) throw new Error(webLog.message);
  const entry = webLog.data.find((row) => row.id === scheduled.data.id);
  expect(entry?.name).toBe("Replace bulb");
  const done = await completeMaintenance(web, homeId, entry!, "2026-10-08");
  expect(done.ok).toBe(true);
  if (!done.ok) throw new Error(done.message);

  const phoneLog = await loadMaintenance(phone, homeId);
  expect(phoneLog.ok).toBe(true);
  if (!phoneLog.ok) throw new Error(phoneLog.message);
  const phoneEntry = phoneLog.data.find((row) => row.id === scheduled.data.id);
  expect(phoneEntry?.name).toBe("Replace bulb");
  expect(isComplete(phoneEntry!)).toBe(true);
  expect(phoneEntry?.completedDate.startsWith("2026-10-08")).toBe(true);

  const phoneTypes = phoneHome.data.itemTypeId;
  const fromPhone = await createItem(phone, homeId, {
    name: "Phone mug",
    description: "filed on the phone",
    quantity: 1,
    parentId: null,
    entityTypeId: phoneTypes!,
  });
  expect(fromPhone.ok).toBe(true);
  if (!fromPhone.ok) throw new Error(fromPhone.message);
  const webAfterPhone = await loadInventory(web, homeId, homeId);
  expect(webAfterPhone.ok).toBe(true);
  if (!webAfterPhone.ok) throw new Error(webAfterPhone.message);
  expect(webAfterPhone.data.items.find((item) => item.id === fromPhone.data.id)?.name).toBe("Phone mug");

  web.setGroup(homeId);
  const cabin = await web.createGroup("Cabin");
  expect(cabin.ok).toBe(true);
  if (!cabin.ok) throw new Error(cabin.error);
  const cabinInventory = await loadInventory(web, cabin.data.id, homeId);
  expect(cabinInventory.ok).toBe(true);
  if (!cabinInventory.ok) throw new Error(cabinInventory.message);
  expect(cabinInventory.data.groupId).toBe(cabin.data.id);
  expect(cabinInventory.data.items.map((item) => item.id)).not.toContain(created.data.id);
  const stool = await createItem(web, cabin.data.id, {
    name: "Cabin stool",
    description: "other collection",
    quantity: 1,
    parentId: null,
    entityTypeId: cabinInventory.data.itemTypeId!,
  });
  expect(stool.ok).toBe(true);
  if (!stool.ok) throw new Error(stool.message);

  const phoneStillHome = await loadInventory(phone, homeId, homeId);
  expect(phoneStillHome.ok).toBe(true);
  if (!phoneStillHome.ok) throw new Error(phoneStillHome.message);
  expect(phoneStillHome.data.items.map((item) => item.name)).toEqual(expect.arrayContaining(["Desk lamp edited", "Phone mug"]));
  expect(phoneStillHome.data.items.map((item) => item.id)).not.toContain(stool.data.id);

  const phoneCabin = await loadInventory(phone, cabin.data.id, homeId);
  expect(phoneCabin.ok).toBe(true);
  if (!phoneCabin.ok) throw new Error(phoneCabin.message);
  expect(phoneCabin.data.items.map((item) => item.id)).toEqual([stool.data.id]);
  expect(phoneCabin.data.items.map((item) => item.name)).not.toContain("Desk lamp edited");

  const webStillHome = await loadInventory(web, homeId, homeId);
  expect(webStillHome.ok).toBe(true);
  if (!webStillHome.ok) throw new Error(webStillHome.message);
  expect(webStillHome.data.items.map((item) => item.id)).not.toContain(stool.data.id);

  const beaStore = new MemorySessionStore();
  const beaSignIn = await signIn(
    { store: beaStore, fetch: fetchImpl },
    { serverUrl: base, username: "bea-cross@example.com", password: "secret1" },
  );
  expect(beaSignIn.ok).toBe(true);
  if (!beaSignIn.ok) return;
  const bea = new HomeboxClient(base, beaSignIn.session.token, fetchImpl);
  const beaHome = await loadInventory(bea, beaSignIn.account.defaultGroupId, beaSignIn.account.defaultGroupId);
  expect(beaHome.ok).toBe(true);
  if (!beaHome.ok) throw new Error(beaHome.message);
  expect(beaHome.data.items.map((item) => item.id)).not.toContain(created.data.id);
  expect(beaHome.data.items.map((item) => item.id)).not.toContain(stool.data.id);
  bea.setGroup(beaHome.data.groupId);
  const hidden = await bea.getEntity(created.data.id);
  expect(hidden.ok).toBe(false);
  if (hidden.ok) return;
  expect(hidden.status).toBe(404);

  const lamp = prepared.db.query(`SELECT id, name, description, quantity, group_entities FROM entities WHERE name = ?`).get("Desk lamp edited") as {
    id: Uint8Array;
    name: string;
    description: string;
    quantity: number;
    group_entities: Uint8Array;
  };
  expect(lamp.id).toBeInstanceOf(Uint8Array);
  expect(lamp.id.byteLength).toBe(16);
  expect(bytesToUuid(lamp.id)).toBe(created.data.id);
  expect(bytesToUuid(lamp.group_entities)).toBe(homeId);
  expect(lamp.description).toBe("renamed in the browser");
  expect(lamp.quantity).toBe(2);

  const maintenance = prepared.db
    .query(
      `SELECT m.name, m.date FROM maintenance_entries m
       JOIN entities e ON e.id = m.entity_id
       WHERE e.name = ? AND m.name = ?`,
    )
    .get("Desk lamp edited", "Replace bulb") as { name: string; date: string };
  expect(maintenance.name).toBe("Replace bulb");
  expect(String(maintenance.date)).toMatch(/^2026-10-08/);

  const stoolRow = prepared.db.query(`SELECT group_entities FROM entities WHERE name = ?`).get("Cabin stool") as {
    group_entities: Uint8Array;
  };
  expect(bytesToUuid(stoolRow.group_entities)).toBe(cabin.data.id);
  expect(bytesToUuid(stoolRow.group_entities)).not.toBe(homeId);

  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((url) => new URL(url).pathname.startsWith("/api/v1"))).toBe(true);
  expect(calls.some((url) => url.includes("homebox.db") || url.includes("/api/expo") || /\/api\/(?!v1)/.test(url))).toBe(false);
  expect(calls.some((url) => url.includes("/api/v1/users/login"))).toBe(true);
  expect(calls.some((url) => url.includes("/api/v1/entities"))).toBe(true);
  expect(calls.some((url) => url.includes("/api/v1/maintenance"))).toBe(true);
});
