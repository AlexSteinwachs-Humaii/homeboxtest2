import type { Database } from "bun:sqlite";

import {
  assertEntityInGroup,
  assertEntityTypeInGroup,
  assertTagsInGroup,
  getEntityForGroup,
  getTagForGroup,
  notFound,
  TenancyError,
} from "../auth/tenancy.ts";
import { publishEntityMutation, publishTagMutation } from "../events/bus.ts";
import { newUuidBytes, sqliteNow, uuidToBytes } from "../db/storage.ts";
import { idPair, isUuid } from "./ids.ts";

const FIELD_TYPES = new Set(["text", "number", "boolean", "time"]);

export function parseAssetId(value: unknown): number {
  if (value == null || value === "") return 0;
  const digits = String(value).replace(/["\s-]/g, "");
  if (!/^\d+$/.test(digits)) throw new TenancyError("invalid assetId", 400);
  const parsed = Number(digits);
  if (!Number.isSafeInteger(parsed)) throw new TenancyError("invalid assetId", 400);
  return parsed;
}

function optionalUuid(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !isUuid(value)) throw notFound();
  return value;
}

function finiteQuantity(value: unknown, op: string): number {
  const quantity = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(quantity)) throw new TenancyError(`${op}: invalid quantity: must be a finite number`, 400);
  if (quantity < 0) throw new TenancyError(`${op}: invalid quantity: must not be negative`, 400);
  return quantity;
}

// PATCH applies only the fields that were sent. References are checked before
// any write, so a foreign parent, type, or tag leaves the row unchanged.
export function patchEntityForGroup(
  db: Database,
  groupId: string,
  id: string,
  body: Record<string, unknown>,
): void {
  const current = getEntityForGroup(db, groupId, id);
  if (!current) throw notFound();
  const parentId = "parentId" in body ? optionalUuid(body.parentId) : undefined;
  const entityTypeId = "entityTypeId" in body ? optionalUuid(body.entityTypeId) : undefined;
  const tagIds = Array.isArray(body.tagIds) ? body.tagIds.map(String) : undefined;
  if (parentId) assertEntityInGroup(db, groupId, parentId);
  if (entityTypeId) assertEntityTypeInGroup(db, groupId, entityTypeId);
  if (tagIds) assertTagsInGroup(db, groupId, tagIds);
  const quantity = "quantity" in body ? finiteQuantity(body.quantity, "patch entity") : undefined;
  const name = typeof body.name === "string" ? body.name : undefined;

  const [idBytes, idText] = idPair(id);
  const [gidBytes, gidText] = idPair(groupId);
  db.transaction(() => {
    if (name !== undefined || quantity !== undefined || parentId !== undefined || entityTypeId !== undefined) {
      db.run(
        `UPDATE entities SET
           name = COALESCE(?, name),
           quantity = COALESCE(?, quantity),
           entity_children = CASE WHEN ? THEN entity_children ELSE ? END,
           entity_type_entities = COALESCE(?, entity_type_entities),
           updated_at = ?
         WHERE (id = ? OR id = ?) AND (group_entities = ? OR group_entities = ?)`,
        [
          name ?? null,
          quantity ?? null,
          parentId === undefined ? 1 : 0,
          parentId ? uuidToBytes(parentId) : null,
          entityTypeId ? uuidToBytes(entityTypeId) : null,
          sqliteNow(),
          idBytes,
          idText,
          gidBytes,
          gidText,
        ],
      );
    }
    if (tagIds) replaceTagLinks(db, id, tagIds);
  })();
  publishEntityMutation(groupId);
}

// PUT replaces the editable entity contract. Foreign references are rejected
// before the transaction, so a mixed valid-name / invalid-reference body
// changes nothing and does not return the other group's names.
export function replaceEntityForGroup(
  db: Database,
  groupId: string,
  id: string,
  body: Record<string, unknown>,
): void {
  const current = getEntityForGroup(db, groupId, id);
  if (!current) throw notFound();
  const name = typeof body.name === "string" ? body.name : current.name;
  if (!name.trim()) throw new TenancyError("name is required", 400);
  const quantity = "quantity" in body ? finiteQuantity(body.quantity, "update entity") : current.quantity;
  const parentId = "parentId" in body ? optionalUuid(body.parentId) : current.parentId;
  const entityTypeId = "entityTypeId" in body ? optionalUuid(body.entityTypeId) ?? current.entityTypeId : current.entityTypeId;
  const tagIds = Array.isArray(body.tagIds) ? body.tagIds.map(String) : null;
  const assetId = "assetId" in body ? parseAssetId(body.assetId) : null;
  const fields = Array.isArray(body.fields) ? body.fields : null;

  if (parentId) assertEntityInGroup(db, groupId, parentId);
  if (entityTypeId) assertEntityTypeInGroup(db, groupId, entityTypeId);
  if (tagIds) assertTagsInGroup(db, groupId, tagIds);
  if (fields) validateFields(fields);

  const [idBytes, idText] = idPair(id);
  const [gidBytes, gidText] = idPair(groupId);
  const stored = db
    .query(`SELECT purchase_from, warranty_details, sold_to, sold_notes FROM entities WHERE id = ? OR id = ?`)
    .get(idBytes, idText) as {
    purchase_from: string | null;
    warranty_details: string | null;
    sold_to: string | null;
    sold_notes: string | null;
  } | null;
  const textOr = (key: string, fallback: string | null) => (key in body ? String(body[key] ?? "") : fallback);
  const flag = (key: string, fallback: number) => (key in body ? (body[key] ? 1 : 0) : fallback);
  const num = (key: string, fallback: number) => (key in body ? Number(body[key] ?? 0) : fallback);
  const dateOr = (key: string, fallback: string | null) => {
    if (!(key in body)) return fallback;
    const value = body[key];
    if (value == null || value === "") return null;
    return String(value);
  };

  db.transaction(() => {
    const result = db.run(
      `UPDATE entities SET name = ?, description = ?, notes = ?, quantity = ?, insured = ?, archived = ?,
         lifetime_warranty = ?, manufacturer = ?, model_number = ?, serial_number = ?,
         purchase_price = ?, sold_price = ?, purchase_from = ?, purchase_date = ?, warranty_expires = ?,
         warranty_details = ?, sold_date = ?, sold_to = ?, sold_notes = ?, sync_child_entity_locations = ?,
         asset_id = COALESCE(?, asset_id),
         entity_type_entities = ?, entity_children = ?, updated_at = ?
       WHERE (id = ? OR id = ?) AND (group_entities = ? OR group_entities = ?)`,
      [
        name,
        textOr("description", current.description),
        textOr("notes", current.notes),
        quantity,
        flag("insured", current.insured),
        flag("archived", current.archived),
        flag("lifetimeWarranty", current.lifetimeWarranty),
        "manufacturer" in body ? body.manufacturer ?? null : current.manufacturer,
        "modelNumber" in body ? body.modelNumber ?? null : current.modelNumber,
        "serialNumber" in body ? body.serialNumber ?? null : current.serialNumber,
        num("purchasePrice", current.purchasePrice),
        num("soldPrice", current.soldPrice),
        "purchaseFrom" in body ? body.purchaseFrom ?? null : stored?.purchase_from ?? null,
        dateOr("purchaseDate", current.purchaseDate),
        dateOr("warrantyExpires", current.warrantyExpires),
        "warrantyDetails" in body ? body.warrantyDetails ?? null : stored?.warranty_details ?? null,
        dateOr("soldDate", current.soldDate),
        "soldTo" in body ? body.soldTo ?? null : stored?.sold_to ?? null,
        "soldNotes" in body ? body.soldNotes ?? null : stored?.sold_notes ?? null,
        flag("syncChildEntityLocations", current.syncChildEntityLocations),
        assetId,
        entityTypeId ? uuidToBytes(entityTypeId) : null,
        parentId ? uuidToBytes(parentId) : null,
        sqliteNow(),
        idBytes,
        idText,
        gidBytes,
        gidText,
      ],
    );
    if (result.changes === 0) throw notFound();
    if (tagIds) replaceTagLinks(db, id, tagIds);
    if (fields) syncFields(db, id, fields);
  })();
  publishEntityMutation(groupId);
}

export function updateTagForGroup(
  db: Database,
  groupId: string,
  id: string,
  body: Record<string, unknown>,
): void {
  const current = getTagForGroup(db, groupId, id);
  if (!current) throw notFound();
  const name = typeof body.name === "string" ? body.name : current.name;
  if (!name.trim()) throw new TenancyError("name is required", 400);
  const parentId = "parentId" in body ? optionalUuid(body.parentId) : current.parentId;
  if (parentId) {
    assertTagsInGroup(db, groupId, [parentId]);
    if (parentId === id || tagReaches(db, parentId, id)) throw new TenancyError("cycle detected", 400);
  }
  const description = "description" in body ? String(body.description ?? "") : current.description;
  const color = "color" in body ? String(body.color ?? "") : current.color;
  const icon = "icon" in body ? String(body.icon ?? "") : current.icon;
  const [idBytes, idText] = idPair(id);
  const [gidBytes, gidText] = idPair(groupId);
  const result = db.run(
    `UPDATE tags SET name = ?, description = ?, color = ?, icon = ?, tag_children = ?, updated_at = ?
     WHERE (id = ? OR id = ?) AND (group_tags = ? OR group_tags = ?)`,
    [
      name,
      description || null,
      color || null,
      icon || null,
      parentId ? uuidToBytes(parentId) : null,
      sqliteNow(),
      idBytes,
      idText,
      gidBytes,
      gidText,
    ],
  );
  if (result.changes === 0) throw notFound();
  publishTagMutation(groupId);
}

function replaceTagLinks(db: Database, entityId: string, tagIds: string[]): void {
  const [idBytes, idText] = idPair(entityId);
  db.run(`DELETE FROM tag_entities WHERE entity_id = ? OR entity_id = ?`, [idBytes, idText]);
  for (const tagId of tagIds) {
    if (!tagId || !isUuid(tagId)) continue;
    db.run(`INSERT INTO tag_entities (tag_id, entity_id) VALUES (?, ?)`, [uuidToBytes(tagId), uuidToBytes(entityId)]);
  }
}

function validateFields(fields: unknown[]): void {
  for (const raw of fields) {
    if (!raw || typeof raw !== "object") throw new TenancyError("invalid field", 400);
    const field = raw as Record<string, unknown>;
    const type = String(field.type ?? "");
    if (!FIELD_TYPES.has(type)) throw new TenancyError(`invalid field type ${type || "(missing)"}`, 400);
    if (typeof field.name !== "string" || field.name.trim() === "") throw new TenancyError("field name is required", 400);
    if (field.id != null && field.id !== "" && (typeof field.id !== "string" || !isUuid(field.id))) throw notFound();
  }
}

function syncFields(db: Database, entityId: string, fields: unknown[]): void {
  const [idBytes, idText] = idPair(entityId);
  const existing = db.query(`SELECT id FROM entity_fields WHERE entity_fields = ? OR entity_fields = ?`).all(idBytes, idText) as Array<{
    id: unknown;
  }>;
  const kept = new Set<string>();
  const now = sqliteNow();
  for (const raw of fields) {
    const field = raw as Record<string, unknown>;
    const type = String(field.type);
    const name = String(field.name);
    const textValue = field.textValue == null ? null : String(field.textValue);
    const numberValue = field.numberValue == null || field.numberValue === "" ? null : Number(field.numberValue);
    const booleanValue = field.booleanValue ? 1 : 0;
    if (typeof field.id === "string" && field.id) {
      const [fieldBytes, fieldText] = idPair(field.id);
      const updated = db.run(
        `UPDATE entity_fields SET name = ?, type = ?, text_value = ?, number_value = ?, boolean_value = ?, updated_at = ?
         WHERE (id = ? OR id = ?) AND (entity_fields = ? OR entity_fields = ?)`,
        [name, type, textValue, numberValue, booleanValue, now, fieldBytes, fieldText, idBytes, idText],
      );
      if (updated.changes === 0) throw notFound();
      kept.add(field.id.toLowerCase());
      continue;
    }
    db.run(
      `INSERT INTO entity_fields (id, created_at, updated_at, name, type, text_value, number_value, boolean_value, time_value, entity_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newUuidBytes(), now, now, name, type, textValue, numberValue, booleanValue, now, uuidToBytes(entityId)],
    );
  }
  for (const row of existing) {
    const text = readExistingId(row.id);
    if (!text || kept.has(text)) continue;
    const [fieldBytes, fieldText] = idPair(text);
    db.run(`DELETE FROM entity_fields WHERE (id = ? OR id = ?) AND (entity_fields = ? OR entity_fields = ?)`, [
      fieldBytes,
      fieldText,
      idBytes,
      idText,
    ]);
  }
}

function readExistingId(value: unknown): string | null {
  if (value instanceof Uint8Array && value.byteLength === 16) {
    const hex = Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  if (typeof value === "string" && isUuid(value)) return value.toLowerCase();
  return null;
}

function tagReaches(db: Database, start: string, target: string): boolean {
  let cursor: string | null = start;
  for (let i = 0; i < 8 && cursor; i++) {
    if (cursor === target) return true;
    const row = db.query(`SELECT tag_children FROM tags WHERE id = ? OR id = ?`).get(...idPair(cursor)) as { tag_children: unknown } | null;
    if (!row?.tag_children) return false;
    cursor = readExistingId(row.tag_children);
  }
  return cursor === target;
}
