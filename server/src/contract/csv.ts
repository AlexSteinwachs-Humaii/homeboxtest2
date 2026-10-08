import type { Database } from "bun:sqlite";

import { createEntityForGroup, createTagForGroup, getEntityForGroup } from "../auth/tenancy.ts";
import { insertEntityField, insertEntityType, listEntities, listTags, updateEntityName } from "../db/inventory.ts";
import { bytesToUuid, sqliteNow, uuidToBytes } from "../db/storage.ts";
import { idPair, readUuid } from "./ids.ts";
import { extraPurchase, formatAssetId, presentEntity } from "./present.ts";

// Primary csv tags from reporting.ExportCSVRow, in struct field order.
export const CSV_HEADERS = [
  "HB.purchase_date",
  "HB.warranty_expires",
  "HB.sold_date",
  "HB.import_ref",
  "HB.parent_import_ref",
  "HB.url",
  "HB.name",
  "HB.description",
  "HB.notes",
  "HB.purchase_from",
  "HB.manufacturer",
  "HB.model_number",
  "HB.serial_number",
  "HB.warranty_details",
  "HB.sold_to",
  "HB.sold_notes",
  "HB.location",
  "HB.tags",
  "HB.asset_id",
  "HB.quantity",
  "HB.purchase_price",
  "HB.sold_price",
  "HB.archived",
  "HB.insured",
  "HB.lifetime_warranty",
] as const;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function encodeCsv(rows: string[][]): string {
  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char !== "\r") cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value !== ""));
}

function locationPath(db: Database, groupId: string, entityId: string | null): string {
  const names: string[] = [];
  let cursor = entityId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const current = getEntityForGroup(db, groupId, cursor);
    if (!current) break;
    if (current.isLocation) names.unshift(current.name);
    cursor = current.parentId;
  }
  return names.join(" / ");
}

export function exportEntitiesCsv(db: Database, groupId: string, hbUrl: string): string {
  const entities = listEntities(db, { groupId });
  const byId = new Map(entities.map((row) => [row.id, row]));
  const fieldNames = new Set<string>();
  const rendered = entities.map((row) => {
    const extra = extraPurchase(db, row.id);
    const presented = presentEntity(db, groupId, row.id);
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    const parentImport = parent && !parent.isLocation ? (extraPurchase(db, parent.id)?.import_ref ?? "") : "";
    const url = hbUrl ? `${hbUrl.replace(/\/$/, "")}/item/${row.id}` : "";
    const fields = presented?.fields ?? [];
    for (const field of fields) fieldNames.add(field.name);
    return {
      cells: [
        row.purchaseDate ?? "",
        row.warrantyExpires ?? "",
        row.soldDate ?? "",
        extra?.import_ref ?? "",
        parentImport,
        url,
        row.name,
        row.description ?? "",
        row.notes ?? "",
        extra?.purchase_from ?? "",
        row.manufacturer ?? "",
        row.modelNumber ?? "",
        row.serialNumber ?? "",
        extra?.warranty_details ?? "",
        extra?.sold_to ?? "",
        extra?.sold_notes ?? "",
        locationPath(db, groupId, row.parentId),
        (presented?.tags ?? []).map((tag) => tag.name).join("; "),
        formatAssetId(row.assetId),
        String(row.quantity),
        String(row.purchasePrice),
        String(row.soldPrice),
        row.archived === 1 ? "true" : "false",
        row.insured === 1 ? "true" : "false",
        row.lifetimeWarranty === 1 ? "true" : "false",
      ],
      fields,
    };
  });
  const custom = [...fieldNames].sort();
  const header = [...CSV_HEADERS, ...custom.map((name) => `HB.field.${name}`)];
  const body = rendered.map((row) => {
    const values = new Map(row.fields.map((field) => [field.name, field.textValue]));
    return [...row.cells, ...custom.map((name) => values.get(name) ?? "")];
  });
  return encodeCsv([header, ...body]);
}

function headerIndex(headers: string[]): Map<string, number> {
  const index = new Map<string, number>();
  headers.forEach((header, i) => {
    const name = header.trim();
    index.set(name, i);
    if (name === "HB.labels") index.set("HB.tags", i);
    if (name === "HB.purchase_time") index.set("HB.purchase_date", i);
    if (name === "HB.sold_time") index.set("HB.sold_date", i);
  });
  return index;
}

function cell(row: string[], index: Map<string, number>, name: string): string {
  const at = index.get(name);
  if (at === undefined) return "";
  return row[at] ?? "";
}

function parseBool(value: string): number {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" ? 1 : 0;
}

function parseAsset(value: string): number {
  const digits = value.replaceAll("-", "").replaceAll('"', "");
  if (!/^\d+$/.test(digits)) return 0;
  return Number(digits);
}

function typeId(db: Database, groupId: string, name: string, isLocation: boolean): string {
  const [bytes, text] = idPair(groupId);
  const existing = db
    .query(
      `SELECT id FROM entity_types
       WHERE (group_entity_types = ? OR group_entity_types = ?) AND name = ? AND is_location = ?`,
    )
    .get(bytes, text, name, isLocation ? 1 : 0) as { id: unknown } | null;
  const found = existing ? readUuid(existing.id) : null;
  if (found) return found;
  return insertEntityType(db, { name, groupId, isLocation: isLocation ? 1 : 0 });
}

function ensureLocation(
  db: Database,
  groupId: string,
  path: string,
  typeIdValue: string,
  cache: Map<string, string>,
): string | null {
  const parts = path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  let parent: string | null = null;
  let key = "";
  for (const name of parts) {
    key = key ? `${key} / ${name}` : name;
    const cached = cache.get(key);
    if (cached) {
      parent = cached;
      continue;
    }
    const id = createEntityForGroup(db, groupId, { name, entityTypeId: typeIdValue, parentId: parent });
    cache.set(key, id);
    parent = id;
  }
  return parent;
}

export function importEntitiesCsv(db: Database, groupId: string, csv: string): number {
  const sheet = parseCsv(csv);
  if (sheet.length < 2) throw new Error("sheet must have at least 1 row of data (header + 1)");
  const index = headerIndex(sheet[0]);
  const itemType = typeId(db, groupId, "Item", false);
  const locationType = typeId(db, groupId, "Location", true);
  const tagMap = new Map(listTags(db, { groupId }).map((tag) => [tag.name, tag.id]));
  const locationMap = new Map<string, string>();
  for (const location of listEntities(db, { groupId, isLocation: true })) {
    locationMap.set(locationPath(db, groupId, location.id) || location.name, location.id);
  }
  const customHeaders = sheet[0]
    .map((header, i) => ({ header: header.trim(), i }))
    .filter((item) => item.header.startsWith("HB.field."));
  let count = 0;
  const [gidBytes, gidText] = idPair(groupId);
  for (const row of sheet.slice(1)) {
    const name = cell(row, index, "HB.name").trim();
    if (!name) continue;
    const importRef = cell(row, index, "HB.import_ref").trim();
    const tagIds = cell(row, index, "HB.tags")
      .split(";")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => {
        const existing = tagMap.get(tag);
        if (existing) return existing;
        const id = createTagForGroup(db, groupId, { name: tag });
        tagMap.set(tag, id);
        return id;
      });
    const parentId = ensureLocation(db, groupId, cell(row, index, "HB.location"), locationType, locationMap);
    let entityId: string | null = null;
    if (importRef) {
      const found = db
        .query(`SELECT id FROM entities WHERE import_ref = ? AND (group_entities = ? OR group_entities = ?)`)
        .get(importRef, gidBytes, gidText) as { id: unknown } | null;
      entityId = found ? readUuid(found.id) : null;
    }
    if (!entityId) {
      entityId = createEntityForGroup(db, groupId, { name, entityTypeId: itemType, parentId, tagIds });
      count++;
    } else {
      updateEntityName(db, groupId, entityId, name);
      const [idBytes, idText] = idPair(entityId);
      db.run(`DELETE FROM tag_entities WHERE entity_id = ? OR entity_id = ?`, [idBytes, idText]);
      for (const tagId of tagIds) {
        db.run(`INSERT INTO tag_entities (tag_id, entity_id) VALUES (?, ?)`, [uuidToBytes(tagId), uuidToBytes(entityId)]);
      }
    }
    const [idBytes, idText] = idPair(entityId);
    db.run(
      `UPDATE entities SET description = ?, notes = ?, manufacturer = ?, model_number = ?, serial_number = ?,
         quantity = ?, purchase_price = ?, sold_price = ?, archived = ?, insured = ?, lifetime_warranty = ?,
         purchase_date = ?, warranty_expires = ?, sold_date = ?, purchase_from = ?, warranty_details = ?,
         sold_to = ?, sold_notes = ?, asset_id = ?, import_ref = ?, entity_children = ?, updated_at = ?
       WHERE id = ? OR id = ?`,
      [
        cell(row, index, "HB.description") || null,
        cell(row, index, "HB.notes") || null,
        cell(row, index, "HB.manufacturer") || null,
        cell(row, index, "HB.model_number") || null,
        cell(row, index, "HB.serial_number") || null,
        Number(cell(row, index, "HB.quantity") || 1),
        Number(cell(row, index, "HB.purchase_price") || 0),
        Number(cell(row, index, "HB.sold_price") || 0),
        parseBool(cell(row, index, "HB.archived")),
        parseBool(cell(row, index, "HB.insured")),
        parseBool(cell(row, index, "HB.lifetime_warranty")),
        cell(row, index, "HB.purchase_date") || null,
        cell(row, index, "HB.warranty_expires") || null,
        cell(row, index, "HB.sold_date") || null,
        cell(row, index, "HB.purchase_from") || null,
        cell(row, index, "HB.warranty_details") || null,
        cell(row, index, "HB.sold_to") || null,
        cell(row, index, "HB.sold_notes") || null,
        parseAsset(cell(row, index, "HB.asset_id")),
        importRef || null,
        parentId ? uuidToBytes(parentId) : null,
        sqliteNow(),
        idBytes,
        idText,
      ],
    );
    if (customHeaders.some((custom) => (row[custom.i] ?? "") !== "")) {
      db.run(`DELETE FROM entity_fields WHERE entity_fields = ? OR entity_fields = ?`, [idBytes, idText]);
    }
    for (const custom of customHeaders) {
      const value = row[custom.i] ?? "";
      if (!value) continue;
      insertEntityField(db, {
        name: custom.header.slice("HB.field.".length),
        entityId,
        type: "text",
        textValue: value,
        timeValue: sqliteNow(),
      });
    }
  }
  void bytesToUuid;
  return count;
}
