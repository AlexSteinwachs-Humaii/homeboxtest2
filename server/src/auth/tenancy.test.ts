import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

import { createApp } from "../app.ts";
import { prepareDatabase } from "../boot.ts";
import { loadConfig } from "../config.ts";
import {
  insertEntity,
  insertEntityType,
  insertGroup,
  insertUser,
  requireGroupId,
} from "../db/inventory.ts";
import { newUuidBytes, sqliteNow, uuidToBytes } from "../db/storage.ts";
import { generateApiKey, setApiKeyPepper } from "./token.ts";
import {
  createEntityForGroup,
  createMaintenanceForGroup,
  createTemplateForGroup,
  getAttachmentForGroup,
  getEntityForGroup,
  getExportForGroup,
  isOwnerOf,
  TenancyError,
} from "./tenancy.ts";
import { createSession } from "./users.ts";

const migrationsDir = resolve(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const PEPPER = "test-pepper-not-for-production-use!!";
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "homebox-tenancy-"));
  temps.push(dir);
  return dir;
}

function openFixture(): Database {
  const path = join(tempDir(), "homebox.db");
  const prepared = prepareDatabase({
    HBOX_DATABASE_DRIVER: "sqlite3",
    HBOX_DATABASE_SQLITE_PATH: path,
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_WEB_PORT: "0",
  });
  return prepared.db;
}

function appFor(db: Database) {
  setApiKeyPepper(PEPPER);
  const config = loadConfig(
    {
      HBOX_DATABASE_SQLITE_PATH: ":memory:",
      HBOX_AUTH_API_KEY_PEPPER: PEPPER,
      HBOX_OPTIONS_ALLOW_REGISTRATION: "true",
      HBOX_OPTIONS_ALLOW_LOCAL_LOGIN: "true",
    },
    [],
    migrationsDir,
  );
  return createApp(config, process.env, { db });
}

function seedPair(db: Database) {
  const groupA = insertGroup(db, { name: "Alpha", currency: "usd" });
  const groupB = insertGroup(db, { name: "Beta", currency: "eur" });
  const ownerA = insertUser(db, { name: "Owner", email: "owner@alpha.test", groupId: groupA });
  const memberA = insertUser(db, { name: "Member", email: "member@alpha.test" });
  const now = sqliteNow();
  db.run(`UPDATE users SET default_group_id = ? WHERE id = ?`, [uuidToBytes(groupA), uuidToBytes(memberA)]);
  db.run(`INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, 'user')`, [
    uuidToBytes(memberA),
    uuidToBytes(groupA),
  ]);
  const typeA = insertEntityType(db, { name: "Item", groupId: groupA, isLocation: 0 });
  const typeB = insertEntityType(db, { name: "Item", groupId: groupB, isLocation: 0 });
  const locTypeB = insertEntityType(db, { name: "Location", groupId: groupB, isLocation: 1 });
  const entityA = insertEntity(db, { name: "Alpha lamp", groupId: groupA, entityTypeId: typeA });
  const entityB = insertEntity(db, { name: "Beta secret", groupId: groupB, entityTypeId: typeB });
  const locationB = insertEntity(db, { name: "Beta shelf", groupId: groupB, entityTypeId: locTypeB });
  const attachmentB = crypto.randomUUID();
  const exportB = crypto.randomUUID();
  db.run(
    `INSERT INTO attachments (id, created_at, updated_at, type, "primary", path, title, mime_type, entity_attachments)
     VALUES (?, ?, ?, 'photo', 1, 'secret/path.jpg', 'Beta photo', 'image/jpeg', ?)`,
    [uuidToBytes(attachmentB), now, now, uuidToBytes(entityB)],
  );
  db.run(
    `INSERT INTO exports (id, created_at, updated_at, kind, status, progress, size_bytes, artifact_path, group_id)
     VALUES (?, ?, ?, 'export', 'completed', 100, 12, 'beta/export.zip', ?)`,
    [uuidToBytes(exportB), now, now, uuidToBytes(groupB)],
  );
  const ownerSession = createSession(db, uuidToBytes(ownerA), false);
  const memberSession = createSession(db, uuidToBytes(memberA), false);
  const key = generateApiKey();
  db.run(
    `INSERT INTO api_keys (id, created_at, updated_at, user_id, name, token) VALUES (?, ?, ?, ?, ?, ?)`,
    [newUuidBytes(), now, now, uuidToBytes(ownerA), "ci", key.hash],
  );
  return { groupA, groupB, ownerA, memberA, typeA, typeB, entityA, entityB, locationB, attachmentB, exportB, ownerSession, memberSession, apiKey: key.raw };
}

function cookie(raw: string): HeadersInit {
  return { cookie: `hb.auth.token=${raw}`, host: "127.0.0.1:7745" };
}

describe("public routes stay public", () => {
  test("status, currencies, and auth routes do not require a session", async () => {
    const db = openFixture();
    const app = appFor(db);
    const status = await app.request("http://127.0.0.1:7745/api/v1/status");
    expect(status.status).toBe(200);
    const currencies = await app.request("http://127.0.0.1:7745/api/v1/currencies");
    expect(currencies.status).toBe(200);
    expect(currencies.headers.get("cache-control")).toBe("max-age=600");
    const codes = (await currencies.json()) as Array<{ code: string }>;
    expect(codes.some((row) => row.code === "USD")).toBe(true);

    const login = await app.request("http://127.0.0.1:7745/api/v1/users/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "nobody@example.com", password: "wrong-password" }),
    });
    expect(login.status).toBe(401);
    expect(((await login.json()) as { error: string }).error).not.toBe("authorization header or query is required");

    const forgot = await app.request("http://127.0.0.1:7745/api/v1/users/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(forgot.status).toBe(400);

    const oidc = await app.request("http://127.0.0.1:7745/api/v1/users/login/oidc");
    expect(oidc.status).toBe(404);
  });
});

describe("cross-group reads and writes", () => {
  test("a session or API key for group A does not receive group B rows", async () => {
    const db = openFixture();
    const seed = seedPair(db);
    const app = appFor(db);

    for (const headers of [cookie(seed.ownerSession.raw), { authorization: `Bearer ${seed.apiKey}` }]) {
      const entity = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seed.entityB}`, { headers });
      expect(entity.status).toBe(404);
      expect(await entity.text()).not.toContain("Beta secret");

      const attachment = await app.request(`http://127.0.0.1:7745/api/v1/assets/${seed.attachmentB}`, { headers });
      expect(attachment.status).toBe(404);
      expect(await attachment.text()).not.toContain("secret/path.jpg");

      const nested = await app.request(
        `http://127.0.0.1:7745/api/v1/entities/${seed.entityB}/attachments/${seed.attachmentB}`,
        { headers },
      );
      expect(nested.status).toBe(404);

      const exported = await app.request(`http://127.0.0.1:7745/api/v1/group/exports/${seed.exportB}`, { headers });
      expect(exported.status).toBe(404);
      expect(await exported.text()).not.toContain("beta/export.zip");

      const renamed = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seed.entityB}`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ name: "stolen" }),
      });
      expect(renamed.status).toBe(404);
      const removed = await app.request(`http://127.0.0.1:7745/api/v1/group/exports/${seed.exportB}`, {
        method: "DELETE",
        headers,
      });
      expect(removed.status).toBe(404);
    }

    expect(getEntityForGroup(db, seed.groupB, seed.entityB)?.name).toBe("Beta secret");
    expect(getExportForGroup(db, seed.groupB, seed.exportB)?.artifactPath).toBe("beta/export.zip");
    expect(getAttachmentForGroup(db, seed.groupB, seed.attachmentB)?.path).toBe("secret/path.jpg");
    const still = db.query(`SELECT name FROM entities WHERE id = ?`).get(uuidToBytes(seed.entityB)) as { name: string };
    expect(still.name).toBe("Beta secret");

    const own = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seed.entityA}`, {
      headers: cookie(seed.ownerSession.raw),
    });
    expect(own.status).toBe(200);
    expect(((await own.json()) as { name: string }).name).toBe("Alpha lamp");

    const switched = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seed.entityB}`, {
      headers: { ...cookie(seed.ownerSession.raw), "x-tenant": seed.groupB },
    });
    expect(switched.status).toBe(403);

    const unauthenticated = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seed.entityA}`);
    expect(unauthenticated.status).toBe(401);
    expect(((await unauthenticated.json()) as { error: string }).error).toBe("authorization header or query is required");

    const badTenant = await app.request(`http://127.0.0.1:7745/api/v1/entities/${seed.entityA}`, {
      headers: { ...cookie(seed.ownerSession.raw), "x-tenant": "not-a-uuid" },
    });
    expect(badTenant.status).toBe(400);
  });

  test("queries refuse a missing group id and do not consult a global role column", () => {
    const db = openFixture();
    const seed = seedPair(db);
    expect(() => requireGroupId("")).toThrow(/authenticated group id/);
    expect(getEntityForGroup(db, seed.groupA, seed.entityB)).toBeNull();
    db.run(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner'`);
    expect(isOwnerOf(db, uuidToBytes(seed.memberA), seed.groupA)).toBe(false);
    expect(isOwnerOf(db, uuidToBytes(seed.ownerA), seed.groupA)).toBe(true);
  });
});

describe("owner versus member", () => {
  test("collection administration stays owner-only and invitations join as user", async () => {
    const db = openFixture();
    const seed = seedPair(db);
    const app = appFor(db);
    const member = cookie(seed.memberSession.raw);
    const owner = cookie(seed.ownerSession.raw);

    const rename = await app.request("http://127.0.0.1:7745/api/v1/groups", {
      method: "PUT",
      headers: { ...member, "content-type": "application/json" },
      body: JSON.stringify({ name: "member-controlled", currency: "eur" }),
    });
    expect(rename.status).toBe(403);
    expect(((await rename.json()) as { error: string }).error).toBe("only the owner of this collection can perform this action");
    const unchanged = db.query(`SELECT name FROM groups WHERE id = ?`).get(uuidToBytes(seed.groupA)) as { name: string };
    expect(unchanged.name).toBe("Alpha");

    const invite = await app.request("http://127.0.0.1:7745/api/v1/groups/invitations", {
      method: "POST",
      headers: { ...member, "content-type": "application/json" },
      body: JSON.stringify({ uses: 1 }),
    });
    expect(invite.status).toBe(403);
    expect(db.query(`SELECT COUNT(*) AS n FROM group_invitation_tokens`).get() as { n: number }).toEqual({ n: 0 });

    const created = await app.request("http://127.0.0.1:7745/api/v1/groups/invitations", {
      method: "POST",
      headers: { ...owner, "content-type": "application/json" },
      body: JSON.stringify({ uses: 1 }),
    });
    expect(created.status).toBe(201);
    const minted = (await created.json()) as { id: string; token: string };
    expect(minted.token.length).toBeGreaterThan(0);

    const revoke = await app.request(`http://127.0.0.1:7745/api/v1/groups/invitations/${minted.id}`, {
      method: "DELETE",
      headers: member,
    });
    expect(revoke.status).toBe(403);
    expect(db.query(`SELECT COUNT(*) AS n FROM group_invitation_tokens`).get() as { n: number }).toEqual({ n: 1 });

    const kick = await app.request(`http://127.0.0.1:7745/api/v1/groups/members/${seed.ownerA}`, {
      method: "DELETE",
      headers: member,
    });
    expect(kick.status).toBe(403);
    expect(isOwnerOf(db, uuidToBytes(seed.ownerA), seed.groupA)).toBe(true);

    const destroy = await app.request("http://127.0.0.1:7745/api/v1/groups", { method: "DELETE", headers: member });
    expect(destroy.status).toBe(403);
    expect(db.query(`SELECT id FROM groups WHERE id = ?`).get(uuidToBytes(seed.groupA))).toBeTruthy();

    const ownerRename = await app.request("http://127.0.0.1:7745/api/v1/groups", {
      method: "PUT",
      headers: { ...owner, "content-type": "application/json" },
      body: JSON.stringify({ name: "owner-renamed", currency: "eur" }),
    });
    expect(ownerRename.status).toBe(200);
    expect(((await ownerRename.json()) as { currency: string }).currency).toBe("EUR");

    const outsider = insertUser(db, { name: "Out", email: "out@beta.test", groupId: seed.groupB });
    const outsiderSession = createSession(db, uuidToBytes(outsider), false);
    const accepted = await app.request(`http://127.0.0.1:7745/api/v1/groups/invitations/${minted.token}`, {
      method: "POST",
      headers: cookie(outsiderSession.raw),
    });
    expect(accepted.status).toBe(200);
    expect(isOwnerOf(db, uuidToBytes(outsider), seed.groupA)).toBe(false);
    const role = db
      .query(`SELECT role FROM user_groups WHERE user_id = ? AND group_id = ?`)
      .get(uuidToBytes(outsider), uuidToBytes(seed.groupA)) as { role: string };
    expect(role.role).toBe("user");
  });
});

describe("cross-group references are not found", () => {
  test("create and patch refuse another group's parent, type, tag, item, and location", () => {
    const db = openFixture();
    const seed = seedPair(db);
    const tagB = crypto.randomUUID();
    db.run(
      `INSERT INTO tags (id, created_at, updated_at, name, group_tags) VALUES (?, ?, ?, 'foreign', ?)`,
      [uuidToBytes(tagB), sqliteNow(), sqliteNow(), uuidToBytes(seed.groupB)],
    );

    expect(() =>
      createEntityForGroup(db, seed.groupA, { name: "victim", entityTypeId: seed.typeA, parentId: seed.entityB }),
    ).toThrow(TenancyError);
    expect(() => createEntityForGroup(db, seed.groupA, { name: "victim", entityTypeId: seed.typeB })).toThrow(TenancyError);
    expect(() =>
      createEntityForGroup(db, seed.groupA, { name: "victim", entityTypeId: seed.typeA, tagIds: [tagB] }),
    ).toThrow(TenancyError);
    expect(() => createMaintenanceForGroup(db, seed.groupA, seed.entityB, { name: "nope" })).toThrow(TenancyError);
    expect(() => createTemplateForGroup(db, seed.groupA, { name: "tmpl", defaultLocationId: seed.locationB })).toThrow(
      TenancyError,
    );

    const victims = db.query(`SELECT COUNT(*) AS n FROM entities WHERE name = 'victim'`).get() as { n: number };
    expect(victims.n).toBe(0);
    const maint = db.query(`SELECT COUNT(*) AS n FROM maintenance_entries WHERE name = 'nope'`).get() as { n: number };
    expect(maint.n).toBe(0);
    const templates = db.query(`SELECT COUNT(*) AS n FROM entity_templates`).get() as { n: number };
    expect(templates.n).toBe(0);
  });
});
