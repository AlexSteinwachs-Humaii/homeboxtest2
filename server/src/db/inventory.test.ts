import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

import { openDatabase } from "../db.ts";
import { runMigrations } from "../migrate.ts";
import {
  getEntityById,
  getEntityFieldById,
  getMaintenanceEntryById,
  getTagById,
  insertEntity,
  insertEntityField,
  insertEntityType,
  insertGroup,
  insertMaintenanceEntry,
  insertTag,
  insertTagLink,
  listEntities,
  listEntityFields,
  listMaintenanceEntries,
  listTagIdsForEntity,
  listTags,
  updateEntityName,
  updateTagName,
} from "./inventory.ts";
import { bytesToUuid, uuidToBytes } from "./storage.ts";

const migrationsDir = resolve(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const fixtureDir = resolve(import.meta.dir, "../../testdata");
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "homebox-inventory-"));
  temps.push(dir);
  return dir;
}

function migratedDb(dir: string): { path: string; db: Database } {
  const path = join(dir, "homebox.db");
  const db = openDatabase(path);
  runMigrations(db, migrationsDir);
  return { path, db };
}

type IdStorage = { t: string; n: number; h: string };

function idStorage(db: Database, table: string, id: string): IdStorage {
  const row = db
    .query(`SELECT typeof(id) AS t, length(id) AS n, hex(id) AS h FROM ${table} WHERE id = ? OR id = ?`)
    .get(uuidToBytes(id), id) as IdStorage | null;
  if (!row) throw new Error(`missing ${table} ${id}`);
  return { t: row.t, n: Number(row.n), h: row.h };
}

function rawColumn(db: Database, sql: string, id: string): unknown {
  const row = db.query(sql).get(uuidToBytes(id), id) as Record<string, unknown> | null;
  if (!row) throw new Error(`missing row for ${id}`);
  return row;
}

type FixtureIds = {
  groupId: string;
  userId: string;
  locationTypeId: string;
  itemTypeId: string;
  locationId: string;
  itemId: string;
  tagId: string;
  fieldId: string;
  maintenanceId: string;
  legacyGroupId: string;
  legacyTagId: string;
};

function writeGoFixture(path: string): FixtureIds {
  const ran = Bun.spawnSync(["go", "run", ".", path], {
    cwd: fixtureDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (ran.exitCode !== 0) {
    throw new Error(`go fixture failed (${ran.exitCode}): ${ran.stderr.toString()}`);
  }
  return JSON.parse(ran.stdout.toString()) as FixtureIds;
}

describe("uuid bytes", () => {
  test("uses google/uuid byte order, not a text uuid", () => {
    const text = "00112233-4455-6677-8899-aabbccddeeff";
    const bytes = uuidToBytes(text);
    expect(bytes.byteLength).toBe(16);
    expect(Buffer.from(bytes).toString("hex")).toBe("00112233445566778899aabbccddeeff");
    expect(bytesToUuid(bytes)).toBe(text);
    expect(bytesToUuid(uuidToBytes("00112233-4455-6677-8899-AABBCCDDEEFF"))).toBe(text);
  });
});

describe("go-written fixture", () => {
  test("items, locations, tags, fields, and maintenance keep the ids Go would return", () => {
    const dir = tempDir();
    const { path, db } = migratedDb(dir);
    const schemaBefore = db.query("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    db.close();

    const ids = writeGoFixture(path);
    const opened = new Database(path);
    opened.exec("PRAGMA foreign_keys = ON");

    const item = getEntityById(opened, ids.groupId, ids.itemId);
    const location = getEntityById(opened, ids.groupId, ids.locationId);
    const tag = getTagById(opened, ids.groupId, ids.tagId);
    const legacyTag = getTagById(opened, ids.legacyGroupId, ids.legacyTagId);
    const field = getEntityFieldById(opened, ids.groupId, ids.fieldId);
    const maintenance = getMaintenanceEntryById(opened, ids.groupId, ids.maintenanceId);

    expect(item?.id).toBe(ids.itemId);
    expect(location?.id).toBe(ids.locationId);
    expect(tag?.id).toBe(ids.tagId);
    expect(legacyTag?.id).toBe(ids.legacyTagId);
    expect(field?.id).toBe(ids.fieldId);
    expect(maintenance?.id).toBe(ids.maintenanceId);

    expect(item?.isLocation).toBe(0);
    expect(location?.isLocation).toBe(1);
    expect(item?.parentId).toBe(ids.locationId);
    expect(item?.groupId).toBe(ids.groupId);
    expect(item?.entityTypeId).toBe(ids.itemTypeId);
    expect(location?.entityTypeId).toBe(ids.locationTypeId);
    expect(tag?.groupId).toBe(ids.groupId);
    expect(field?.entityId).toBe(ids.itemId);
    expect(maintenance?.entityId).toBe(ids.itemId);
    expect(listTagIdsForEntity(opened, ids.groupId, ids.itemId)).toEqual([ids.tagId]);

    const locations = listEntities(opened, { groupId: ids.groupId, isLocation: true });
    const items = listEntities(opened, { groupId: ids.groupId, isLocation: false });
    expect(locations.map((row) => row.id)).toEqual([ids.locationId]);
    expect(items.map((row) => row.id)).toEqual([ids.itemId]);
    expect(listTags(opened, { groupId: ids.groupId }).map((row) => row.id)).toEqual([ids.tagId]);
    expect(listEntityFields(opened, { groupId: ids.groupId, entityId: ids.itemId }).map((row) => row.id)).toEqual([
      ids.fieldId,
    ]);
    expect(listMaintenanceEntries(opened, { groupId: ids.groupId, entityId: ids.itemId }).map((row) => row.id)).toEqual([
      ids.maintenanceId,
    ]);

    const itemRaw = rawColumn(
      opened,
      `SELECT created_at, updated_at, warranty_expires, purchase_date, insured, archived, lifetime_warranty, sync_child_entity_locations, quantity, purchase_price, asset_id
       FROM entities WHERE hex(id) = hex(?) OR id = ?`,
      ids.itemId,
    ) as Record<string, unknown>;
    expect(item?.createdAt).toBe(itemRaw.created_at);
    expect(item?.updatedAt).toBe(itemRaw.updated_at);
    expect(item?.warrantyExpires).toBe(itemRaw.warranty_expires);
    expect(item?.purchaseDate).toBe(itemRaw.purchase_date);
    expect(typeof item?.createdAt).toBe("string");
    expect(item?.createdAt).not.toContain("T");
    expect(item?.insured).toBe(itemRaw.insured);
    expect(item?.archived).toBe(itemRaw.archived);
    expect(item?.lifetimeWarranty).toBe(itemRaw.lifetime_warranty);
    expect(item?.syncChildEntityLocations).toBe(itemRaw.sync_child_entity_locations);
    expect(item?.insured).toBe(1);
    expect(item?.archived).toBe(0);
    expect(typeof item?.insured).toBe("number");
    expect(item?.quantity).toBe(itemRaw.quantity);
    expect(item?.purchasePrice).toBe(itemRaw.purchase_price);
    expect(item?.assetId).toBe(itemRaw.asset_id);

    const fieldRaw = rawColumn(
      opened,
      `SELECT boolean_value, time_value, number_value, text_value FROM entity_fields WHERE hex(id) = hex(?) OR id = ?`,
      ids.fieldId,
    ) as Record<string, unknown>;
    expect(field?.booleanValue).toBe(fieldRaw.boolean_value);
    expect(field?.booleanValue).toBe(1);
    expect(typeof field?.booleanValue).toBe("number");
    expect(field?.timeValue).toBe(fieldRaw.time_value);
    expect(typeof field?.timeValue).toBe("string");
    expect(field?.numberValue).toBe(fieldRaw.number_value);
    expect(field?.textValue).toBe(fieldRaw.text_value);

    const maintRaw = rawColumn(
      opened,
      `SELECT date, scheduled_date, cost FROM maintenance_entries WHERE hex(id) = hex(?) OR id = ?`,
      ids.maintenanceId,
    ) as Record<string, unknown>;
    expect(maintenance?.date).toBe(maintRaw.date);
    expect(maintenance?.scheduledDate).toBe(maintRaw.scheduled_date);
    expect(maintenance?.cost).toBe(maintRaw.cost);
    expect(typeof maintenance?.date).toBe("string");

    const before = idStorage(opened, "entities", ids.itemId);
    const createdBefore = item?.createdAt;
    const insuredBefore = item?.insured;
    updateEntityName(opened, ids.groupId, ids.itemId, "Mug renamed");
    const after = idStorage(opened, "entities", ids.itemId);
    expect(after).toEqual(before);
    expect(after.t).toBe("blob");
    expect(after.n).toBe(16);
    const renamed = getEntityById(opened, ids.groupId, ids.itemId);
    expect(renamed?.name).toBe("Mug renamed");
    expect(renamed?.id).toBe(ids.itemId);
    expect(renamed?.createdAt).toBe(createdBefore);
    expect(renamed?.insured).toBe(insuredBefore);
    expect(renamed?.purchaseDate).toBe(item?.purchaseDate);

    const legacyBefore = idStorage(opened, "tags", ids.legacyTagId);
    expect(legacyBefore.t).toBe("text");
    expect(legacyBefore.n).toBe(36);
    updateTagName(opened, ids.legacyGroupId, ids.legacyTagId, "Legacy renamed");
    expect(idStorage(opened, "tags", ids.legacyTagId)).toEqual(legacyBefore);
    expect(getTagById(opened, ids.legacyGroupId, ids.legacyTagId)?.id).toBe(ids.legacyTagId);

    const schemaAfter = opened.query("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    expect(schemaAfter).toEqual(schemaBefore);
    opened.close();
  });
});

describe("new rows", () => {
  test("inserts a 16-byte blob uuid and does not store text", () => {
    const dir = tempDir();
    const { db } = migratedDb(dir);
    const schemaBefore = db.query("SELECT sql FROM sqlite_master WHERE name = 'entities'").get();

    const createdAt = "2020-06-15 08:30:01.123456789+00:00";
    const purchaseDate = "2019-01-02 15:04:05+00:00";
    const groupId = insertGroup(db, { name: "Home", createdAt });
    const locationTypeId = insertEntityType(db, {
      name: "Location",
      groupId,
      isLocation: 1,
      createdAt,
    });
    const itemTypeId = insertEntityType(db, { name: "Item", groupId, isLocation: 0, createdAt });
    const locationId = insertEntity(db, {
      name: "Shelf",
      groupId,
      entityTypeId: locationTypeId,
      createdAt,
      insured: 0,
    });
    const itemId = insertEntity(db, {
      id: "abcdefab-cdef-4abc-8def-0123456789ab",
      name: "Lamp",
      groupId,
      entityTypeId: itemTypeId,
      parentId: locationId,
      createdAt,
      insured: 1,
      archived: 0,
      quantity: 3,
      purchaseDate,
      purchasePrice: 19.5,
    });
    const tagId = insertTag(db, { name: "Lighting", groupId, createdAt, color: "#fff" });
    insertTagLink(db, tagId, itemId);
    const fieldId = insertEntityField(db, {
      name: "Watts",
      entityId: itemId,
      type: "number",
      numberValue: 60,
      booleanValue: 0,
      timeValue: createdAt,
      createdAt,
    });
    const maintenanceId = insertMaintenanceEntry(db, {
      name: "Replace bulb",
      entityId: itemId,
      date: purchaseDate,
      cost: 4,
      createdAt,
    });

    for (const [table, id] of [
      ["groups", groupId],
      ["entity_types", locationTypeId],
      ["entities", itemId],
      ["tags", tagId],
      ["entity_fields", fieldId],
      ["maintenance_entries", maintenanceId],
    ] as const) {
      const stored = idStorage(db, table, id);
      expect(stored.t).toBe("blob");
      expect(stored.n).toBe(16);
      expect(stored.h.toLowerCase()).toBe(uuidToBytes(id).reduce((hex, b) => hex + b.toString(16).padStart(2, "0"), ""));
    }

    const link = db
      .query("SELECT typeof(tag_id) AS tt, length(tag_id) AS tn, typeof(entity_id) AS et, length(entity_id) AS en FROM tag_entities")
      .get() as { tt: string; tn: number; et: string; en: number };
    expect(link).toEqual({ tt: "blob", tn: 16, et: "blob", en: 16 });

    const item = getEntityById(db, groupId, itemId);
    expect(item?.id).toBe("abcdefab-cdef-4abc-8def-0123456789ab");
    expect(item?.createdAt).toBe(createdAt);
    expect(item?.purchaseDate).toBe(purchaseDate);
    expect(item?.insured).toBe(1);
    expect(typeof item?.insured).toBe("number");
    expect(item?.parentId).toBe(locationId);
    expect(item?.isLocation).toBe(0);
    expect(getEntityById(db, groupId, locationId)?.isLocation).toBe(1);
    expect(listEntities(db, { groupId, isLocation: true }).map((row) => row.id)).toEqual([locationId]);
    expect(listEntities(db, { groupId, isLocation: false }).map((row) => row.id)).toEqual([itemId]);
    expect(getTagById(db, groupId, tagId)?.id).toBe(tagId);
    expect(getEntityFieldById(db, groupId, fieldId)?.booleanValue).toBe(0);
    expect(getEntityFieldById(db, groupId, fieldId)?.timeValue).toBe(createdAt);
    expect(getMaintenanceEntryById(db, groupId, maintenanceId)?.date).toBe(purchaseDate);
    expect(listTagIdsForEntity(db, groupId, itemId)).toEqual([tagId]);

    const before = idStorage(db, "entities", itemId);
    updateEntityName(db, groupId, itemId, "Lamp renamed");
    expect(idStorage(db, "entities", itemId)).toEqual(before);
    expect(getEntityById(db, groupId, itemId)?.createdAt).toBe(createdAt);
    expect(getEntityById(db, groupId, itemId)?.insured).toBe(1);

    expect(db.query("SELECT sql FROM sqlite_master WHERE name = 'entities'").get()).toEqual(schemaBefore);
    const schemaSource = readFileSync(resolve(import.meta.dir, "schema.ts"), "utf8");
    expect(schemaSource).not.toContain('mode: "uuid"');
    expect(schemaSource).not.toContain('mode: "boolean"');
    expect(schemaSource).not.toContain("drizzle-kit");
    db.close();
  });
});
