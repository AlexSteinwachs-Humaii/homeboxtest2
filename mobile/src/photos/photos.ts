import { HomeboxClient, type AttachmentUpload, type EntityAttachment, type EntityDetail } from "../api/client";

// Photos are files on the server. This module uploads one and then shows only
// what a later GET returns. A camera-roll URI is a temporary upload source.

export type PhotoResult = { ok: true; data: EntityDetail } | { ok: false; status: number; message: string };

const INLINE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);

export function photoFilename(fileName: string | null | undefined, mimeType: string | null | undefined): string {
  const base = (fileName ?? "").split(/[/\\]/).pop()?.trim() ?? "";
  if (base && base !== "." && base !== ".." && !base.startsWith(".")) return base;
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.includes("heic") || mime.includes("heif")) return "photo.heic";
  if (mime.includes("png")) return "photo.png";
  if (mime.includes("webp")) return "photo.webp";
  if (mime.includes("gif")) return "photo.gif";
  return "photo.jpg";
}

// JPEG, PNG, WebP, and GIF can be shown directly. HEIC and other camera
// originals stay as the device provided them; the server's thumbnail is what
// the phone can display until the original is a type the view understands.
export function displayAttachmentId(attachment: EntityAttachment): string {
  if (INLINE.has(attachment.mimeType.toLowerCase())) return attachment.id;
  return attachment.thumbnailId ?? attachment.id;
}

export async function attachPhoto(
  client: HomeboxClient,
  groupId: string,
  entityId: string,
  file: AttachmentUpload,
  previousIds: string[],
): Promise<PhotoResult> {
  client.setGroup(groupId);
  const uploaded = await client.addAttachment(entityId, {
    ...file,
    filename: photoFilename(file.filename, file.mimeType),
    mimeType: file.mimeType || "application/octet-stream",
  });
  if (!uploaded.ok) return { ok: false, status: uploaded.status, message: uploaded.error };

  const fetched = await client.getEntity(entityId);
  if (!fetched.ok) {
    return { ok: false, status: fetched.status, message: "The server did not confirm the photo. It is not shown as saved." };
  }
  const known = new Set(previousIds);
  if (!fetched.data.attachments.some((item) => !known.has(item.id))) {
    return { ok: false, status: fetched.status, message: "The server did not return the photo. It was not saved." };
  }
  return { ok: true, data: fetched.data };
}
