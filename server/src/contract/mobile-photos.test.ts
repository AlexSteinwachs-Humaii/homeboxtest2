import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HomeboxClient } from "../../../mobile/src/api/client.ts";
import { attachPhoto } from "../../../mobile/src/photos/photos.ts";
import { createApp } from "../app.ts";
import { readAttachmentBytes, storageLayout } from "../attachments/blob.ts";
import { createSession } from "../auth/users.ts";
import { prepareDatabase } from "../boot.ts";
import { loadConfig } from "../config.ts";
import { insertEntityType, insertGroup, insertUser } from "../db/inventory.ts";
import { uuidToBytes } from "../db/storage.ts";

const migrationsDir = join(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const pepper = "test-pepper-not-for-production-use!!";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const HEIC = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00]);

test("the phone stores a photo through the attachment API and reads it back after a new client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hb-mobile-photos-"));
  const db = prepareDatabase({
    HBOX_DATABASE_SQLITE_PATH: join(dir, "homebox.db"),
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_AUTH_API_KEY_PEPPER: pepper,
    HBOX_WEB_PORT: "0",
  }).db;
  const groupId = insertGroup(db, { name: "Home", currency: "usd" });
  const owner = insertUser(db, { name: "Ada", email: "ada@home.test", groupId });
  const itemType = insertEntityType(db, { name: "Item", groupId, isLocation: 0 });
  const session = createSession(db, uuidToBytes(owner), false);

  const bucket = mkdtempSync(join(tmpdir(), "hb-mobile-photo-blobs-"));
  const config = loadConfig(
    {
      HBOX_DATABASE_SQLITE_PATH: ":memory:",
      HBOX_AUTH_API_KEY_PEPPER: pepper,
      HBOX_OPTIONS_ALLOW_REGISTRATION: "true",
      HBOX_STORAGE_PREFIX_PATH: ".data",
      HBOX_STORAGE_CONN_STRING: `file://${bucket}`,
    },
    [],
    migrationsDir,
  );
  const app = createApp(config, process.env, { db });
  const fetchImpl = (url: string, init?: RequestInit) => app.request(url, init);
  const client = new HomeboxClient("http://127.0.0.1:7745", `Bearer ${session.raw}`, fetchImpl);
  client.setGroup(groupId);

  const created = await client.createEntity({
    name: "Lamp",
    description: "",
    quantity: 1,
    parentId: null,
    entityTypeId: itemType,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.error);

  const uploaded = await attachPhoto(
    client,
    groupId,
    created.data.id,
    { filename: "lamp.jpg", mimeType: "image/jpeg", bytes: JPEG },
    [],
  );
  expect(uploaded.ok).toBe(true);
  if (!uploaded.ok) throw new Error(uploaded.message);
  const photo = uploaded.data.attachments.find((item) => item.title === "lamp.jpg");
  expect(photo?.type).toBe("photo");
  expect(photo?.id).toBeTruthy();
  if (!photo) return;

  const onDisk = readAttachmentBytes(storageLayout(`file://${bucket}`, ".data"), photo.path);
  expect(onDisk).not.toBeNull();
  expect(Buffer.from(onDisk ?? []).equals(Buffer.from(JPEG))).toBe(true);

  const reinstalled = new HomeboxClient("http://127.0.0.1:7745", `Bearer ${session.raw}`, fetchImpl);
  reinstalled.setGroup(groupId);
  const again = await reinstalled.getEntity(created.data.id);
  expect(again.ok).toBe(true);
  if (!again.ok) throw new Error(again.error);
  expect(again.data.attachments.map((item) => item.id)).toContain(photo.id);
  expect(again.data.attachments.find((item) => item.id === photo.id)?.title).toBe("lamp.jpg");

  const image = await app.request(reinstalled.attachmentUrl(created.data.id, photo.id, session.attachmentToken));
  expect(image.status).toBe(200);
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(JPEG);
  expect(image.headers.get("content-type")).toContain("image/jpeg");

  const heic = await attachPhoto(
    reinstalled,
    groupId,
    created.data.id,
    { filename: "IMG_0001.HEIC", mimeType: "image/heic", bytes: HEIC },
    again.data.attachments.map((item) => item.id),
  );
  expect(heic.ok).toBe(true);
  if (!heic.ok) throw new Error(heic.message);
  const original = heic.data.attachments.find((item) => item.title === "IMG_0001.HEIC");
  expect(original?.mimeType).not.toBe("image/jpeg");
  const heicBytes = readAttachmentBytes(storageLayout(`file://${bucket}`, ".data"), original?.path ?? "");
  expect(Buffer.from(heicBytes ?? []).equals(Buffer.from(HEIC))).toBe(true);

  const failed = await attachPhoto(
    reinstalled,
    groupId,
    "not-an-item",
    { filename: "missing.jpg", mimeType: "image/jpeg", bytes: JPEG },
    heic.data.attachments.map((item) => item.id),
  );
  expect(failed.ok).toBe(false);
  if (failed.ok) return;
  expect(failed.message.length).toBeGreaterThan(0);
  const unchanged = await reinstalled.getEntity(created.data.id);
  expect(unchanged.ok).toBe(true);
  if (!unchanged.ok) return;
  expect(unchanged.data.attachments.map((item) => item.title)).not.toContain("missing.jpg");
});
