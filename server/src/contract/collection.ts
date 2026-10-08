import type { Database } from "bun:sqlite";

import { publishExportMutation, publishImportMutation } from "../events/bus.ts";
import { bytesToUuid, formatSqliteDateTime, newUuidBytes, sqliteNow, uuidToBytes } from "../db/storage.ts";
import { attachmentRelativePath } from "../attachments/blob.ts";
import { readAttachmentBytes, writeAttachmentBytes, storageLayout, type StorageLayout } from "../attachments/blob.ts";
import { idPair, isUuid, readUuid } from "./ids.ts";
import { unzip, zipStore, type ZipEntry } from "./zip.ts";

export const EXPORT_SCHEMA_VERSION = 1;
export const MANIFEST_FILE = "manifest.json";
export const ATTACHMENTS_DIR = "attachments/";

// Same table order and column roles as service_exports.go exportTables.
const TABLES: Array<{
  name: string;
  scope: string;
  pk?: string;
  groupCols: string[];
  userCols: string[];
  fk: Record<string, string>;
  defer: Record<string, string>;
}> = [
  {
    name: "entity_types",
    scope: "group_entity_types = ? OR group_entity_types = ?",
    pk: "id",
    groupCols: ["group_entity_types"],
    userCols: [],
    fk: {},
    defer: { entity_type_default_template: "entity_templates" },
  },
  {
    name: "entity_templates",
    scope: "group_entity_templates = ? OR group_entity_templates = ?",
    pk: "id",
    groupCols: ["group_entity_templates"],
    userCols: [],
    fk: {},
    defer: { entity_template_location: "entities" },
  },
  {
    name: "template_fields",
    scope: "entity_template_fields IN (SELECT id FROM entity_templates WHERE group_entity_templates = ? OR group_entity_templates = ?)",
    pk: "id",
    groupCols: [],
    userCols: [],
    fk: { entity_template_fields: "entity_templates" },
    defer: {},
  },
  {
    name: "tags",
    scope: "group_tags = ? OR group_tags = ?",
    pk: "id",
    groupCols: ["group_tags"],
    userCols: [],
    fk: {},
    defer: { tag_children: "tags" },
  },
  {
    name: "entities",
    scope: "group_entities = ? OR group_entities = ?",
    pk: "id",
    groupCols: ["group_entities"],
    userCols: [],
    fk: { entity_type_entities: "entity_types" },
    defer: { entity_children: "entities" },
  },
  {
    name: "entity_fields",
    scope: "entity_fields IN (SELECT id FROM entities WHERE group_entities = ? OR group_entities = ?)",
    pk: "id",
    groupCols: [],
    userCols: [],
    fk: { entity_fields: "entities" },
    defer: {},
  },
  {
    name: "maintenance_entries",
    scope: "entity_id IN (SELECT id FROM entities WHERE group_entities = ? OR group_entities = ?)",
    pk: "id",
    groupCols: [],
    userCols: [],
    fk: { entity_id: "entities" },
    defer: {},
  },
  {
    name: "attachments",
    scope:
      "entity_attachments IN (SELECT id FROM entities WHERE group_entities = ? OR group_entities = ?) OR id IN (SELECT attachment_thumbnail FROM attachments WHERE attachment_thumbnail IS NOT NULL AND entity_attachments IN (SELECT id FROM entities WHERE group_entities = ? OR group_entities = ?))",
    pk: "id",
    groupCols: [],
    userCols: [],
    fk: { entity_attachments: "entities" },
    defer: { attachment_thumbnail: "attachments" },
  },
  {
    name: "tag_entities",
    scope: "tag_id IN (SELECT id FROM tags WHERE group_tags = ? OR group_tags = ?)",
    groupCols: [],
    userCols: [],
    fk: { tag_id: "tags", entity_id: "entities" },
    defer: {},
  },
  {
    name: "notifiers",
    scope: "group_id = ? OR group_id = ?",
    pk: "id",
    groupCols: ["group_id"],
    userCols: ["user_id"],
    fk: {},
    defer: {},
  },
];

const UUID_COLUMNS = new Set(
  TABLES.flatMap((table) => [
    table.pk ?? "",
    ...table.groupCols,
    ...table.userCols,
    ...Object.keys(table.fk),
    ...Object.keys(table.defer),
  ]).filter(Boolean),
);

function jsonValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Uint8Array) {
    const uuid = readUuid(value);
    if (uuid) return uuid;
    return new TextDecoder().decode(value);
  }
  return value;
}

function dumpTable(db: Database, name: string, scope: string, groupId: string): Array<Record<string, unknown>> {
  const [bytes, text] = idPair(groupId);
  const placeholders = scope.split("?").length - 1;
  const params: unknown[] = [];
  for (let i = 0; i < placeholders; i++) params.push(i % 2 === 0 ? bytes : text);
  const rows = db.query(`SELECT * FROM ${name} WHERE ${scope}`).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(row).sort()) out[key] = jsonValue(row[key]);
    return out;
  });
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

export type BuiltExport = {
  bytes: Uint8Array;
  counts: Record<string, number>;
  artifactPath: string;
};

export function buildCollectionZip(
  db: Database,
  groupId: string,
  exportId: string,
  layout: StorageLayout,
): BuiltExport {
  const counts: Record<string, number> = {};
  const entries: ZipEntry[] = [];
  for (const table of TABLES) {
    const rows = dumpTable(db, table.name, table.scope, groupId);
    counts[table.name] = rows.length;
    entries.push({ name: `${table.name}.json`, data: encodeJson(rows) });
  }
  const [gidBytes, gidText] = idPair(groupId);
  const attachments = db
    .query(
      `SELECT id, path FROM attachments WHERE entity_attachments IN (SELECT id FROM entities WHERE group_entities = ? OR group_entities = ?)`,
    )
    .all(gidBytes, gidText) as Array<{ id: unknown; path: string }>;
  for (const row of attachments) {
    if (!row.path) continue;
    const id = readUuid(row.id);
    const bytes = readAttachmentBytes(layout, row.path);
    if (!id || !bytes) continue;
    entries.push({ name: `${ATTACHMENTS_DIR}${id}`, data: bytes });
  }
  const manifest = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    groupId,
    counts,
  };
  entries.push({ name: MANIFEST_FILE, data: encodeJson(manifest) });
  return {
    bytes: zipStore(entries),
    counts,
    artifactPath: `${groupId}/exports/${exportId}.zip`,
  };
}

export function groupReadyForImport(db: Database, groupId: string): boolean {
  const [bytes, text] = idPair(groupId);
  const count = (sql: string) => (db.query(sql).get(bytes, text) as { n: number }).n;
  const items = count(
    `SELECT COUNT(*) AS n FROM entities e JOIN entity_types t ON t.id = e.entity_type_entities
     WHERE (e.group_entities = ? OR e.group_entities = ?) AND t.is_location = 0`,
  );
  if (items > 0) return false;
  const locations = count(
    `SELECT COUNT(*) AS n FROM entities e JOIN entity_types t ON t.id = e.entity_type_entities
     WHERE (e.group_entities = ? OR e.group_entities = ?) AND t.is_location = 1`,
  );
  if (locations > 8) return false;
  const tags = count(`SELECT COUNT(*) AS n FROM tags WHERE group_tags = ? OR group_tags = ?`);
  if (tags > 6) return false;
  const types = count(`SELECT COUNT(*) AS n FROM entity_types WHERE group_entity_types = ? OR group_entity_types = ?`);
  if (types > 2) return false;
  const templates = count(`SELECT COUNT(*) AS n FROM entity_templates WHERE group_entity_templates = ? OR group_entity_templates = ?`);
  if (templates > 0) return false;
  const notifiers = count(`SELECT COUNT(*) AS n FROM notifiers WHERE group_id = ? OR group_id = ?`);
  if (notifiers > 0) return false;
  return true;
}

function asRecord(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

function coerce(value: unknown, column: string): unknown {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && UUID_COLUMNS.has(column) && isUuid(value)) return uuidToBytes(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return formatSqliteDateTime(date);
  }
  return value;
}

export function importCollectionZip(
  db: Database,
  groupId: string,
  userId: string,
  zip: Uint8Array,
  layout: StorageLayout,
): void {
  const files = unzip(zip);
  const manifestRaw = files.get(MANIFEST_FILE);
  if (!manifestRaw) throw new Error("manifest.json missing from zip");
  const manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as { schemaVersion?: number; groupId?: string };
  if (manifest.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new Error(`unsupported export schemaVersion ${manifest.schemaVersion}`);
  }
  const srcGroup = manifest.groupId ?? "";
  const idMap = new Map<string, Map<string, string>>();
  const remember = (table: string, oldId: string, newId: string) => {
    const bucket = idMap.get(table) ?? new Map<string, string>();
    bucket.set(oldId, newId);
    idMap.set(table, bucket);
  };
  const remap = (table: string, value: unknown): unknown => {
    if (value == null || value === "") return null;
    const mapped = idMap.get(table)?.get(String(value));
    return mapped ? uuidToBytes(mapped) : coerce(value, "id");
  };
  const deferred: Array<{ table: string; column: string; id: string; value: string; target: string }> = [];

  db.run("BEGIN");
  try {
    wipeGroup(db, groupId);
    for (const table of TABLES) {
      const raw = files.get(`${table.name}.json`);
      const rows = raw ? asRecord(JSON.parse(new TextDecoder().decode(raw))) : [];
      for (const row of rows) {
        const next: Record<string, unknown> = { ...row };
        let newId = "";
        if (table.pk && next[table.pk] != null) {
          const old = String(next[table.pk]);
          newId = bytesToUuid(newUuidBytes());
          next[table.pk] = uuidToBytes(newId);
          remember(table.name, old, newId);
        }
        for (const column of table.groupCols) next[column] = uuidToBytes(groupId);
        for (const column of table.userCols) next[column] = uuidToBytes(userId);
        for (const [column, target] of Object.entries(table.fk)) next[column] = remap(target, next[column]);
        for (const [column, target] of Object.entries(table.defer)) {
          if (next[column] != null && next[column] !== "" && newId) {
            deferred.push({ table: table.name, column, id: newId, value: String(next[column]), target });
          }
          next[column] = null;
        }
        if (table.name === "attachments") rewriteAttachmentPath(next, srcGroup, groupId);
        insertRow(db, table.name, next);
      }
    }
    for (const update of deferred) {
      const mapped = idMap.get(update.target)?.get(update.value);
      if (!mapped) continue;
      db.run(`UPDATE ${update.table} SET ${update.column} = ? WHERE id = ? OR id = ?`, [
        uuidToBytes(mapped),
        uuidToBytes(update.id),
        update.id,
      ]);
    }
    for (const [name, bytes] of files) {
      if (!name.startsWith(ATTACHMENTS_DIR)) continue;
      const oldId = name.slice(ATTACHMENTS_DIR.length);
      const newId = idMap.get("attachments")?.get(oldId);
      if (!newId) continue;
      const row = db.query(`SELECT path FROM attachments WHERE id = ? OR id = ?`).get(uuidToBytes(newId), newId) as
        | { path: string }
        | null;
      if (!row?.path) continue;
      writeAttachmentBytes(layout, row.path, bytes);
    }
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
  publishImportMutation(groupId);
}

function rewriteAttachmentPath(row: Record<string, unknown>, srcGroup: string, dstGroup: string): void {
  const path = String(row.path ?? "");
  const prefix = `${srcGroup}/documents/`;
  if (!path.startsWith(prefix) || path.includes("..")) {
    throw new Error(`attachment path ${path} does not live under source group's documents prefix`);
  }
  const next = `${dstGroup}/documents/${path.slice(prefix.length)}`;
  if (!next.startsWith(`${dstGroup}/documents/`)) {
    throw new Error(`rewritten attachment path ${next} escapes destination group's documents prefix`);
  }
  row.path = next;
}

function insertRow(db: Database, table: string, row: Record<string, unknown>): void {
  const columns = Object.keys(row);
  const values = columns.map((column) => coerce(row[column], column));
  const quoted = columns.map((column) => `"${column.replaceAll('"', "")}"`).join(", ");
  db.run(`INSERT INTO ${table} (${quoted}) VALUES (${columns.map(() => "?").join(", ")})`, values);
}

function wipeGroup(db: Database, groupId: string): void {
  const [bytes, text] = idPair(groupId);
  const pair = [bytes, text];
  db.run(
    `DELETE FROM tag_entities WHERE tag_id IN (SELECT id FROM tags WHERE group_tags = ? OR group_tags = ?)`,
    pair,
  );
  db.run(`DELETE FROM notifiers WHERE group_id = ? OR group_id = ?`, pair);
  db.run(
    `DELETE FROM attachments WHERE entity_attachments IN (SELECT id FROM entities WHERE group_entities = ? OR group_entities = ?)`,
    pair,
  );
  db.run(
    `DELETE FROM maintenance_entries WHERE entity_id IN (SELECT id FROM entities WHERE group_entities = ? OR group_entities = ?)`,
    pair,
  );
  db.run(
    `DELETE FROM entity_fields WHERE entity_fields IN (SELECT id FROM entities WHERE group_entities = ? OR group_entities = ?)`,
    pair,
  );
  db.run(`DELETE FROM entities WHERE group_entities = ? OR group_entities = ?`, pair);
  db.run(`DELETE FROM tags WHERE group_tags = ? OR group_tags = ?`, pair);
  db.run(
    `DELETE FROM template_fields WHERE entity_template_fields IN (SELECT id FROM entity_templates WHERE group_entity_templates = ? OR group_entity_templates = ?)`,
    pair,
  );
  db.run(`DELETE FROM entity_templates WHERE group_entity_templates = ? OR group_entity_templates = ?`, pair);
  db.run(`DELETE FROM entity_types WHERE group_entity_types = ? OR group_entity_types = ?`, pair);
}

export function storeExportArtifact(layout: StorageLayout, artifactPath: string, bytes: Uint8Array): void {
  writeAttachmentBytes(layout, artifactPath, bytes);
}

export function readExportArtifact(layout: StorageLayout, artifactPath: string): Uint8Array | null {
  return readAttachmentBytes(layout, artifactPath);
}

export function publishExport(groupId: string): void {
  publishExportMutation(groupId);
}

export function relativeExportPath(groupId: string, exportId: string): string {
  return attachmentRelativePath(groupId, new TextEncoder().encode(exportId)).replace(/documents\/.*/, `exports/${exportId}.zip`);
}

export { storageLayout, sqliteNow };
