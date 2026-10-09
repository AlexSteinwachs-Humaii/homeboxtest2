import type { Database } from "bun:sqlite";

import { bytesToUuid, canonicalUuid, isUuidText, sqliteNow, uuidToBytes } from "../db/storage.ts";
import { getAttachmentForGroup, getEntityForGroup, type AttachmentRow } from "../auth/tenancy.ts";
import {
  deleteAttachmentBytes,
  readAttachmentBytes,
  storageLayout,
  writeAttachmentBytes,
  type StorageLayout,
} from "./blob.ts";
import { attachmentRelativePath } from "./blob.ts";
import {
  MIME_LINK_URL,
  isSafeInlineType,
  parseExternalHttpUrl,
  photoTypeFromName,
  sanitizeAttachmentName,
  sniffContentType,
} from "./sniff.ts";
import { renderThumbnail, type ThumbnailOptions } from "./thumbnail.ts";

export type AttachmentServiceOptions = {
  connString: string;
  prefixPath: string;
  thumbnail: ThumbnailOptions;
  maxUploadBytes: number;
};

export class AttachmentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: Array<{ field: string; error: string }>,
  ) {
    super(message);
    this.name = "AttachmentError";
  }
}

export type StoredAttachment = AttachmentRow & {
  thumbnail: { id: string; path: string; title: string; mimeType: string } | null;
};

const PHOTO_TYPES = new Set(["photo", "manual", "warranty", "attachment", "receipt"]);

function idPair(id: string): [Uint8Array, string] {
  const text = canonicalUuid(id);
  return [uuidToBytes(text), text];
}

function layoutOf(options: AttachmentServiceOptions): StorageLayout {
  return storageLayout(options.connString, options.prefixPath);
}

export function openAttachmentBytes(
  options: AttachmentServiceOptions,
  relativePath: string,
): Uint8Array | null {
  return readAttachmentBytes(layoutOf(options), relativePath);
}

export async function createFileAttachment(
  db: Database,
  groupId: string,
  entityId: string,
  input: { title: string; type: string; primary: boolean; content: Uint8Array },
  options: AttachmentServiceOptions,
): Promise<StoredAttachment> {
  if (!getEntityForGroup(db, groupId, entityId)) throw new AttachmentError("Not Found", 404);
  if (input.content.byteLength > options.maxUploadBytes) {
    throw new AttachmentError(`uploaded file exceeds the size limit of ${options.maxUploadBytes} bytes`, 413);
  }
  const title = sanitizeAttachmentName(input.title);
  if (!title) throw new AttachmentError("name is required", 422, [{ field: "name", error: "name is required" }]);
  const type = input.type || (photoTypeFromName(title) ? "photo" : "attachment");
  if (!PHOTO_TYPES.has(type)) throw new AttachmentError("failed to add attachment", 500);

  const relativePath = attachmentRelativePath(groupId, input.content);
  const mimeType = sniffContentType(input.content);
  writeAttachmentBytes(layoutOf(options), relativePath, input.content);

  const id = crypto.randomUUID();
  const now = sqliteNow();
  const primary = type === "photo" && (input.primary || countPhotos(db, entityId) === 0) ? 1 : 0;
  try {
    const insert = db.transaction(() => {
      if (primary) clearPrimary(db, entityId, id);
      db.run(
        `INSERT INTO attachments (id, created_at, updated_at, type, "primary", path, title, mime_type, entity_attachments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidToBytes(id), now, now, type, primary, relativePath, title, mimeType, uuidToBytes(entityId)],
      );
    });
    insert();
  } catch (err) {
    deleteAttachmentBytes(layoutOf(options), relativePath);
    throw err;
  }

  if (options.thumbnail.enabled) {
    await attachThumbnail(db, groupId, id, title, relativePath, input.content, options);
  }
  const stored = readStored(db, groupId, id);
  if (!stored) throw new AttachmentError("failed to add attachment", 500);
  return stored;
}

async function attachThumbnail(
  db: Database,
  groupId: string,
  attachmentId: string,
  title: string,
  relativePath: string,
  content: Uint8Array,
  options: AttachmentServiceOptions,
): Promise<void> {
  let webp: Uint8Array;
  try {
    webp = await renderThumbnail(content, title, options.thumbnail);
  } catch (err) {
    // Same outcome as the Go worker: log, leave the original, do not fail the upload.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[homebox] thumbnail skipped for ${title}: ${message}`);
    return;
  }
  const thumbPath = attachmentRelativePath(groupId, webp);
  writeAttachmentBytes(layoutOf(options), thumbPath, webp);
  const thumbId = crypto.randomUUID();
  const now = sqliteNow();
  try {
    db.run(
      `INSERT INTO attachments (id, created_at, updated_at, type, "primary", path, title, mime_type)
       VALUES (?, ?, ?, 'thumbnail', 0, ?, ?, 'image/webp')`,
      [uuidToBytes(thumbId), now, now, thumbPath, `${title}-thumb`],
    );
    const [parentBytes, parentText] = idPair(attachmentId);
    db.run(`UPDATE attachments SET attachment_thumbnail = ?, updated_at = ? WHERE id = ? OR id = ?`, [
      uuidToBytes(thumbId),
      now,
      parentBytes,
      parentText,
    ]);
  } catch (err) {
    deleteAttachmentBytes(layoutOf(options), thumbPath);
    console.warn(`[homebox] thumbnail row failed for ${title}: ${err instanceof Error ? err.message : err}`);
  }
}

export function createExternalAttachment(
  db: Database,
  groupId: string,
  entityId: string,
  input: { sourceType: string; externalId: string; title: string; attachmentType: string },
): StoredAttachment {
  if (!getEntityForGroup(db, groupId, entityId)) throw new AttachmentError("Not Found", 404);
  const sourceType = input.sourceType.trim();
  const externalId = input.externalId.trim();
  const fields: Array<{ field: string; error: string }> = [];
  if (!sourceType) fields.push({ field: "source_type", error: "source_type is required" });
  if (!externalId) fields.push({ field: "external_id", error: "external_id is required" });
  if (sourceType && sourceType !== "link") {
    fields.push({ field: "source_type", error: `unknown source_type ${JSON.stringify(sourceType)}` });
  }
  if (sourceType === "link" && externalId && !parseExternalHttpUrl(externalId)) {
    fields.push({ field: "external_id", error: "external_id must be a valid http/https URL" });
  }
  if (fields.length) {
    throw new AttachmentError(fields.map((field) => field.error).join("; "), 400, fields);
  }
  let title = input.title.trim();
  if (!title) {
    const url = parseExternalHttpUrl(externalId);
    title = url ? `${url.origin}${url.pathname}` : externalId;
  }
  const requested = input.attachmentType.trim();
  const type = PHOTO_TYPES.has(requested) ? requested : "attachment";
  const id = crypto.randomUUID();
  const now = sqliteNow();
  db.run(
    `INSERT INTO attachments (id, created_at, updated_at, type, "primary", path, title, mime_type, entity_attachments)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [uuidToBytes(id), now, now, type, externalId, title, MIME_LINK_URL, uuidToBytes(entityId)],
  );
  const stored = readStored(db, groupId, id);
  if (!stored) throw new AttachmentError("failed to add attachment", 500);
  return stored;
}

export function updateAttachment(
  db: Database,
  groupId: string,
  entityId: string,
  attachmentId: string,
  input: { type: string; title: string; primary: boolean },
): StoredAttachment {
  const row = attachmentOnEntity(db, groupId, entityId, attachmentId);
  if (!row) throw new AttachmentError("Not Found", 404);
  if (!PHOTO_TYPES.has(input.type)) throw new AttachmentError("failed to update attachment", 400);
  const primary = input.type === "photo" && input.primary ? 1 : 0;
  const now = sqliteNow();
  const [idBytes, idText] = idPair(attachmentId);
  const update = db.transaction(() => {
    db.run(`UPDATE attachments SET type = ?, "primary" = ?, title = ?, updated_at = ? WHERE id = ? OR id = ?`, [
      input.type,
      primary,
      input.title,
      now,
      idBytes,
      idText,
    ]);
    if (primary) clearPrimary(db, entityId, attachmentId);
  });
  update();
  const stored = readStored(db, groupId, attachmentId);
  if (!stored) throw new AttachmentError("Not Found", 404);
  return stored;
}

export function deleteStoredAttachment(
  db: Database,
  groupId: string,
  entityId: string,
  attachmentId: string,
  options: AttachmentServiceOptions,
): boolean {
  const row = attachmentOnEntity(db, groupId, entityId, attachmentId);
  if (!row) return false;
  if (row.mimeType === MIME_LINK_URL) {
    const [idBytes, idText] = idPair(attachmentId);
    db.run(`DELETE FROM attachments WHERE id = ? OR id = ?`, [idBytes, idText]);
    return true;
  }
  const thumb = readThumbnail(db, attachmentId);
  const pathCount = countPath(db, row.path);
  const [idBytes, idText] = idPair(attachmentId);
  if (thumb) {
    const [thumbBytes, thumbText] = idPair(thumb.id);
    db.run(`UPDATE attachments SET attachment_thumbnail = NULL WHERE id = ? OR id = ?`, [idBytes, idText]);
    db.run(`DELETE FROM attachments WHERE id = ? OR id = ?`, [thumbBytes, thumbText]);
  }
  db.run(`DELETE FROM attachments WHERE id = ? OR id = ?`, [idBytes, idText]);
  const layout = layoutOf(options);
  if (pathCount <= 1) deleteAttachmentBytes(layout, row.path);
  if (thumb) deleteAttachmentBytes(layout, thumb.path);
  return true;
}

export function serveAttachment(
  db: Database,
  groupId: string,
  entityId: string,
  attachmentId: string,
  options: AttachmentServiceOptions,
): Response {
  const row = attachmentOnEntity(db, groupId, entityId, attachmentId);
  if (!row) return Response.json({ error: "Not Found" }, { status: 404 });
  if (row.mimeType === MIME_LINK_URL) {
    const url = parseExternalHttpUrl(row.path);
    if (!url) return Response.json({ error: "invalid external URL attachment" }, { status: 422 });
    return Response.redirect(url.toString(), 302);
  }
  let bytes: Uint8Array | null;
  try {
    bytes = openAttachmentBytes(options, row.path);
  } catch (err) {
    console.warn(`[homebox] failed to open attachment: ${err instanceof Error ? err.message : err}`);
    return Response.json({ error: "failed to open file" }, { status: 500 });
  }
  if (!bytes) return Response.json({ error: "failed to open file" }, { status: 500 });
  const disposition = `${isSafeInlineType(row.mimeType) ? "inline" : "attachment"}; filename*=UTF-8''${queryEscape(row.title)}`;
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": row.mimeType || "application/octet-stream",
      "content-disposition": disposition,
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-download-options": "noopen",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox;",
    },
  });
}

export function attachmentOnEntity(
  db: Database,
  groupId: string,
  entityId: string,
  attachmentId: string,
): AttachmentRow | null {
  if (!isUuidText(entityId) || !isUuidText(attachmentId)) return null;
  const entity = getEntityForGroup(db, groupId, entityId);
  const row = getAttachmentForGroup(db, groupId, attachmentId);
  if (!entity || !row || row.entityId !== entity.id) return null;
  return row;
}

function readStored(db: Database, groupId: string, id: string): StoredAttachment | null {
  const row = getAttachmentForGroup(db, groupId, id);
  if (!row) return null;
  const thumb = readThumbnail(db, id);
  return {
    ...row,
    thumbnail: thumb ? { id: thumb.id, path: thumb.path, title: thumb.title, mimeType: thumb.mimeType } : null,
  };
}

function readThumbnail(
  db: Database,
  parentId: string,
): { id: string; path: string; title: string; mimeType: string } | null {
  const [idBytes, idText] = idPair(parentId);
  const row = db
    .query(
      `SELECT thumb.id AS id, thumb.path AS path, thumb.title AS title, thumb.mime_type AS mime_type
       FROM attachments parent
       JOIN attachments thumb ON parent.attachment_thumbnail = thumb.id OR parent.attachment_thumbnail = thumb.id
       WHERE parent.id = ? OR parent.id = ?`,
    )
    .get(idBytes, idText) as { id: unknown; path: string; title: string; mime_type: string } | null;
  if (!row) return null;
  let id: string | null = null;
  try {
    id = bytesToUuid(row.id instanceof Uint8Array ? row.id : new Uint8Array(row.id as ArrayBuffer));
  } catch {
    id = null;
  }
  if (!id) return null;
  return { id, path: row.path, title: row.title, mimeType: row.mime_type };
}

function countPhotos(db: Database, entityId: string): number {
  const [idBytes, idText] = idPair(entityId);
  const row = db
    .query(
      `SELECT COUNT(*) AS n FROM attachments
       WHERE type = 'photo' AND (entity_attachments = ? OR entity_attachments = ?)`,
    )
    .get(idBytes, idText) as { n: number };
  return row.n;
}

function countPath(db: Database, path: string): number {
  const row = db.query(`SELECT COUNT(*) AS n FROM attachments WHERE path = ?`).get(path) as { n: number };
  return row.n;
}

function clearPrimary(db: Database, entityId: string, exceptId: string): void {
  const [entityBytes, entityText] = idPair(entityId);
  const [exceptBytes, exceptText] = idPair(exceptId);
  db.run(
    `UPDATE attachments SET "primary" = 0
     WHERE type = 'photo' AND (entity_attachments = ? OR entity_attachments = ?)
       AND id != ? AND id != ?`,
    [entityBytes, entityText, exceptBytes, exceptText],
  );
}

function queryEscape(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export function entityAttachmentBody(entityId: string, attachment: StoredAttachment): Record<string, unknown> {
  return {
    id: entityId,
    attachments: [
      {
        id: attachment.id,
        type: attachment.type,
        primary: attachment.primary === 1,
        path: attachment.path,
        title: attachment.title,
        mimeType: attachment.mimeType,
        thumbnail: attachment.thumbnail,
      },
    ],
  };
}
