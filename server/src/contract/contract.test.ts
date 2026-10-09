import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../app.ts";
import { createSession } from "../auth/users.ts";
import { loadConfig } from "../config.ts";
import { insertEntity, insertEntityType, insertGroup, insertUser } from "../db/inventory.ts";
import { prepareDatabase } from "../boot.ts";
import { bytesToUuid, newUuidBytes, uuidToBytes } from "../db/storage.ts";
import { CSV_HEADERS, encodeCsv, parseCsv } from "./csv.ts";
import { unzip } from "./zip.ts";
import { openFactsUrl, searchBarcode, upcItemDbUrl } from "./barcode.ts";
import { validateNotifierUrl } from "./notifier.ts";

const migrationsDir = join(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const pepper = "test-pepper-not-for-production-use!!";

function openDb() {
  const dir = mkdtempSync(join(tmpdir(), "hb-contract-"));
  return prepareDatabase({
    HBOX_DATABASE_SQLITE_PATH: join(dir, "homebox.db"),
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_AUTH_API_KEY_PEPPER: pepper,
    HBOX_WEB_PORT: "0",
  }).db;
}

function appFor(db: ReturnType<typeof openDb>, bucket = mkdtempSync(join(tmpdir(), "hb-blobs-"))) {
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
  return { app: createApp(config, process.env, { db }), bucket };
}

function seed() {
  const db = openDb();
  const groupA = insertGroup(db, { name: "Alpha", currency: "usd" });
  const groupB = insertGroup(db, { name: "Beta", currency: "eur" });
  const owner = insertUser(db, { name: "Owner", email: "owner@alpha.test", groupId: groupA });
  const other = insertUser(db, { name: "Other", email: "other@beta.test", groupId: groupB });
  const typeA = insertEntityType(db, { name: "Item", groupId: groupA, isLocation: 0 });
  const typeB = insertEntityType(db, { name: "Item", groupId: groupB, isLocation: 0 });
  const entityA = insertEntity(db, { name: "Lamp", groupId: groupA, entityTypeId: typeA, description: "desk lamp", purchasePrice: 12 });
  const entityB = insertEntity(db, { name: "Secret", groupId: groupB, entityTypeId: typeB });
  const sessionA = createSession(db, uuidToBytes(owner), false);
  const sessionB = createSession(db, uuidToBytes(other), false);
  const exportB = bytesToUuid(newUuidBytes());
  const now = "2026-01-01 00:00:00+00:00";
  db.run(
    `INSERT INTO exports (id, created_at, updated_at, kind, status, progress, artifact_path, size_bytes, group_id)
     VALUES (?, ?, ?, 'export', 'completed', 100, ?, 4, ?)`,
    [uuidToBytes(exportB), now, now, `${groupB}/exports/${exportB}.zip`, uuidToBytes(groupB)],
  );
  return { db, groupA, groupB, owner, typeA, entityA, entityB, sessionA, sessionB, exportB };
}

function cookie(raw: string): HeadersInit {
  return { cookie: `hb.auth.token=${raw}`, host: "127.0.0.1:7745" };
}

test("csv export and import keep the Go header shape", async () => {
  const seedData = seed();
  const { app } = appFor(seedData.db);
  const exported = await app.request("http://127.0.0.1:7745/api/v1/entities/export", { headers: cookie(seedData.sessionA.raw) });
  expect(exported.status).toBe(200);
  expect(exported.headers.get("content-type")).toContain("text/csv");
  const text = await exported.text();
  const sheet = parseCsv(text);
  expect(sheet[0].slice(0, CSV_HEADERS.length)).toEqual([...CSV_HEADERS]);
  expect(sheet.some((row) => row.includes("Lamp"))).toBe(true);
  expect(text).not.toContain("Secret");

  const imported = await app.request("http://127.0.0.1:7745/api/v1/entities/import", {
    method: "POST",
    headers: cookie(seedData.sessionB.raw),
    body: (() => {
      const form = new FormData();
      form.set("csv", new File([encodeCsv([ [...CSV_HEADERS], sheet[1] ])], "entities.csv", { type: "text/csv" }));
      return form;
    })(),
  });
  expect(imported.status).toBe(204);
  const names = seedData.db.query(`SELECT name FROM entities WHERE group_entities = ?`).all(uuidToBytes(seedData.groupB)) as Array<{ name: string }>;
  expect(names.map((row) => row.name)).toContain("Lamp");
});

test("collection export is group scoped and round-trips the zip shape", async () => {
  const seedData = seed();
  const { app } = appFor(seedData.db);
  const created = await app.request("http://127.0.0.1:7745/api/v1/group/exports", {
    method: "POST",
    headers: cookie(seedData.sessionA.raw),
  });
  expect(created.status).toBe(202);
  const job = (await created.json()) as { id: string; status: string; artifactPath: string };
  expect(job.status).toBe("completed");
  expect(job.artifactPath.startsWith(`${seedData.groupA}/exports/`)).toBe(true);

  const foreign = await app.request(`http://127.0.0.1:7745/api/v1/group/exports/${seedData.exportB}/download`, {
    headers: cookie(seedData.sessionA.raw),
  });
  expect(foreign.status).toBe(404);

  const download = await app.request(`http://127.0.0.1:7745/api/v1/group/exports/${job.id}/download`, {
    headers: cookie(seedData.sessionA.raw),
  });
  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toContain("zip");
  const zipBytes = new Uint8Array(await download.arrayBuffer());
  const files = unzip(zipBytes);
  const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json")!)) as { schemaVersion: number; groupId: string; counts: Record<string, number> };
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.groupId).toBe(seedData.groupA);
  expect(files.has("entities.json")).toBe(true);
  const entities = JSON.parse(new TextDecoder().decode(files.get("entities.json")!)) as Array<{ name: string }>;
  expect(entities.some((row) => row.name === "Lamp")).toBe(true);
  expect(entities.some((row) => row.name === "Secret")).toBe(false);

  const empty = insertGroup(seedData.db, { name: "Empty", currency: "usd" });
  seedData.db.run(`INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, 'owner')`, [uuidToBytes(seedData.owner), uuidToBytes(empty)]);
  const form = new FormData();
  form.set("file", new File([zipBytes], "export.zip", { type: "application/zip" }));
  const restored = await app.request("http://127.0.0.1:7745/api/v1/group/import", {
    method: "POST",
    headers: { ...cookie(seedData.sessionA.raw), "x-tenant": empty },
    body: form,
  });
  expect(restored.status).toBe(202);
  const restoredNames = seedData.db.query(`SELECT name FROM entities WHERE group_entities = ?`).all(uuidToBytes(empty)) as Array<{ name: string }>;
  expect(restoredNames.map((row) => row.name)).toContain("Lamp");
});

test("labels and qr return an image for an owned entity only", async () => {
  const seedData = seed();
  const { app } = appFor(seedData.db);
  const label = await app.request(`http://127.0.0.1:7745/api/v1/labelmaker/entity/${seedData.entityA}`, {
    headers: cookie(seedData.sessionA.raw),
  });
  expect(label.status).toBe(200);
  expect(label.headers.get("content-type")).toContain("image/png");
  const png = new Uint8Array(await label.arrayBuffer());
  expect(String.fromCharCode(...png.subarray(0, 4))).toBe("\u0089PNG");

  const foreign = await app.request(`http://127.0.0.1:7745/api/v1/labelmaker/entity/${seedData.entityB}`, {
    headers: cookie(seedData.sessionA.raw),
  });
  expect(foreign.status).toBe(404);

  const qr = await app.request("http://127.0.0.1:7745/api/v1/qrcode?data=https%3A%2F%2Fexample.com%2Fitem", {
    headers: cookie(seedData.sessionA.raw),
  });
  expect(qr.status).toBe(200);
  expect(qr.headers.get("content-type")).toContain("image/jpeg");
});

test("notifier urls follow the Go scheme allowlist", async () => {
  await expect(validateNotifierUrl("discord://1234567890/abcdef")).resolves.toBeUndefined();
  await expect(validateNotifierUrl("slack://hook")).resolves.toBeUndefined();
  await expect(validateNotifierUrl("not-a-url")).rejects.toThrow(/scheme/);
  await expect(validateNotifierUrl("ftp://example.com")).rejects.toThrow(/unsupported notifier scheme/);
  await expect(validateNotifierUrl("generic://http://169.254.169.254/latest")).rejects.toThrow(/metadata|bogon/);
});

test("barcode search calls the same upstreams and does not need an account", async () => {
  const seen: string[] = [];
  const fetchImpl = async (input: string) => {
    seen.push(input);
    if (input.startsWith("https://api.upcitemdb.com/")) {
      return new Response(JSON.stringify({ items: [{ title: "Drill", brand: "Acme", description: "corded" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: 0 }), { status: 200 });
  };
  const hits = await searchBarcode("5035048748428", {}, fetchImpl);
  expect(seen[0]).toBe(upcItemDbUrl("5035048748428"));
  expect(seen).toContain(openFactsUrl("https://world.openfoodfacts.org", "5035048748428"));
  expect(seen.some((url) => url.includes("barcodespider"))).toBe(false);
  expect(hits[0]?.item.name).toBe("Drill");
  expect(hits[0]?.search_engine_name).toBe("upcitemdb.com");
});

test("statistics, actions, and user self match the Vue shapes", async () => {
  const seedData = seed();
  const { app } = appFor(seedData.db);
  const headers = cookie(seedData.sessionA.raw);
  const self = await app.request("http://127.0.0.1:7745/api/v1/users/self", { headers });
  expect(self.status).toBe(200);
  expect(((await self.json()) as { item: { email: string } }).item.email).toBe("owner@alpha.test");

  const stats = await app.request("http://127.0.0.1:7745/api/v1/groups/statistics", { headers });
  expect(stats.status).toBe(200);
  const body = (await stats.json()) as { totalItems: number };
  expect(body.totalItems).toBe(1);

  const ensured = await app.request("http://127.0.0.1:7745/api/v1/actions/ensure-asset-ids", { method: "POST", headers });
  expect(ensured.status).toBe(200);
  expect(((await ensured.json()) as { completed: number }).completed).toBeGreaterThan(0);

  const types = await app.request("http://127.0.0.1:7745/api/v1/entity-types", { headers });
  expect(types.status).toBe(200);
  expect((await types.json() as Array<{ name: string }>).some((row) => row.name === "Item")).toBe(true);
});
