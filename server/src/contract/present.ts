import type { Database } from "bun:sqlite";

import { getAttachmentForGroup, listAttachmentsForEntity, type AttachmentRow } from "../auth/tenancy.ts";
import { getEntityById, getTagById, listEntities, listTags, type EntityRow, type TagRow } from "../db/inventory.ts";
import { idPair, readUuid } from "./ids.ts";

export function formatAssetId(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const padded = String(Math.trunc(value)).padStart(6, "0");
  return `${padded.slice(0, 3)}-${padded.slice(3)}`;
}

function text(value: string | null | undefined): string {
  return value ?? "";
}

function bool(value: number): boolean {
  return value === 1;
}

type TypeRow = {
  id: string;
  name: string;
  description: string;
  icon: string;
  isLocation: boolean;
  createdAt: string;
  updatedAt: string;
  defaultTemplateId: string;
};

function loadType(db: Database, id: string | null, groupId?: string): TypeRow | null {
  if (!id) return null;
  const [bytes, textId] = idPair(id);
  const row = db
    .query(
      `SELECT id, name, description, icon, is_location, created_at, updated_at, entity_type_default_template, group_entity_types
       FROM entity_types WHERE id = ? OR id = ?`,
    )
    .get(bytes, textId) as
    | {
        id: unknown;
        name: string;
        description: string | null;
        icon: string | null;
        is_location: number;
        created_at: string;
        updated_at: string;
        entity_type_default_template: unknown;
        group_entity_types: unknown;
      }
    | null;
  if (!row) return null;
  if (groupId && readUuid(row.group_entity_types) !== groupId) return null;
  return {
    id: readUuid(row.id) ?? id,
    name: row.name,
    description: text(row.description),
    icon: text(row.icon),
    isLocation: bool(row.is_location),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    defaultTemplateId: readUuid(row.entity_type_default_template) ?? "",
  };
}

function typeSummary(type: TypeRow | null) {
  if (!type) return null;
  return {
    id: type.id,
    name: type.name,
    description: type.description,
    icon: type.icon,
    isLocation: type.isLocation,
    createdAt: type.createdAt,
    updatedAt: type.updatedAt,
    defaultTemplateId: type.defaultTemplateId,
    defaultTemplate: emptyTemplateSummary(),
  };
}

function emptyTemplateSummary() {
  return { id: "", name: "", description: "", createdAt: "", updatedAt: "" };
}

function tagsFor(db: Database, entityId: string, groupId: string): TagRow[] {
  const [bytes, textId] = idPair(entityId);
  const rows = db
    .query(`SELECT tag_id FROM tag_entities WHERE entity_id = ? OR entity_id = ?`)
    .all(bytes, textId) as Array<{ tag_id: unknown }>;
  const tags: TagRow[] = [];
  for (const row of rows) {
    const id = readUuid(row.tag_id);
    if (!id) continue;
    const tag = db.query(`SELECT id FROM tags WHERE id = ? OR id = ?`).get(...idPair(id));
    if (!tag) continue;
    const loaded = loadTag(db, id);
    if (loaded && loaded.groupId === groupId) tags.push(loaded);
  }
  return tags;
}

function loadTag(db: Database, id: string): TagRow | null {
  const [bytes, textId] = idPair(id);
  const row = db
    .query(
      `SELECT id, name, description, color, icon, group_tags, tag_children, created_at, updated_at
       FROM tags WHERE id = ? OR id = ?`,
    )
    .get(bytes, textId) as
    | {
        id: unknown;
        name: string;
        description: string | null;
        color: string | null;
        icon: string | null;
        group_tags: unknown;
        tag_children: unknown;
        created_at: string;
        updated_at: string;
      }
    | null;
  if (!row) return null;
  return {
    id: readUuid(row.id) ?? id,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    groupId: readUuid(row.group_tags) ?? "",
    parentId: readUuid(row.tag_children),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function presentTag(db: Database, tag: TagRow) {
  const children = listTags(db, { groupId: tag.groupId }).filter((row) => row.parentId === tag.id);
  const parent = tag.parentId ? getTagById(db, tag.groupId, tag.parentId) : null;
  return {
    id: tag.id,
    name: tag.name,
    description: text(tag.description),
    color: text(tag.color),
    icon: text(tag.icon),
    parentId: tag.parentId,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
    parent: parent ? tagSummary(parent) : null,
    children: children.map(tagSummary),
  };
}

function tagSummary(tag: TagRow) {
  return {
    id: tag.id,
    name: tag.name,
    description: text(tag.description),
    color: text(tag.color),
    icon: text(tag.icon),
    parentId: tag.parentId,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  };
}

function fieldsFor(db: Database, entityId: string) {
  const [bytes, textId] = idPair(entityId);
  const rows = db
    .query(
      `SELECT id, name, type, text_value, number_value, boolean_value
       FROM entity_fields WHERE entity_fields = ? OR entity_fields = ?`,
    )
    .all(bytes, textId) as Array<{
    id: unknown;
    name: string;
    type: string;
    text_value: string | null;
    number_value: number | null;
    boolean_value: number;
  }>;
  return rows.map((row) => ({
    id: readUuid(row.id) ?? "",
    name: row.name,
    type: row.type,
    textValue: text(row.text_value),
    numberValue: row.number_value ?? 0,
    booleanValue: bool(row.boolean_value),
  }));
}

function attachmentOut(row: AttachmentRow, thumbnail: AttachmentRow | null) {
  return {
    id: row.id,
    type: row.type,
    primary: row.primary === 1,
    path: row.path,
    title: row.title,
    mimeType: row.mimeType,
    createdAt: "",
    updatedAt: "",
    thumbnail: thumbnail
      ? { id: thumbnail.id, path: thumbnail.path, title: thumbnail.title, mimeType: thumbnail.mimeType }
      : null,
  };
}

function attachmentsFor(db: Database, groupId: string, entityId: string) {
  let rows: AttachmentRow[] = [];
  try {
    rows = listAttachmentsForEntity(db, groupId, entityId);
  } catch {
    rows = [];
  }
  return rows.map((row) => {
    const [bytes, textId] = idPair(row.id);
    const thumb = db
      .query(`SELECT attachment_thumbnail FROM attachments WHERE id = ? OR id = ?`)
      .get(bytes, textId) as { attachment_thumbnail: unknown } | null;
    const thumbId = readUuid(thumb?.attachment_thumbnail);
    // Generated thumbnails are detached rows (entity_attachments is null).
    // They are not in the entity's attachment list, so look them up by id.
    const thumbnail = thumbId
      ? rows.find((item) => item.id === thumbId) ?? getAttachmentForGroup(db, groupId, thumbId)
      : null;
    return attachmentOut(row, thumbnail);
  });
}

function summaryFrom(db: Database, row: EntityRow, tags: TagRow[]) {
  const type = loadType(db, row.entityTypeId, row.groupId);
  const parent = row.parentId ? getEntityById(db, row.groupId, row.parentId) : null;
  return {
    id: row.id,
    name: row.name,
    description: text(row.description),
    assetId: formatAssetId(row.assetId),
    archived: bool(row.archived),
    insured: bool(row.insured),
    quantity: row.quantity,
    purchasePrice: row.purchasePrice,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    soldDate: text(row.soldDate),
    itemCount: 0,
    imageId: null as string | null,
    thumbnailId: null as string | null,
    parent: parent ? summaryFrom(db, parent, []) : null,
    tags: tags.map(tagSummary),
    entityType: typeSummary(type),
  };
}

export function presentSummary(db: Database, row: EntityRow) {
  const summary = summaryFrom(db, row, tagsFor(db, row.id, row.groupId));
  const photos = attachmentsFor(db, row.groupId, row.id).filter((item) => item.type === "photo");
  const primary = photos.find((item) => item.primary) ?? photos[0];
  summary.imageId = primary?.id ?? null;
  summary.thumbnailId = primary?.thumbnail?.id ?? null;
  if (row.isLocation) {
    const children = listEntities(db, { groupId: row.groupId, isLocation: false }).filter((child) => child.parentId === row.id);
    summary.itemCount = children.reduce((sum, child) => sum + child.quantity, 0);
  }
  return summary;
}

export function presentEntity(db: Database, groupId: string, id: string) {
  const row = getEntityById(db, groupId, id);
  if (!row) return null;
  const summary = presentSummary(db, row);
  const extra = extraPurchase(db, row.id);
  const parent = row.parentId ? getEntityById(db, groupId, row.parentId) : null;
  let location = parent && parent.isLocation ? presentSummary(db, parent) : null;
  if (parent && !parent.isLocation) {
    let cursor: EntityRow | null = parent;
    while (cursor?.parentId) {
      const next = getEntityById(db, groupId, cursor.parentId);
      if (!next) break;
      if (next.isLocation) {
        location = presentSummary(db, next);
        break;
      }
      cursor = next;
    }
  }
  const children = row.isLocation
    ? listEntities(db, { groupId }).filter((child) => child.parentId === row.id).map((child) => presentSummary(db, child))
    : [];
  return {
    ...summary,
    notes: text(row.notes),
    manufacturer: text(row.manufacturer),
    modelNumber: text(row.modelNumber),
    serialNumber: text(row.serialNumber),
    lifetimeWarranty: bool(row.lifetimeWarranty),
    warrantyExpires: text(row.warrantyExpires),
    warrantyDetails: text(extra?.warranty_details),
    purchaseDate: text(row.purchaseDate),
    purchaseFrom: text(extra?.purchase_from),
    soldPrice: row.soldPrice,
    soldTo: text(extra?.sold_to),
    soldNotes: text(extra?.sold_notes),
    syncChildEntityLocations: bool(row.syncChildEntityLocations),
    totalPrice: row.purchasePrice * row.quantity,
    location,
    children,
    fields: fieldsFor(db, row.id),
    attachments: attachmentsFor(db, groupId, row.id).filter((item) => item.type !== "thumbnail"),
  };
}

export function warrantyDetails(db: Database, id: string): string {
  const [bytes, textId] = idPair(id);
  const row = db.query(`SELECT warranty_details, purchase_from, sold_to, sold_notes FROM entities WHERE id = ? OR id = ?`).get(bytes, textId) as
    | { warranty_details: string | null; purchase_from: string | null; sold_to: string | null; sold_notes: string | null }
    | null;
  return text(row?.warranty_details);
}

export function extraPurchase(db: Database, id: string) {
  const [bytes, textId] = idPair(id);
  return db.query(`SELECT warranty_details, purchase_from, sold_to, sold_notes, import_ref FROM entities WHERE id = ? OR id = ?`).get(bytes, textId) as
    | {
        warranty_details: string | null;
        purchase_from: string | null;
        sold_to: string | null;
        sold_notes: string | null;
        import_ref: string | null;
      }
    | null;
}
