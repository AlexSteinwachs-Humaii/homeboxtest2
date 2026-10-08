import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

import { createSession } from "../auth/users.ts";
import { createApp } from "../app.ts";
import { prepareDatabase } from "../boot.ts";
import { loadConfig } from "../config.ts";
import { insertEntity, insertEntityType, insertGroup, insertUser } from "../db/inventory.ts";
import { uuidToBytes } from "../db/storage.ts";
import { searchEntities } from "./entities.ts";
import { normalizeSearchQuery } from "./normalize.ts";

const migrationsDir = resolve(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function openDb(): Database {
  const dir = mkdtempSync(join(tmpdir(), "homebox-search-"));
  temps.push(dir);
  return prepareDatabase({
    HBOX_DATABASE_DRIVER: "sqlite3",
    HBOX_DATABASE_SQLITE_PATH: join(dir, "homebox.db"),
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_WEB_PORT: "0",
  }).db;
}

// Cases from backend/internal/data/repo/repo_items_search_test.go.
const accentCases: Array<{ name: string; itemName: string; searchQuery: string }> = [
  { name: "Spanish accented item, search without accents", itemName: "electrónica", searchQuery: "electronica" },
  { name: "Spanish accented item, search with accents", itemName: "electrónica", searchQuery: "electrónica" },
  { name: "Non-accented item, search with accents", itemName: "electronica", searchQuery: "electrónica" },
  { name: "Spanish item with tilde, search without accents", itemName: "café", searchQuery: "cafe" },
  { name: "Spanish item without tilde, search with accents", itemName: "cafe", searchQuery: "café" },
  { name: "French accented item, search without accents", itemName: "pére", searchQuery: "pere" },
  { name: "French: père without accent, search with accents", itemName: "pere", searchQuery: "père" },
  { name: "Mixed case with accents", itemName: "Electrónica", searchQuery: "ELECTRONICA" },
  { name: "Bidirectional: Non-accented item, search with different accents", itemName: "cafe", searchQuery: "café" },
  { name: "Bidirectional: Item with accent, search with different accent", itemName: "résumé", searchQuery: "resume" },
  { name: "Bidirectional: Spanish ñ to n", itemName: "espanol", searchQuery: "español" },
  { name: "French: français with accent, search without", itemName: "français", searchQuery: "francais" },
  { name: "French: français without accent, search with", itemName: "francais", searchQuery: "français" },
  { name: "French: été with accent, search without", itemName: "été", searchQuery: "ete" },
  { name: "French: été without accent, search with", itemName: "ete", searchQuery: "été" },
  { name: "French: hôtel with accent, search without", itemName: "hôtel", searchQuery: "hotel" },
  { name: "French: hôtel without accent, search with", itemName: "hotel", searchQuery: "hôtel" },
  { name: "French: naïve with accent, search without", itemName: "naïve", searchQuery: "naive" },
  { name: "French: naïve without accent, search with", itemName: "naive", searchQuery: "naïve" },
];

describe("accent-insensitive entity search", () => {
  test("accented and unaccented queries return the same group-scoped matches", () => {
    const db = openDb();
    const groupA = insertGroup(db, { name: "Alpha", currency: "usd" });
    const groupB = insertGroup(db, { name: "Beta", currency: "eur" });
    const typeA = insertEntityType(db, { name: "Item", groupId: groupA, isLocation: 0 });
    const typeB = insertEntityType(db, { name: "Item", groupId: groupB, isLocation: 0 });
    // Same accented name in the other group must never leak into A's results.
    insertEntity(db, { name: "electrónica", groupId: groupB, entityTypeId: typeB, description: "café secret" });

    for (const tc of accentCases) {
      const id = insertEntity(db, { name: tc.itemName, groupId: groupA, entityTypeId: typeA });
      const found = searchEntities(db, { groupId: groupA, search: tc.searchQuery });
      expect(found.some((row) => row.id === id), `${tc.name}: ${tc.searchQuery} -> ${tc.itemName}`).toBe(true);
      expect(found.every((row) => row.groupId === groupA)).toBe(true);
      expect(found.some((row) => row.groupId === groupB)).toBe(false);
      expect(normalizeSearchQuery(tc.itemName)).toBe(normalizeSearchQuery(tc.searchQuery));
    }
  });

  test("matches description, serial, model, manufacturer, and notes, not another group", () => {
    const db = openDb();
    const groupA = insertGroup(db, { name: "Alpha", currency: "usd" });
    const groupB = insertGroup(db, { name: "Beta", currency: "eur" });
    const typeA = insertEntityType(db, { name: "Item", groupId: groupA, isLocation: 0 });
    const typeB = insertEntityType(db, { name: "Item", groupId: groupB, isLocation: 0 });
    const fields = [
      { description: "résumé of the lamp" },
      { serialNumber: "SÉRIE-1" },
      { modelNumber: "MODÈLE" },
      { manufacturer: "Café Co" },
      { notes: "naïve note" },
    ] as const;
    const queries = ["resume", "serie", "modele", "cafe", "naive"];
    const ids = fields.map((extra, index) =>
      insertEntity(db, { name: `plain-${index}`, groupId: groupA, entityTypeId: typeA, ...extra }),
    );
    insertEntity(db, {
      name: "other",
      groupId: groupB,
      entityTypeId: typeB,
      description: "résumé of the lamp",
      manufacturer: "Café Co",
    });

    queries.forEach((query, index) => {
      const found = searchEntities(db, { groupId: groupA, search: query });
      expect(found.map((row) => row.id)).toContain(ids[index]);
      expect(found.every((row) => row.groupId === groupA)).toBe(true);
    });
    expect(searchEntities(db, { groupId: groupA, search: "zzzz-not-a-match" })).toEqual([]);
  });

  test("a combining mark in the stored name matches the unaccented query", () => {
    const db = openDb();
    const groupA = insertGroup(db, { name: "Alpha", currency: "usd" });
    const typeA = insertEntityType(db, { name: "Item", groupId: groupA, isLocation: 0 });
    const id = insertEntity(db, { name: "cafe\u0301", groupId: groupA, entityTypeId: typeA });
    expect(searchEntities(db, { groupId: groupA, search: "cafe" }).map((row) => row.id)).toEqual([id]);
  });

  test("does not add an FTS index", () => {
    const db = openDb();
    const groupA = insertGroup(db, { name: "Alpha", currency: "usd" });
    const typeA = insertEntityType(db, { name: "Item", groupId: groupA, isLocation: 0 });
    insertEntity(db, { name: "café", groupId: groupA, entityTypeId: typeA });
    searchEntities(db, { groupId: groupA, search: "cafe" });
    const virtual = db.query("SELECT name FROM sqlite_master WHERE sql LIKE '%fts%' OR name LIKE '%fts%'").all();
    expect(virtual).toEqual([]);
  });

  test("the entities route searches only the authenticated group", async () => {
    const db = openDb();
    const groupA = insertGroup(db, { name: "Alpha", currency: "usd" });
    const groupB = insertGroup(db, { name: "Beta", currency: "eur" });
    const owner = insertUser(db, { name: "Owner", email: "owner@alpha.test", groupId: groupA });
    const typeA = insertEntityType(db, { name: "Item", groupId: groupA, isLocation: 0 });
    const typeB = insertEntityType(db, { name: "Item", groupId: groupB, isLocation: 0 });
    insertEntity(db, { name: "café", groupId: groupA, entityTypeId: typeA });
    insertEntity(db, { name: "café secret", groupId: groupB, entityTypeId: typeB });
    const session = createSession(db, uuidToBytes(owner), false);
    const config = loadConfig(
      {
        HBOX_DATABASE_SQLITE_PATH: ":memory:",
        HBOX_AUTH_API_KEY_PEPPER: "test-pepper-not-for-production-use!!",
        HBOX_OPTIONS_ALLOW_REGISTRATION: "true",
      },
      [],
      migrationsDir,
    );
    const app = createApp(config, process.env, { db });
    const denied = await app.request("http://127.0.0.1:7745/api/v1/entities?q=cafe");
    expect(denied.status).toBe(401);
    expect(((await denied.json()) as { error: string }).error).toBe("authorization header or query is required");

    const response = await app.request("http://127.0.0.1:7745/api/v1/entities?q=cafe", {
      headers: { cookie: `hb.auth.token=${session.raw}`, host: "127.0.0.1:7745" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ name: string }> };
    expect(body.items.map((row) => row.name)).toEqual(["café"]);
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
