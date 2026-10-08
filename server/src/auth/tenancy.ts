import type { Database } from "bun:sqlite";

import {
  getEntityById,
  getEntityFieldById,
  getMaintenanceEntryById,
  getTagById,
  insertEntity,
  insertEntityField,
  insertMaintenanceEntry,
  insertTag,
  insertTagLink,
  listEntities,
  listEntityFields,
  listMaintenanceEntries,
  listTags,
  requireGroupId,
  updateEntityName,
  updateTagName,
  type EntityFieldRow,
  type EntityRow,
  type MaintenanceRow,
  type TagRow,
} from "../db/inventory.ts";
import {
  asUuidBytes,
  bytesToUuid,
  canonicalUuid,
  isUuidText,
  newUuidBytes,
  parseSqliteDateTime,
  sqliteNow,
  uuidToBytes,
} from "../db/storage.ts";
import { publishEntityMutation, publishTagMutation } from "../events/bus.ts";
import { generateToken, hashToken } from "./token.ts";

// Cross-tenant misses are not-found, matching repo_authz.go. A 404 does not
// confirm that the other group's row exists. Owner versus member is the
// user_groups.role column from the per-group role migration — never users.role.

export const NIL_UUID = "00000000-0000-0000-0000-000000000000";
export const NOT_GROUP_OWNER = "only the owner of this collection can perform this action";

export class TenancyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TenancyError";
  }
}

export const notFound = () => new TenancyError("Not Found", 404);
export const forbidden = (message = "Forbidden") => new TenancyError(message, 403);

export type Membership = {
  groupId: string;
  role: string;
};

export type AttachmentRow = {
  id: string;
  type: string;
  title: string;
  path: string;
  mimeType: string;
  entityId: string | null;
  primary: number;
};

export type ExportRow = {
  id: string;
  groupId: string;
  kind: string;
  status: string;
  progress: number;
  artifactPath: string | null;
  sizeBytes: number;
  error: string | null;
};

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return new Uint8Array(value);
  throw new Error("expected blob");
}

function readUuid(value: unknown): string | null {
  if (value == null) return null;
  return bytesToUuid(asUuidBytes(value));
}

function idPair(id: string): [Uint8Array, string] {
  const text = canonicalUuid(id);
  return [uuidToBytes(text), text];
}

function isNil(id: string | null | undefined): boolean {
  if (!id) return true;
  return canonicalUuid(id) === NIL_UUID;
}

function exists(db: Database, sql: string, params: unknown[]): boolean {
  const row = db.query(sql).get(...params) as { n: number } | null;
  return (row?.n ?? 0) > 0;
}

export function assertEntityInGroup(db: Database, groupId: string, id: string | null | undefined): void {
  if (isNil(id)) return;
  const gid = requireGroupId(groupId);
  const [idBytes, idText] = idPair(id!);
  const [gidBytes, gidText] = idPair(gid);
  const ok = exists(
    db,
    `SELECT COUNT(*) AS n FROM entities
     WHERE (id = ? OR id = ?) AND (group_entities = ? OR group_entities = ?)`,
    [idBytes, idText, gidBytes, gidText],
  );
  if (!ok) throw notFound();
}

export function assertEntityTypeInGroup(db: Database, groupId: string, id: string | null | undefined): void {
  if (isNil(id)) return;
  const gid = requireGroupId(groupId);
  const [idBytes, idText] = idPair(id!);
  const [gidBytes, gidText] = idPair(gid);
  const ok = exists(
    db,
    `SELECT COUNT(*) AS n FROM entity_types
     WHERE (id = ? OR id = ?) AND (group_entity_types = ? OR group_entity_types = ?)`,
    [idBytes, idText, gidBytes, gidText],
  );
  if (!ok) throw notFound();
}

export function assertEntityTemplateInGroup(db: Database, groupId: string, id: string | null | undefined): void {
  if (isNil(id)) return;
  const gid = requireGroupId(groupId);
  const [idBytes, idText] = idPair(id!);
  const [gidBytes, gidText] = idPair(gid);
  const ok = exists(
    db,
    `SELECT COUNT(*) AS n FROM entity_templates
     WHERE (id = ? OR id = ?) AND (group_entity_templates = ? OR group_entity_templates = ?)`,
    [idBytes, idText, gidBytes, gidText],
  );
  if (!ok) throw notFound();
}

export function assertTagsInGroup(db: Database, groupId: string, ids: Array<string | null | undefined>): void {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (isNil(id)) continue;
    const text = canonicalUuid(id!);
    if (seen.has(text)) continue;
    seen.add(text);
    cleaned.push(text);
  }
  if (cleaned.length === 0) return;
  const gid = requireGroupId(groupId);
  const [gidBytes, gidText] = idPair(gid);
  const clauses = cleaned.map(() => "(id = ? OR id = ?)").join(" OR ");
  const params: unknown[] = [gidBytes, gidText];
  for (const id of cleaned) {
    const [bytes, text] = idPair(id);
    params.push(bytes, text);
  }
  const row = db
    .query(
      `SELECT COUNT(*) AS n FROM tags
       WHERE (group_tags = ? OR group_tags = ?) AND (${clauses})`,
    )
    .get(...params) as { n: number };
  if (row.n !== cleaned.length) throw notFound();
}

export function getEntityForGroup(db: Database, groupId: string, id: string): EntityRow | null {
  if (!isUuidText(id)) return null;
  return getEntityById(db, requireGroupId(groupId), id);
}

export function getTagForGroup(db: Database, groupId: string, id: string): TagRow | null {
  if (!isUuidText(id)) return null;
  return getTagById(db, requireGroupId(groupId), id);
}

export function getFieldForGroup(db: Database, groupId: string, id: string): EntityFieldRow | null {
  if (!isUuidText(id)) return null;
  return getEntityFieldById(db, requireGroupId(groupId), id);
}

export function getMaintenanceForGroup(db: Database, groupId: string, id: string): MaintenanceRow | null {
  if (!isUuidText(id)) return null;
  return getMaintenanceEntryById(db, requireGroupId(groupId), id);
}

export function listEntitiesForGroup(db: Database, groupId: string, isLocation?: boolean): EntityRow[] {
  return listEntities(db, { groupId: requireGroupId(groupId), isLocation });
}

export function listTagsForGroup(db: Database, groupId: string): TagRow[] {
  return listTags(db, { groupId: requireGroupId(groupId) });
}

export function listFieldsForGroup(db: Database, groupId: string, entityId?: string): EntityFieldRow[] {
  return listEntityFields(db, { groupId: requireGroupId(groupId), entityId });
}

export function listMaintenanceForGroup(db: Database, groupId: string, entityId?: string): MaintenanceRow[] {
  return listMaintenanceEntries(db, { groupId: requireGroupId(groupId), entityId });
}

function mapAttachment(row: {
  id: unknown;
  type: string;
  title: string;
  path: string;
  mime_type: string;
  entity_id: unknown;
  primary: number;
}): AttachmentRow {
  return {
    id: readUuid(row.id) ?? "",
    type: row.type,
    title: row.title,
    path: row.path,
    mimeType: row.mime_type,
    entityId: readUuid(row.entity_id),
    primary: row.primary,
  };
}

// Attachment bytes belong to a group only through the owning entity. A thumbnail
// row has no entity of its own; it is in the group when its parent attachment is.
const ATTACHMENT_IN_GROUP = `
  SELECT a.id, a.type, a.title, a.path, a.mime_type, a."primary" AS "primary",
         COALESCE(a.entity_attachments, parent.entity_attachments) AS entity_id
  FROM attachments a
  LEFT JOIN attachments parent ON parent.attachment_thumbnail = a.id OR parent.attachment_thumbnail = a.id
  LEFT JOIN entities e ON e.id = a.entity_attachments OR e.id = parent.entity_attachments
  WHERE (a.id = ? OR a.id = ?)
    AND (e.group_entities = ? OR e.group_entities = ?)
`;

export function getAttachmentForGroup(db: Database, groupId: string, id: string): AttachmentRow | null {
  if (!isUuidText(id)) return null;
  const gid = requireGroupId(groupId);
  const [idBytes, idText] = idPair(id);
  const [gidBytes, gidText] = idPair(gid);
  const row = db.query(ATTACHMENT_IN_GROUP).get(idBytes, idText, gidBytes, gidText) as
    | {
        id: unknown;
        type: string;
        title: string;
        path: string;
        mime_type: string;
        primary: number;
        entity_id: unknown;
      }
    | null;
  return row ? mapAttachment(row) : null;
}

export function listAttachmentsForEntity(db: Database, groupId: string, entityId: string): AttachmentRow[] {
  assertEntityInGroup(db, groupId, entityId);
  const gid = requireGroupId(groupId);
  const [idBytes, idText] = idPair(entityId);
  const [gidBytes, gidText] = idPair(gid);
  const rows = db
    .query(
      `SELECT a.id, a.type, a.title, a.path, a.mime_type, a."primary" AS "primary", a.entity_attachments AS entity_id
       FROM attachments a
       JOIN entities e ON e.id = a.entity_attachments
       WHERE (a.entity_attachments = ? OR a.entity_attachments = ?)
         AND (e.group_entities = ? OR e.group_entities = ?)
       ORDER BY a.title`,
    )
    .all(idBytes, idText, gidBytes, gidText) as Array<{
    id: unknown;
    type: string;
    title: string;
    path: string;
    mime_type: string;
    primary: number;
    entity_id: unknown;
  }>;
  return rows.map(mapAttachment);
}

export function deleteAttachmentForGroup(db: Database, groupId: string, id: string): boolean {
  const row = getAttachmentForGroup(db, groupId, id);
  if (!row) return false;
  const [idBytes, idText] = idPair(id);
  const result = db.run(`DELETE FROM attachments WHERE id = ? OR id = ?`, [idBytes, idText]);
  return result.changes > 0;
}

export function getExportForGroup(db: Database, groupId: string, id: string): ExportRow | null {
  if (!isUuidText(id)) return null;
  const gid = requireGroupId(groupId);
  const [idBytes, idText] = idPair(id);
  const [gidBytes, gidText] = idPair(gid);
  const row = db
    .query(
      `SELECT id, group_id, kind, status, progress, artifact_path, size_bytes, error
       FROM exports
       WHERE (id = ? OR id = ?) AND (group_id = ? OR group_id = ?)`,
    )
    .get(idBytes, idText, gidBytes, gidText) as
    | {
        id: unknown;
        group_id: unknown;
        kind: string;
        status: string;
        progress: number;
        artifact_path: string | null;
        size_bytes: number;
        error: string | null;
      }
    | null;
  if (!row) return null;
  return {
    id: readUuid(row.id) ?? "",
    groupId: readUuid(row.group_id) ?? gid,
    kind: row.kind,
    status: row.status,
    progress: row.progress,
    artifactPath: row.artifact_path,
    sizeBytes: row.size_bytes,
    error: row.error,
  };
}

export function listExportsForGroup(db: Database, groupId: string): ExportRow[] {
  const gid = requireGroupId(groupId);
  const [gidBytes, gidText] = idPair(gid);
  const rows = db
    .query(
      `SELECT id, group_id, kind, status, progress, artifact_path, size_bytes, error
       FROM exports WHERE group_id = ? OR group_id = ? ORDER BY created_at DESC`,
    )
    .all(gidBytes, gidText) as Array<{
    id: unknown;
    group_id: unknown;
    kind: string;
    status: string;
    progress: number;
    artifact_path: string | null;
    size_bytes: number;
    error: string | null;
  }>;
  return rows.map((row) => ({
    id: readUuid(row.id) ?? "",
    groupId: readUuid(row.group_id) ?? gid,
    kind: row.kind,
    status: row.status,
    progress: row.progress,
    artifactPath: row.artifact_path,
    sizeBytes: row.size_bytes,
    error: row.error,
  }));
}

export function deleteExportForGroup(db: Database, groupId: string, id: string): boolean {
  const gid = requireGroupId(groupId);
  const [idBytes, idText] = idPair(id);
  const [gidBytes, gidText] = idPair(gid);
  const result = db.run(
    `DELETE FROM exports WHERE (id = ? OR id = ?) AND (group_id = ? OR group_id = ?)`,
    [idBytes, idText, gidBytes, gidText],
  );
  return result.changes > 0;
}

export function renameEntityForGroup(db: Database, groupId: string, id: string, name: string): boolean {
  const gid = requireGroupId(groupId);
  const updated = updateEntityName(db, gid, id, name);
  if (updated) publishEntityMutation(gid);
  return updated;
}

export function deleteEntityForGroup(db: Database, groupId: string, id: string): boolean {
  const gid = requireGroupId(groupId);
  if (!getEntityForGroup(db, gid, id)) return false;
  const [idBytes, idText] = idPair(id);
  db.run(`DELETE FROM entities WHERE id = ? OR id = ?`, [idBytes, idText]);
  publishEntityMutation(gid);
  return true;
}

export function renameTagForGroup(db: Database, groupId: string, id: string, name: string): boolean {
  const gid = requireGroupId(groupId);
  const updated = updateTagName(db, gid, id, name);
  if (updated) publishTagMutation(gid);
  return updated;
}

export function createTagForGroup(
  db: Database,
  groupId: string,
  input: { name: string; description?: string | null; color?: string | null; icon?: string | null; parentId?: string | null },
): string {
  const gid = requireGroupId(groupId);
  assertTagsInGroup(db, gid, [input.parentId]);
  const id = insertTag(db, {
    name: input.name,
    groupId: gid,
    parentId: input.parentId,
    color: input.color,
    description: input.description,
  });
  publishTagMutation(gid);
  return id;
}

export function deleteTagForGroup(db: Database, groupId: string, id: string): boolean {
  const gid = requireGroupId(groupId);
  if (!getTagById(db, gid, id)) return false;
  const [idBytes, idText] = idPair(id);
  db.run(`DELETE FROM tags WHERE id = ? OR id = ?`, [idBytes, idText]);
  publishTagMutation(gid);
  return true;
}

export function createEntityForGroup(
  db: Database,
  groupId: string,
  input: { name: string; entityTypeId: string; parentId?: string | null; tagIds?: string[] },
): string {
  const gid = requireGroupId(groupId);
  assertEntityTypeInGroup(db, gid, input.entityTypeId);
  assertEntityInGroup(db, gid, input.parentId);
  assertTagsInGroup(db, gid, input.tagIds ?? []);
  const id = insertEntity(db, {
    name: input.name,
    groupId: gid,
    entityTypeId: input.entityTypeId,
    parentId: input.parentId,
  });
  for (const tagId of input.tagIds ?? []) {
    if (!isNil(tagId)) insertTagLink(db, tagId, id);
  }
  publishEntityMutation(gid);
  return id;
}

export function patchEntityTagsForGroup(db: Database, groupId: string, entityId: string, tagIds: string[]): void {
  const gid = requireGroupId(groupId);
  if (!getEntityForGroup(db, gid, entityId)) throw notFound();
  assertTagsInGroup(db, gid, tagIds);
  const [idBytes, idText] = idPair(entityId);
  db.run(`DELETE FROM tag_entities WHERE entity_id = ? OR entity_id = ?`, [idBytes, idText]);
  for (const tagId of tagIds) {
    if (!isNil(tagId)) insertTagLink(db, tagId, entityId);
  }
  publishEntityMutation(gid);
}

export function createMaintenanceForGroup(
  db: Database,
  groupId: string,
  entityId: string,
  input: { name: string; date?: string | null; cost?: number },
): string {
  const gid = requireGroupId(groupId);
  assertEntityInGroup(db, gid, entityId);
  return insertMaintenanceEntry(db, {
    name: input.name,
    entityId,
    date: input.date,
    cost: input.cost,
  });
}

export function createFieldForGroup(
  db: Database,
  groupId: string,
  input: { entityId: string; name: string; type: string; timeValue: string },
): string {
  const gid = requireGroupId(groupId);
  assertEntityInGroup(db, gid, input.entityId);
  return insertEntityField(db, {
    name: input.name,
    entityId: input.entityId,
    type: input.type,
    timeValue: input.timeValue,
  });
}

export function createTemplateForGroup(
  db: Database,
  groupId: string,
  input: { name: string; defaultLocationId?: string | null },
): string {
  const gid = requireGroupId(groupId);
  assertEntityInGroup(db, gid, input.defaultLocationId);
  const id = newUuidBytes();
  const now = sqliteNow();
  const location = input.defaultLocationId && !isNil(input.defaultLocationId) ? uuidToBytes(input.defaultLocationId) : null;
  db.run(
    `INSERT INTO entity_templates (
       id, created_at, updated_at, name, default_quantity, default_insured,
       default_lifetime_warranty, include_warranty_fields, include_purchase_fields, include_sold_fields,
       entity_template_location, group_entity_templates
     ) VALUES (?, ?, ?, ?, 1, 0, 0, 0, 0, 0, ?, ?)`,
    [id, now, now, input.name, location, uuidToBytes(gid)],
  );
  publishEntityMutation(gid);
  return bytesToUuid(id);
}

export function listMemberships(db: Database, userId: Uint8Array): Membership[] {
  const text = bytesToUuid(asBytes(userId));
  const rows = db
    .query(`SELECT group_id, role FROM user_groups WHERE user_id = ? OR user_id = ?`)
    .all(asBytes(userId), text) as Array<{ group_id: unknown; role: string }>;
  return rows.map((row) => ({ groupId: readUuid(row.group_id) ?? "", role: row.role }));
}

export function membershipRole(db: Database, userId: Uint8Array, groupId: string): string | null {
  const gid = canonicalUuid(groupId);
  return listMemberships(db, userId).find((row) => row.groupId === gid)?.role ?? null;
}

export function isMember(db: Database, userId: Uint8Array, groupId: string): boolean {
  return membershipRole(db, userId, groupId) !== null;
}

export function isOwnerOf(db: Database, userId: Uint8Array, groupId: string): boolean {
  return membershipRole(db, userId, groupId) === "owner";
}

export function readDefaultGroupId(db: Database, userId: Uint8Array): string | null {
  const text = bytesToUuid(asBytes(userId));
  const row = db
    .query(`SELECT default_group_id FROM users WHERE id = ? OR id = ?`)
    .get(asBytes(userId), text) as { default_group_id: unknown } | null;
  if (!row?.default_group_id) return null;
  return readUuid(row.default_group_id);
}

export type GroupRow = {
  id: string;
  name: string;
  currency: string;
};

export function getGroup(db: Database, groupId: string): GroupRow | null {
  const gid = requireGroupId(groupId);
  const [bytes, text] = idPair(gid);
  const row = db.query(`SELECT id, name, currency FROM groups WHERE id = ? OR id = ?`).get(bytes, text) as
    | { id: unknown; name: string; currency: string }
    | null;
  if (!row) return null;
  return { id: readUuid(row.id) ?? gid, name: row.name, currency: row.currency.toUpperCase() };
}

export function updateGroup(db: Database, groupId: string, name: string, currency: string): GroupRow {
  const gid = requireGroupId(groupId);
  if (!name.trim()) throw new TenancyError("group name cannot be empty", 400);
  if (!currency.trim()) throw new TenancyError("currency cannot be empty", 400);
  const [bytes, text] = idPair(gid);
  const now = sqliteNow();
  const result = db.run(
    `UPDATE groups SET name = ?, currency = ?, updated_at = ? WHERE id = ? OR id = ?`,
    [name, currency.toLowerCase(), now, bytes, text],
  );
  if (result.changes !== 1) throw notFound();
  return getGroup(db, gid)!;
}

export function deleteGroup(db: Database, groupId: string): void {
  const gid = requireGroupId(groupId);
  const [bytes, text] = idPair(gid);
  db.transaction(() => {
    db.run(
      `DELETE FROM attachments WHERE entity_attachments IN (
         SELECT id FROM entities WHERE group_entities = ? OR group_entities = ?
       )`,
      [bytes, text],
    );
    db.run(`DELETE FROM entities WHERE group_entities = ? OR group_entities = ?`, [bytes, text]);
    db.run(`DELETE FROM tags WHERE group_tags = ? OR group_tags = ?`, [bytes, text]);
    db.run(`DELETE FROM entity_types WHERE group_entity_types = ? OR group_entity_types = ?`, [bytes, text]);
    db.run(`DELETE FROM exports WHERE group_id = ? OR group_id = ?`, [bytes, text]);
    db.run(`DELETE FROM group_invitation_tokens WHERE group_invitation_tokens = ? OR group_invitation_tokens = ?`, [
      bytes,
      text,
    ]);
    const result = db.run(`DELETE FROM groups WHERE id = ? OR id = ?`, [bytes, text]);
    if (result.changes !== 1) throw notFound();
  })();
}

export function listMembers(db: Database, groupId: string): Array<{ id: string; name: string; email: string; role: string }> {
  const gid = requireGroupId(groupId);
  const [bytes, text] = idPair(gid);
  const rows = db
    .query(
      `SELECT u.id, u.name, u.email, ug.role
       FROM user_groups ug
       JOIN users u ON u.id = ug.user_id
       WHERE ug.group_id = ? OR ug.group_id = ?
       ORDER BY u.name`,
    )
    .all(bytes, text) as Array<{ id: unknown; name: string; email: string; role: string }>;
  return rows.map((row) => ({ id: readUuid(row.id) ?? "", name: row.name, email: row.email, role: row.role }));
}

export function removeMember(db: Database, groupId: string, userId: string): void {
  const gid = requireGroupId(groupId);
  if (!isUuidText(userId) || isNil(userId)) throw new TenancyError("user ID cannot be empty", 400);
  const [gidBytes, gidText] = idPair(gid);
  const [userBytes, userText] = idPair(userId);
  const removed = db.run(
    `DELETE FROM user_groups
     WHERE (group_id = ? OR group_id = ?) AND (user_id = ? OR user_id = ?)`,
    [gidBytes, gidText, userBytes, userText],
  );
  if (removed.changes === 0) throw notFound();
  const current = readDefaultGroupId(db, userBytes);
  if (current === gid) {
    const remaining = db
      .query(`SELECT group_id FROM user_groups WHERE user_id = ? OR user_id = ?`)
      .get(userBytes, userText) as { group_id: unknown } | null;
    const next = remaining ? asUuidBytes(remaining.group_id) : null;
    db.run(`UPDATE users SET default_group_id = ?, updated_at = ? WHERE id = ? OR id = ?`, [
      next,
      sqliteNow(),
      userBytes,
      userText,
    ]);
  }
}

export type InvitationRow = {
  id: string;
  expiresAt: string;
  uses: number;
  token?: string;
};

export function createInvitation(db: Database, groupId: string, uses: number, expiresAt: string): InvitationRow {
  const gid = requireGroupId(groupId);
  if (!Number.isInteger(uses) || uses < 1) throw new TenancyError("uses must be at least 1", 400);
  const token = generateToken();
  const id = newUuidBytes();
  const now = sqliteNow();
  db.run(
    `INSERT INTO group_invitation_tokens (id, created_at, updated_at, token, expires_at, uses, group_invitation_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, now, now, token.hash, expiresAt, uses, uuidToBytes(gid)],
  );
  return { id: bytesToUuid(id), expiresAt, uses, token: token.raw };
}

export function listInvitations(db: Database, groupId: string): InvitationRow[] {
  const gid = requireGroupId(groupId);
  const [bytes, text] = idPair(gid);
  const rows = db
    .query(
      `SELECT id, expires_at, uses FROM group_invitation_tokens
       WHERE group_invitation_tokens = ? OR group_invitation_tokens = ?`,
    )
    .all(bytes, text) as Array<{ id: unknown; expires_at: string; uses: number }>;
  return rows.map((row) => ({ id: readUuid(row.id) ?? "", expiresAt: row.expires_at, uses: row.uses }));
}

export function deleteInvitation(db: Database, groupId: string, id: string): void {
  const gid = requireGroupId(groupId);
  if (!isUuidText(id)) throw notFound();
  const [gidBytes, gidText] = idPair(gid);
  const [idBytes, idText] = idPair(id);
  const result = db.run(
    `DELETE FROM group_invitation_tokens
     WHERE (id = ? OR id = ?) AND (group_invitation_tokens = ? OR group_invitation_tokens = ?)`,
    [idBytes, idText, gidBytes, gidText],
  );
  if (result.changes === 0) throw notFound();
}

export function acceptInvitation(db: Database, userId: Uint8Array, rawToken: string): GroupRow {
  if (!rawToken) throw new TenancyError("token is required", 400);
  const token = hashToken(rawToken);
  const row = db
    .query(
      `SELECT id, expires_at, uses, group_invitation_tokens AS group_id
       FROM group_invitation_tokens WHERE token = ?`,
    )
    .get(token) as { id: unknown; expires_at: string; uses: number; group_id: unknown } | null;
  if (!row?.group_id) throw notFound();
  if (row.uses <= 0) throw new TenancyError("invitation used up", 400);
  if (parseSqliteDateTime(row.expires_at).getTime() <= Date.now()) throw new TenancyError("invitation expired", 400);
  const groupId = readUuid(row.group_id);
  if (!groupId) throw notFound();
  if (isMember(db, userId, groupId)) throw new TenancyError("user already a member of this group", 400);
  const now = sqliteNow();
  db.transaction(() => {
    db.run(`INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, 'user')`, [asBytes(userId), uuidToBytes(groupId)]);
    const updated = db.run(
      `UPDATE group_invitation_tokens SET uses = uses - 1, updated_at = ? WHERE id = ? AND uses > 0`,
      [now, asUuidBytes(row.id)],
    );
    if (updated.changes !== 1) throw new TenancyError("invitation used up", 400);
  })();
  return getGroup(db, groupId)!;
}

