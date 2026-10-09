import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import sharp from "sharp";

import { createApp } from "../app.ts";
import { prepareDatabase } from "../boot.ts";
import { loadConfig } from "../config.ts";
import { insertEntity, insertEntityType, insertGroup, insertUser } from "../db/inventory.ts";
import { sqliteNow, uuidToBytes } from "../db/storage.ts";
import { createSession } from "../auth/users.ts";
import { StartupError } from "../errors.ts";
import {
  attachmentContentHash,
  attachmentRelativePath,
  deleteAttachmentBytes,
  fullAttachmentKey,
  legacyFlatKey,
  migrateLegacyFlatPaths,
  readAttachmentBytes,
  resolveFileBucket,
  storageLayout,
  writeAttachmentBytes,
} from "./blob.ts";
import { IMAGE_CODEC_SUPPORT } from "./codec-support.ts";

const migrationsDir = resolve(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const samplesDir = resolve(import.meta.dir, "../../testdata/images");
const PEPPER = "test-pepper-not-for-production-use!!";
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "homebox-attach-"));
  temps.push(dir);
  return dir;
}

function openDb(): Database {
  const prepared = prepareDatabase({
    HBOX_DATABASE_DRIVER: "sqlite3",
    HBOX_DATABASE_SQLITE_PATH: join(tempDir(), "homebox.db"),
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_WEB_PORT: "0",
  });
  return prepared.db;
}

function appFor(db: Database, bucket: string, extra: Record<string, string> = {}) {
  const config = loadConfig(
    {
      HBOX_DATABASE_SQLITE_PATH: ":memory:",
      HBOX_AUTH_API_KEY_PEPPER: PEPPER,
      HBOX_STORAGE_CONN_STRING: `file://${bucket}?no_tmp_dir=true`,
      HBOX_STORAGE_PREFIX_PATH: ".data",
      HBOX_OPTIONS_ALLOW_REGISTRATION: "true",
      ...extra,
    },
    [],
    migrationsDir,
  );
  return createApp(config, process.env, { db });
}

function seed(db: Database) {
  const groupA = insertGroup(db, { name: "Alpha", currency: "usd" });
  const groupB = insertGroup(db, { name: "Beta", currency: "eur" });
  const ownerA = insertUser(db, { name: "Owner", email: "owner@alpha.test", groupId: groupA });
  const ownerB = insertUser(db, { name: "Beta", email: "owner@beta.test", groupId: groupB });
  const typeA = insertEntityType(db, { name: "Item", groupId: groupA, isLocation: 0 });
  const typeB = insertEntityType(db, { name: "Item", groupId: groupB, isLocation: 0 });
  const entityA = insertEntity(db, { name: "Lamp", groupId: groupA, entityTypeId: typeA });
  const entityB = insertEntity(db, { name: "Secret", groupId: groupB, entityTypeId: typeB });
  const sessionA = createSession(db, uuidToBytes(ownerA), false);
  const sessionB = createSession(db, uuidToBytes(ownerB), false);
  return { groupA, groupB, entityA, entityB, sessionA, sessionB };
}

function cookie(raw: string): HeadersInit {
  return { cookie: `hb.auth.token=${raw}`, host: "127.0.0.1:7745" };
}

async function upload(app: ReturnType<typeof appFor>, entityId: string, raw: string, file: Uint8Array, name: string, type = "") {
  const form = new FormData();
  form.set("file", new File([Buffer.from(file)], name), name);
  form.set("name", name);
  if (type) form.set("type", type);
  return app.request(`http://127.0.0.1:7745/api/v1/entities/${entityId}/attachments`, {
    method: "POST",
    headers: cookie(raw),
    body: form,
  });
}

describe("blob key layout matches the Go attachment repo", () => {
  test("prefix, empty prefix, slash prefix, and backslash normalization", () => {
    const relative = "eb6bf410-a1a8-478d-a803-ca3948368a0c/documents/f295eb01-18a9-4631-a797-70bd9623edd4.png";
    expect(fullAttachmentKey(".data", relative)).toBe(`.data/${relative}`);
    expect(fullAttachmentKey(".data", relative.replaceAll("/", "\\"))).toBe(`.data/${relative}`);
    expect(fullAttachmentKey("", relative)).toBe(relative);
    expect(fullAttachmentKey("/", relative)).toBe(relative);
    expect(fullAttachmentKey(".data", relative)).not.toContain("\\");
    expect(fullAttachmentKey(".data", relative)).not.toContain("//");
  });

  test("blake3 derive-key matches the Go zeebo vector", () => {
    const content = new TextEncoder().encode("hello-attachment");
    expect(attachmentContentHash("eb6bf410-a1a8-478d-a803-ca3948368a0c", content)).toBe(
      "b5a8225bdad84c42c76f2ed6f42430cbc49c3701bbffc1167d51b3c1a2416632",
    );
    expect(attachmentContentHash("00000000-0000-0000-0000-000000000000", new Uint8Array())).toBe(
      "7c1c093f8b07f92fe2beeb9d1f0cca63b03e94f0ab4149dd0901241cbf617a90",
    );
  });

  test("file:///?no_tmp_dir=true is the bucket root and a non-file URL is refused", () => {
    expect(resolveFileBucket("file:///?no_tmp_dir=true")).toBe("/");
    expect(resolveFileBucket("file:///./")).toBe(resolve("."));
    expect(() => resolveFileBucket("s3://my-bucket")).toThrow(StartupError);
    expect(() => loadConfig({ HBOX_STORAGE_CONN_STRING: "gs://bucket" }, [])).toThrow(/file:\/\//);
    expect(() => loadConfig({ HBOX_STORAGE_PREFIX_PATH: "../escape" }, [])).toThrow(/PREFIX_PATH/);
  });

  test("legacy flat keys are readable and can be migrated into the subdirectory layout", () => {
    const bucket = tempDir();
    const layout = storageLayout(`file://${bucket}`, ".data");
    const relative = "eb6bf410-a1a8-478d-a803-ca3948368a0c/documents/hash1.png";
    const flatName = legacyFlatKey(fullAttachmentKey(".data", relative));
    writeFileSync(join(bucket, flatName), Buffer.from("legacy-bytes"));
    expect(readAttachmentBytes(layout, relative)).toEqual(new TextEncoder().encode("legacy-bytes"));

    const migrated = migrateLegacyFlatPaths(`file://${bucket}`);
    expect(migrated.moved).toBe(1);
    expect(existsSync(join(bucket, ".data", "eb6bf410-a1a8-478d-a803-ca3948368a0c", "documents", "hash1.png"))).toBe(
      true,
    );
    expect(existsSync(join(bucket, flatName))).toBe(false);
    expect(migrateLegacyFlatPaths(`file://${bucket}`).moved).toBe(0);
  });
});

describe("attachment HTTP", () => {
  test("an existing blob opens, a new photo lands in the same layout with a thumbnail, and another group gets nothing", async () => {
    const bucket = tempDir();
    const db = openDb();
    const seedData = seed(db);
    const app = appFor(db, bucket);
    const layout = storageLayout(`file://${bucket}?no_tmp_dir=true`, ".data");

    const marker = "HBX-SECRET-BYTES-do-not-leak";
    const relative = `${seedData.groupB}/documents/already-there`;
    writeAttachmentBytes(layout, relative, new TextEncoder().encode(marker));
    const existingId = crypto.randomUUID();
    const now = sqliteNow();
    db.run(
      `INSERT INTO attachments (id, created_at, updated_at, type, "primary", path, title, mime_type, entity_attachments)
       VALUES (?, ?, ?, 'photo', 1, ?, 'old.jpg', 'image/jpeg', ?)`,
      [uuidToBytes(existingId), now, now, relative, uuidToBytes(seedData.entityB)],
    );

    const own = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seedData.entityB}/attachments/${existingId}`, {
      headers: cookie(seedData.sessionB.raw),
    });
    expect(own.status).toBe(200);
    expect(await own.text()).toBe(marker);
    expect(own.headers.get("content-type")).toContain("image/jpeg");
    expect(own.headers.get("content-disposition")).toContain("inline");

    const stolen = await app.request(
      `http://127.0.0.1:7745/api/v1/entities/${seedData.entityB}/attachments/${existingId}`,
      { headers: cookie(seedData.sessionA.raw) },
    );
    expect(stolen.status).toBe(404);
    expect(await stolen.text()).not.toContain(marker);

    const asset = await app.request(`http://127.0.0.1:7745/api/v1/assets/${existingId}`, {
      headers: cookie(seedData.sessionA.raw),
    });
    expect(asset.status).toBe(404);
    const assetText = await asset.text();
    expect(assetText).not.toContain(marker);
    expect(assetText).not.toContain("already-there");

    const jpeg = await sharp({
      create: { width: 32, height: 16, channels: 3, background: { r: 220, g: 20, b: 20 } },
    })
      .jpeg()
      .toBuffer();
    const created = await upload(app, seedData.entityA, seedData.sessionA.raw, new Uint8Array(jpeg), "lamp.jpg");
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      attachments: Array<{ id: string; path: string; mimeType: string; primary: boolean; thumbnail: { id: string; path: string; mimeType: string } | null }>;
    };
    const photo = body.attachments[0];
    expect(photo).toBeDefined();
    expect(photo.path).toBe(attachmentRelativePath(seedData.groupA, new Uint8Array(jpeg)));
    expect(photo.path.startsWith(`${seedData.groupA}/documents/`)).toBe(true);
    expect(photo.path).not.toContain("thumbnails");
    expect(photo.mimeType).toBe("image/jpeg");
    expect(photo.primary).toBe(true);
    expect(photo.thumbnail).not.toBeNull();
    expect(photo.thumbnail?.mimeType).toBe("image/webp");
    expect(photo.thumbnail?.path.startsWith(`${seedData.groupA}/documents/`)).toBe(true);

    const onDisk = join(bucket, ".data", photo.path);
    expect(existsSync(onDisk)).toBe(true);
    expect(readFileSync(onDisk)).toEqual(jpeg);
    const thumbDisk = join(bucket, ".data", photo.thumbnail?.path ?? "");
    expect(existsSync(thumbDisk)).toBe(true);
    const thumbBytes = readFileSync(thumbDisk);
    expect(thumbBytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(thumbBytes.includes(Buffer.from("WEBP"))).toBe(true);

    const viaToken = await app.request(
      `http://127.0.0.1:7745/api/v1/entities/${seedData.entityA}/attachments/${photo.id}?access_token=${seedData.sessionA.attachmentToken}`,
    );
    expect(viaToken.status).toBe(200);
    expect(new Uint8Array(await viaToken.arrayBuffer())).toEqual(new Uint8Array(jpeg));

    const tokenWrite = await upload(
      app,
      seedData.entityA,
      seedData.sessionA.attachmentToken,
      new Uint8Array(jpeg),
      "nope.jpg",
    );
    // The attachment token is a real session, but asset writes require the user role.
    expect(tokenWrite.status).toBe(403);

    const queryWrite = await app.request(
      `http://127.0.0.1:7745/api/v1/entities/${seedData.entityA}/attachments?access_token=${seedData.sessionA.attachmentToken}`,
      { method: "POST", body: new FormData() },
    );
    expect(queryWrite.status).toBe(403);

    const other = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seedData.entityA}/attachments/${photo.id}`, {
      headers: cookie(seedData.sessionB.raw),
    });
    expect(other.status).toBe(404);
    const otherBody = await other.text();
    expect(otherBody).not.toContain(photo.path);
    expect(otherBody).not.toContain("RIFF");
  });

  test("HEIC and JPEG XL samples the Go server accepts get a WebP thumbnail", async () => {
    expect(IMAGE_CODEC_SUPPORT.heic.goAcceptsSample).toBe(true);
    expect(IMAGE_CODEC_SUPPORT.jpegxl.goAcceptsSample).toBe(true);
    expect(existsSync(resolve(import.meta.dir, "../../../backend/internal/data/repo/repo_item_attachments.go"))).toBe(
      true,
    );

    const bucket = tempDir();
    const db = openDb();
    const seedData = seed(db);
    const app = appFor(db, bucket);

    for (const sample of [
      { file: "test8.heic", name: "scan.heic" },
      { file: "or6_ll.jxl", name: "scan.jxl" },
    ]) {
      const bytes = new Uint8Array(readFileSync(join(samplesDir, sample.file)));
      const created = await upload(app, seedData.entityA, seedData.sessionA.raw, bytes, sample.name);
      expect(created.status).toBe(201);
      const body = (await created.json()) as {
        attachments: Array<{ path: string; thumbnail: { path: string; mimeType: string } | null }>;
      };
      const photo = body.attachments[0];
      expect(photo.path).toBe(attachmentRelativePath(seedData.groupA, bytes));
      expect(existsSync(join(bucket, ".data", photo.path))).toBe(true);
      expect(photo.thumbnail?.mimeType).toBe("image/webp");
      const thumb = readFileSync(join(bucket, ".data", photo.thumbnail?.path ?? ""));
      expect(thumb.subarray(0, 4).toString()).toBe("RIFF");
    }
  });

  test("update, external link, and delete keep the Go status codes and do not remove a shared blob", async () => {
    const bucket = tempDir();
    const db = openDb();
    const seedData = seed(db);
    const app = appFor(db, bucket);

    const note = new TextEncoder().encode("not-an-image");
    const created = await upload(app, seedData.entityA, seedData.sessionA.raw, note, "manual.txt", "manual");
    expect(created.status).toBe(201);
    const body = (await created.json()) as { attachments: Array<{ id: string; path: string; thumbnail: unknown }> };
    expect(body.attachments[0].thumbnail).toBeNull();
    const id = body.attachments[0].id;

    const updated = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seedData.entityA}/attachments/${id}`, {
      method: "PUT",
      headers: { ...cookie(seedData.sessionA.raw), "content-type": "application/json" },
      body: JSON.stringify({ type: "warranty", title: "Warranty card", primary: true }),
    });
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as { attachments: Array<{ title: string; type: string; primary: boolean }> };
    expect(updatedBody.attachments[0].title).toBe("Warranty card");
    expect(updatedBody.attachments[0].type).toBe("warranty");
    expect(updatedBody.attachments[0].primary).toBe(false);

    const missing = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seedData.entityA}/attachments`, {
      method: "POST",
      headers: cookie(seedData.sessionA.raw),
      body: new FormData(),
    });
    expect(missing.status).toBe(422);

    const external = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seedData.entityA}/attachments/external`, {
      method: "POST",
      headers: { ...cookie(seedData.sessionA.raw), "content-type": "application/json" },
      body: JSON.stringify({ source_type: "link", external_id: "https://example.com/doc", title: "Docs" }),
    });
    expect(external.status).toBe(201);
    const link = (await external.json()) as { attachments: Array<{ id: string; mimeType: string }> };
    const follow = await app.request(
      `http://127.0.0.1:7745/api/v1/entities/${seedData.entityA}/attachments/${link.attachments[0].id}`,
      { headers: cookie(seedData.sessionA.raw), redirect: "manual" },
    );
    expect(follow.status).toBe(302);
    expect(follow.headers.get("location")).toBe("https://example.com/doc");

    const bad = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seedData.entityA}/attachments/external`, {
      method: "POST",
      headers: { ...cookie(seedData.sessionA.raw), "content-type": "application/json" },
      body: JSON.stringify({ source_type: "link", external_id: "javascript:alert(1)" }),
    });
    expect(bad.status).toBe(400);

    const removed = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seedData.entityA}/attachments/${id}`, {
      method: "DELETE",
      headers: cookie(seedData.sessionA.raw),
    });
    expect(removed.status).toBe(204);
    expect(existsSync(join(bucket, ".data", body.attachments[0].path))).toBe(false);

    const shared = new TextEncoder().encode("shared-bytes");
    const first = await upload(app, seedData.entityA, seedData.sessionA.raw, shared, "a.bin", "attachment");
    const second = await upload(app, seedData.entityA, seedData.sessionA.raw, shared, "b.bin", "attachment");
    const firstBody = (await first.json()) as { attachments: Array<{ id: string; path: string }> };
    const secondBody = (await second.json()) as { attachments: Array<{ id: string; path: string }> };
    expect(firstBody.attachments[0].path).toBe(secondBody.attachments[0].path);
    const del = await app.request(
      `http://127.0.0.1:7745/api/v1/entities/${seedData.entityA}/attachments/${firstBody.attachments[0].id}`,
      { method: "DELETE", headers: cookie(seedData.sessionA.raw) },
    );
    expect(del.status).toBe(204);
    expect(existsSync(join(bucket, ".data", secondBody.attachments[0].path))).toBe(true);
    deleteAttachmentBytes(storageLayout(`file://${bucket}`, ".data"), secondBody.attachments[0].path);
  });
});
