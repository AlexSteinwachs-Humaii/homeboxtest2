import { and, eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { Database } from "bun:sqlite";
import type { AnyColumn } from "drizzle-orm";

import {
  entities,
  entityFields,
  entityTypes,
  groups,
  maintenanceEntries,
  schema,
  tagEntities,
  tags,
  userGroups,
  users,
} from "./schema.ts";
import { bytesToUuid, canonicalUuid, isUuidText, newUuidBytes, sqliteNow, uuidToBytes } from "./storage.ts";

export type EntityRow = {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
  quantity: number;
  insured: number;
  archived: number;
  assetId: number;
  syncChildEntityLocations: number;
  lifetimeWarranty: number;
  createdAt: string;
  updatedAt: string;
  warrantyExpires: string | null;
  purchaseDate: string | null;
  soldDate: string | null;
  purchasePrice: number;
  soldPrice: number;
  serialNumber: string | null;
  modelNumber: string | null;
  manufacturer: string | null;
  parentId: string | null;
  entityTypeId: string;
  groupId: string;
  isLocation: number;
};

export type TagRow = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  groupId: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EntityFieldRow = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  textValue: string | null;
  numberValue: number | null;
  booleanValue: number;
  timeValue: string;
  entityId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaintenanceRow = {
  id: string;
  name: string;
  description: string | null;
  cost: number;
  date: string | null;
  scheduledDate: string | null;
  entityId: string;
  createdAt: string;
  updatedAt: string;
};

export type EntityFilter = {
  groupId: string;
  isLocation?: boolean;
};

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// Authenticated queries must name a group. A missing or nil id is refused
// rather than falling through to an unscoped read.
export function requireGroupId(groupId: string | null | undefined): string {
  if (!groupId || !isUuidText(groupId)) {
    throw new Error("refusing a query that is not scoped by an authenticated group id");
  }
  const canonical = canonicalUuid(groupId);
  if (canonical === NIL_UUID) {
    throw new Error("refusing a query that is not scoped by an authenticated group id");
  }
  return canonical;
}

type Orm = ReturnType<typeof drizzle<typeof schema>>;

function orm(db: Database): Orm {
  return drizzle(db, { schema });
}

// Match a blob id or a text id already stored by Ent's uuid.Value() without
// rewriting the column. Parameters are bound, not interpolated.
function uuidEquals(column: AnyColumn, id: string) {
  const bytes = uuidToBytes(id);
  const text = bytesToUuid(bytes);
  return or(sql`${column} = ${bytes}`, sql`${column} = ${text}`);
}

function idOf(value: Uint8Array | null): string | null {
  if (!value) return null;
  return bytesToUuid(value);
}

function mapEntity(row: typeof entities.$inferSelect, isLocation: number): EntityRow {
  return {
    id: bytesToUuid(row.id),
    name: row.name,
    description: row.description,
    notes: row.notes,
    quantity: row.quantity,
    insured: row.insured,
    archived: row.archived,
    assetId: row.assetId,
    syncChildEntityLocations: row.syncChildEntityLocations,
    lifetimeWarranty: row.lifetimeWarranty,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    warrantyExpires: row.warrantyExpires,
    purchaseDate: row.purchaseDate,
    soldDate: row.soldDate,
    purchasePrice: row.purchasePrice,
    soldPrice: row.soldPrice,
    serialNumber: row.serialNumber,
    modelNumber: row.modelNumber,
    manufacturer: row.manufacturer,
    parentId: idOf(row.entityChildren),
    entityTypeId: bytesToUuid(row.entityTypeEntities),
    groupId: bytesToUuid(row.groupEntities),
    isLocation,
  };
}

function mapTag(row: typeof tags.$inferSelect): TagRow {
  return {
    id: bytesToUuid(row.id),
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    groupId: bytesToUuid(row.groupTags),
    parentId: idOf(row.tagChildren),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapField(row: typeof entityFields.$inferSelect): EntityFieldRow {
  return {
    id: bytesToUuid(row.id),
    name: row.name,
    description: row.description,
    type: row.type,
    textValue: row.textValue,
    numberValue: row.numberValue,
    booleanValue: row.booleanValue,
    timeValue: row.timeValue,
    entityId: idOf(row.entityFields),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMaintenance(row: typeof maintenanceEntries.$inferSelect): MaintenanceRow {
  return {
    id: bytesToUuid(row.id),
    name: row.name,
    description: row.description,
    cost: row.cost,
    date: row.date,
    scheduledDate: row.scheduledDate,
    entityId: bytesToUuid(row.entityId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function getEntityById(db: Database, groupId: string, id: string): EntityRow | null {
  const gid = requireGroupId(groupId);
  const row = orm(db)
    .select({ entity: entities, isLocation: entityTypes.isLocation })
    .from(entities)
    .innerJoin(entityTypes, eq(entities.entityTypeEntities, entityTypes.id))
    .where(and(uuidEquals(entities.id, id), uuidEquals(entities.groupEntities, gid)))
    .get();
  if (!row) return null;
  return mapEntity(row.entity, row.isLocation);
}

export function listEntities(db: Database, filter: EntityFilter): EntityRow[] {
  const gid = requireGroupId(filter.groupId);
  const conditions = [uuidEquals(entities.groupEntities, gid)];
  if (filter.isLocation !== undefined) {
    conditions.push(eq(entityTypes.isLocation, filter.isLocation ? 1 : 0));
  }
  const rows = orm(db)
    .select({ entity: entities, isLocation: entityTypes.isLocation })
    .from(entities)
    .innerJoin(entityTypes, eq(entities.entityTypeEntities, entityTypes.id))
    .where(and(...conditions))
    .orderBy(entities.name)
    .all();
  return rows.map((row) => mapEntity(row.entity, row.isLocation));
}

export function getTagById(db: Database, groupId: string, id: string): TagRow | null {
  const gid = requireGroupId(groupId);
  const row = orm(db)
    .select()
    .from(tags)
    .where(and(uuidEquals(tags.id, id), uuidEquals(tags.groupTags, gid)))
    .get();
  return row ? mapTag(row) : null;
}

export function listTags(db: Database, filter: { groupId: string }): TagRow[] {
  const gid = requireGroupId(filter.groupId);
  const rows = orm(db).select().from(tags).where(uuidEquals(tags.groupTags, gid)).orderBy(tags.name).all();
  return rows.map(mapTag);
}

export function getEntityFieldById(db: Database, groupId: string, id: string): EntityFieldRow | null {
  const gid = requireGroupId(groupId);
  const row = orm(db)
    .select({ field: entityFields })
    .from(entityFields)
    .innerJoin(entities, eq(entityFields.entityFields, entities.id))
    .where(and(uuidEquals(entityFields.id, id), uuidEquals(entities.groupEntities, gid)))
    .get();
  return row ? mapField(row.field) : null;
}

export function listEntityFields(db: Database, filter: { groupId: string; entityId?: string }): EntityFieldRow[] {
  const gid = requireGroupId(filter.groupId);
  const conditions = [uuidEquals(entities.groupEntities, gid)];
  if (filter.entityId) conditions.push(uuidEquals(entityFields.entityFields, filter.entityId));
  const rows = orm(db)
    .select({ field: entityFields })
    .from(entityFields)
    .innerJoin(entities, eq(entityFields.entityFields, entities.id))
    .where(and(...conditions))
    .orderBy(entityFields.name)
    .all();
  return rows.map((row) => mapField(row.field));
}

export function getMaintenanceEntryById(db: Database, groupId: string, id: string): MaintenanceRow | null {
  const gid = requireGroupId(groupId);
  const row = orm(db)
    .select({ entry: maintenanceEntries })
    .from(maintenanceEntries)
    .innerJoin(entities, eq(maintenanceEntries.entityId, entities.id))
    .where(and(uuidEquals(maintenanceEntries.id, id), uuidEquals(entities.groupEntities, gid)))
    .get();
  return row ? mapMaintenance(row.entry) : null;
}

export function listMaintenanceEntries(db: Database, filter: { groupId: string; entityId?: string }): MaintenanceRow[] {
  const gid = requireGroupId(filter.groupId);
  const conditions = [uuidEquals(entities.groupEntities, gid)];
  if (filter.entityId) conditions.push(uuidEquals(maintenanceEntries.entityId, filter.entityId));
  const rows = orm(db)
    .select({ entry: maintenanceEntries })
    .from(maintenanceEntries)
    .innerJoin(entities, eq(maintenanceEntries.entityId, entities.id))
    .where(and(...conditions))
    .orderBy(maintenanceEntries.name)
    .all();
  return rows.map((row) => mapMaintenance(row.entry));
}

export function listTagIdsForEntity(db: Database, groupId: string, entityId: string): string[] {
  const gid = requireGroupId(groupId);
  const owned = getEntityById(db, gid, entityId);
  if (!owned) return [];
  const rows = orm(db).select().from(tagEntities).where(uuidEquals(tagEntities.entityId, entityId)).all();
  return rows.map((row) => bytesToUuid(row.tagId));
}

function freshId(id?: string): { bytes: Uint8Array; text: string } {
  const bytes = id ? uuidToBytes(id) : newUuidBytes();
  return { bytes, text: bytesToUuid(bytes) };
}

export function insertGroup(
  db: Database,
  input: { id?: string; name: string; currency?: string; createdAt?: string; updatedAt?: string },
): string {
  const id = freshId(input.id);
  const createdAt = input.createdAt ?? sqliteNow();
  orm(db)
    .insert(groups)
    .values({
      id: id.bytes,
      name: input.name,
      currency: input.currency ?? "usd",
      createdAt,
      updatedAt: input.updatedAt ?? createdAt,
    })
    .run();
  return id.text;
}

export function insertUser(
  db: Database,
  input: {
    id?: string;
    name: string;
    email: string;
    groupId?: string;
    createdAt?: string;
    isSuperuser?: number;
    superuser?: number;
  },
): string {
  const id = freshId(input.id);
  const createdAt = input.createdAt ?? sqliteNow();
  orm(db)
    .insert(users)
    .values({
      id: id.bytes,
      name: input.name,
      email: input.email,
      password: null,
      isSuperuser: input.isSuperuser ?? 0,
      superuser: input.superuser ?? 0,
      activatedOn: null,
      oidcIssuer: null,
      oidcSubject: null,
      defaultGroupId: input.groupId ? uuidToBytes(input.groupId) : null,
      settings: null,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
  if (input.groupId) {
    orm(db)
      .insert(userGroups)
      .values({ userId: id.bytes, groupId: uuidToBytes(input.groupId), role: "owner" })
      .run();
  }
  return id.text;
}

export function insertEntityType(
  db: Database,
  input: {
    id?: string;
    name: string;
    groupId: string;
    isLocation: number;
    createdAt?: string;
    description?: string | null;
  },
): string {
  const id = freshId(input.id);
  const createdAt = input.createdAt ?? sqliteNow();
  orm(db)
    .insert(entityTypes)
    .values({
      id: id.bytes,
      name: input.name,
      description: input.description ?? null,
      isLocation: input.isLocation,
      icon: null,
      groupEntityTypes: uuidToBytes(input.groupId),
      entityTypeDefaultTemplate: null,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
  return id.text;
}

export type InsertEntity = {
  id?: string;
  name: string;
  groupId: string;
  entityTypeId: string;
  parentId?: string | null;
  description?: string | null;
  notes?: string | null;
  quantity?: number;
  insured?: number;
  archived?: number;
  assetId?: number;
  syncChildEntityLocations?: number;
  lifetimeWarranty?: number;
  createdAt?: string;
  updatedAt?: string;
  warrantyExpires?: string | null;
  purchaseDate?: string | null;
  soldDate?: string | null;
  purchasePrice?: number;
  soldPrice?: number;
  serialNumber?: string | null;
  modelNumber?: string | null;
  manufacturer?: string | null;
};

export function insertEntity(db: Database, input: InsertEntity): string {
  const id = freshId(input.id);
  const createdAt = input.createdAt ?? sqliteNow();
  orm(db)
    .insert(entities)
    .values({
      id: id.bytes,
      name: input.name,
      description: input.description ?? null,
      importRef: null,
      notes: input.notes ?? null,
      quantity: input.quantity ?? 1,
      insured: input.insured ?? 0,
      archived: input.archived ?? 0,
      assetId: input.assetId ?? 0,
      syncChildEntityLocations: input.syncChildEntityLocations ?? 0,
      serialNumber: input.serialNumber ?? null,
      modelNumber: input.modelNumber ?? null,
      manufacturer: input.manufacturer ?? null,
      lifetimeWarranty: input.lifetimeWarranty ?? 0,
      warrantyExpires: input.warrantyExpires ?? null,
      warrantyDetails: null,
      purchaseDate: input.purchaseDate ?? null,
      purchaseFrom: null,
      purchasePrice: input.purchasePrice ?? 0,
      soldDate: input.soldDate ?? null,
      soldTo: null,
      soldPrice: input.soldPrice ?? 0,
      soldNotes: null,
      groupEntities: uuidToBytes(input.groupId),
      entityTypeEntities: uuidToBytes(input.entityTypeId),
      entityChildren: input.parentId ? uuidToBytes(input.parentId) : null,
      createdAt,
      updatedAt: input.updatedAt ?? createdAt,
    })
    .run();
  return id.text;
}

export function insertTag(
  db: Database,
  input: {
    id?: string;
    name: string;
    groupId: string;
    parentId?: string | null;
    color?: string | null;
    description?: string | null;
    createdAt?: string;
  },
): string {
  const id = freshId(input.id);
  const createdAt = input.createdAt ?? sqliteNow();
  orm(db)
    .insert(tags)
    .values({
      id: id.bytes,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      icon: null,
      groupTags: uuidToBytes(input.groupId),
      tagChildren: input.parentId ? uuidToBytes(input.parentId) : null,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
  return id.text;
}

export function insertTagLink(db: Database, tagId: string, entityId: string): void {
  orm(db)
    .insert(tagEntities)
    .values({ tagId: uuidToBytes(tagId), entityId: uuidToBytes(entityId) })
    .run();
}

export function insertEntityField(
  db: Database,
  input: {
    id?: string;
    name: string;
    entityId: string;
    type: string;
    textValue?: string | null;
    numberValue?: number | null;
    booleanValue?: number;
    timeValue: string;
    createdAt?: string;
  },
): string {
  const id = freshId(input.id);
  const createdAt = input.createdAt ?? sqliteNow();
  orm(db)
    .insert(entityFields)
    .values({
      id: id.bytes,
      name: input.name,
      description: null,
      type: input.type,
      textValue: input.textValue ?? null,
      numberValue: input.numberValue ?? null,
      booleanValue: input.booleanValue ?? 0,
      timeValue: input.timeValue,
      entityFields: uuidToBytes(input.entityId),
      createdAt,
      updatedAt: createdAt,
    })
    .run();
  return id.text;
}

export function insertMaintenanceEntry(
  db: Database,
  input: {
    id?: string;
    name: string;
    entityId: string;
    description?: string | null;
    cost?: number;
    date?: string | null;
    scheduledDate?: string | null;
    createdAt?: string;
  },
): string {
  const id = freshId(input.id);
  const createdAt = input.createdAt ?? sqliteNow();
  orm(db)
    .insert(maintenanceEntries)
    .values({
      id: id.bytes,
      name: input.name,
      description: input.description ?? null,
      cost: input.cost ?? 0,
      date: input.date ?? null,
      scheduledDate: input.scheduledDate ?? null,
      entityId: uuidToBytes(input.entityId),
      createdAt,
      updatedAt: createdAt,
    })
    .run();
  return id.text;
}

// Changes a non-id column only, and only inside the group. The id column is not in the SET.
export function updateEntityName(db: Database, groupId: string, id: string, name: string): boolean {
  const gid = requireGroupId(groupId);
  const result = orm(db)
    .update(entities)
    .set({ name })
    .where(and(uuidEquals(entities.id, id), uuidEquals(entities.groupEntities, gid)))
    .run();
  return result.changes > 0;
}

export function updateTagName(db: Database, groupId: string, id: string, name: string): boolean {
  const gid = requireGroupId(groupId);
  const result = orm(db)
    .update(tags)
    .set({ name })
    .where(and(uuidEquals(tags.id, id), uuidEquals(tags.groupTags, gid)))
    .run();
  return result.changes > 0;
}
