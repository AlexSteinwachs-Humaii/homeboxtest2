import type { Context } from "hono";
import type { Database } from "bun:sqlite";

import { readAttachmentBytes, storageLayout, writeAttachmentBytes, attachmentRelativePath } from "../attachments/blob.ts";
import { renderThumbnail } from "../attachments/thumbnail.ts";
import { ensureDefaultEntityTypes } from "../auth/defaults.ts";
import { authorize, jsonError, type Actor } from "../auth/guard.ts";
import { checkPasswordHash, hashPassword } from "../auth/password.ts";
import {
  createEntityForGroup,
  createTagForGroup,
  deleteTagForGroup,
  getEntityForGroup,
  getExportForGroup,
  getGroup,
  getTagForGroup,
  isOwnerOf,
  listTagsForGroup,
  TenancyError,
} from "../auth/tenancy.ts";
import { generateApiKey } from "../auth/token.ts";
import { listEntities } from "../db/inventory.ts";
import { bytesToUuid, newUuidBytes, sqliteNow, uuidToBytes } from "../db/storage.ts";
import { publishEntityMutation, publishExportMutation, publishImportMutation, publishTagMutation, publishUserMutation } from "../events/bus.ts";
import { searchBarcode } from "./barcode.ts";
import { buildCollectionZip, groupReadyForImport, importCollectionZip, readExportArtifact, storeExportArtifact } from "./collection.ts";
import { exportEntitiesCsv, importEntitiesCsv } from "./csv.ts";
import { idPair, readUuid } from "./ids.ts";
import { labelPng, qrJpeg } from "./images.ts";
import { queryEntityList } from "./list.ts";
import { validateNotifierUrl } from "./notifier.ts";
import { presentEntity, presentSummary, presentTag } from "./present.ts";

type App = {
  get: Function;
  post: Function;
  put: Function;
  patch: Function;
  delete: Function;
};

export type ContractOptions = {
  demo: boolean;
  hostname: string;
  trustProxy: boolean;
  storageConnString: string;
  storagePrefixPath: string;
  env?: Record<string, string | undefined>;
};

function actorOr(c: Context, db: Database, owner = false): Actor | Response {
  return authorize(c.req.raw, db, { owner });
}

function fromError(err: unknown): Response {
  if (err instanceof TenancyError) return jsonError(err.status, err.message);
  console.warn(`[homebox] contract request failed: ${err instanceof Error ? err.message : err}`);
  return jsonError(500, err instanceof Error ? err.message : "Unknown Error");
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function hbUrl(c: Context, options: ContractOptions): string {
  if (options.hostname) {
    return options.hostname.startsWith("http") ? options.hostname.replace(/\/$/, "") : `http://${options.hostname}`;
  }
  const request = c.req.raw;
  if (options.trustProxy) {
    const forwarded = request.headers.get("x-forwarded-host");
    if (forwarded) return `http://${forwarded.split(",")[0].trim()}`;
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.protocol}//${url.host}`;
    } catch {
      /* fall through */
    }
  }
  const host = request.headers.get("host") ?? "127.0.0.1:7745";
  return `http://${host}`;
}

function layout(options: ContractOptions) {
  return storageLayout(options.storageConnString, options.storagePrefixPath);
}

export function mountContractRoutes(app: App, db: Database, options: ContractOptions): void {
  const env = options.env ?? process.env;

  app.get("/api/v1/users/self", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    return Response.json({ item: userOut(db, actor) });
  });

  app.put("/api/v1/users/self", async (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const body = await readJson(c);
    const name = typeof body.name === "string" ? body.name : undefined;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
    db.run(`UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), updated_at = ? WHERE id = ?`, [
      name ?? null,
      email ?? null,
      sqliteNow(),
      actor.userId,
    ]);
    publishUserMutation(actor.groupId);
    return Response.json({ item: { name: name ?? "", email: email ?? "" } });
  });

  app.delete("/api/v1/users/self", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    if (options.demo) return jsonError(403, "not allowed in demo mode");
    db.run(`DELETE FROM users WHERE id = ?`, [actor.userId]);
    return new Response(null, { status: 204 });
  });

  app.get("/api/v1/users/self/settings", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    return settingsResponse(db, actor.userId);
  });

  app.put("/api/v1/users/self/settings", async (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const body = await readJson(c);
    db.run(`UPDATE users SET settings = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(body), sqliteNow(), actor.userId]);
    publishUserMutation(actor.groupId);
    return settingsResponse(db, actor.userId);
  });

  app.put("/api/v1/users/self/change-password", async (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    if (options.demo) return jsonError(403, "not allowed in demo mode");
    const body = await readJson(c);
    const current = String(body.current ?? "");
    const next = String(body.new ?? "");
    if (next.length < 6) return jsonError(400, "password must be at least 6 characters");
    const row = db.query(`SELECT password FROM users WHERE id = ?`).get(actor.userId) as { password: string | null } | null;
    if (!row?.password || !(await checkPasswordHash(current, row.password))) return jsonError(400, "current password is incorrect");
    db.run(`UPDATE users SET password = ?, updated_at = ? WHERE id = ?`, [await hashPassword(next), sqliteNow(), actor.userId]);
    return new Response(null, { status: 204 });
  });

  app.get("/api/v1/users/self/api-keys", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const rows = db
      .query(`SELECT id, created_at, expires_at, last_used_at, name, user_id FROM api_keys WHERE user_id = ? OR user_id = ?`)
      .all(actor.userId, actor.userIdText) as Array<Record<string, unknown>>;
    return Response.json(rows.map((row) => apiKeyOut(row, actor.userIdText)));
  });

  app.post("/api/v1/users/self/api-keys", async (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const body = await readJson(c);
    const name = String(body.name ?? "").trim();
    if (!name) return jsonError(400, "name is required");
    const key = generateApiKey();
    const id = newUuidBytes();
    const now = sqliteNow();
    const expires = typeof body.expiresAt === "string" ? body.expiresAt : null;
    db.run(
      `INSERT INTO api_keys (id, created_at, updated_at, user_id, name, token, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, now, now, actor.userId, name, key.hash, expires],
    );
    return Response.json(
      { id: bytesToUuid(id), createdAt: now, expiresAt: expires, lastUsedAt: null, name, userId: actor.userIdText, token: key.raw },
      { status: 201 },
    );
  });

  app.delete("/api/v1/users/self/api-keys/:id", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const [bytes, text] = idPair(c.req.param("id"));
    const result = db.run(`DELETE FROM api_keys WHERE (id = ? OR id = ?) AND (user_id = ? OR user_id = ?)`, [
      bytes,
      text,
      actor.userId,
      actor.userIdText,
    ]);
    if (result.changes === 0) return jsonError(404, "Not Found");
    return new Response(null, { status: 204 });
  });

  app.get("/api/v1/groups/all", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    return Response.json(actor.groupIds.map((id) => getGroup(db, id)).filter(Boolean));
  });

  app.post("/api/v1/groups", async (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const body = await readJson(c);
    const name = String(body.name ?? "").trim();
    if (!name) return jsonError(400, "name is required");
    const id = newUuidBytes();
    const now = sqliteNow();
    db.run(`INSERT INTO groups (id, created_at, updated_at, name, currency) VALUES (?, ?, ?, ?, ?)`, [
      id,
      now,
      now,
      name,
      "usd",
    ]);
    db.run(`INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, ?)`, [actor.userId, id, "owner"]);
    ensureDefaultEntityTypes(db, id);
    return Response.json({ id: bytesToUuid(id), name, currency: "USD", createdAt: now, updatedAt: now }, { status: 201 });
  });

  app.get("/api/v1/groups/statistics/purchase-price", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const params = new URL(c.req.url).searchParams;
    const end = params.get("end") || new Date().toISOString().slice(0, 10);
    const start = params.get("start") || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return jsonError(400, "invalid date");
    const [bytes, text] = idPair(actor.groupId);
    const rows = db
      .query(
        `SELECT e.name, e.purchase_date, e.purchase_price FROM entities e
         JOIN entity_types t ON t.id = e.entity_type_entities
         WHERE (e.group_entities = ? OR e.group_entities = ?) AND t.is_location = 0
           AND e.purchase_date IS NOT NULL AND e.purchase_date >= ? AND e.purchase_date <= ?`,
      )
      .all(bytes, text, start, `${end}T23:59:59`) as Array<{ name: string; purchase_date: string; purchase_price: number }>;
    const entries = rows.map((row) => ({ date: row.purchase_date, name: row.name, value: row.purchase_price }));
    const valueAtStart = entries.filter((row) => String(row.date) <= start).reduce((sum, row) => sum + row.value, 0);
    const valueAtEnd = entries.reduce((sum, row) => sum + row.value, 0);
    return Response.json({ start, end, entries, valueAtStart, valueAtEnd });
  });

  app.get("/api/v1/groups/statistics/locations", (c: Context) => statsBy(c, db, "location"));
  app.get("/api/v1/groups/statistics/tags", (c: Context) => statsBy(c, db, "tag"));
  app.get("/api/v1/groups/statistics", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const [bytes, text] = idPair(actor.groupId);
    const items = count(
      db,
      `SELECT COUNT(*) AS n FROM entities e JOIN entity_types t ON t.id = e.entity_type_entities
       WHERE (e.group_entities = ? OR e.group_entities = ?) AND t.is_location = 0`,
      bytes,
      text,
    );
    const locations = count(
      db,
      `SELECT COUNT(*) AS n FROM entities e JOIN entity_types t ON t.id = e.entity_type_entities
       WHERE (e.group_entities = ? OR e.group_entities = ?) AND t.is_location = 1`,
      bytes,
      text,
    );
    const tags = count(db, `SELECT COUNT(*) AS n FROM tags WHERE group_tags = ? OR group_tags = ?`, bytes, text);
    const users = count(db, `SELECT COUNT(*) AS n FROM user_groups WHERE group_id = ? OR group_id = ?`, bytes, text);
    const warranty = count(
      db,
      `SELECT COUNT(*) AS n FROM entities WHERE (group_entities = ? OR group_entities = ?) AND (lifetime_warranty = 1 OR warranty_expires IS NOT NULL)`,
      bytes,
      text,
    );
    const price = db
      .query(
        `SELECT COALESCE(SUM(purchase_price * quantity), 0) AS n FROM entities e
         JOIN entity_types t ON t.id = e.entity_type_entities
         WHERE (e.group_entities = ? OR e.group_entities = ?) AND t.is_location = 0 AND e.sold_date IS NULL`,
      )
      .get(bytes, text) as { n: number };
    return Response.json({
      totalItems: items,
      totalLocations: locations,
      totalTags: tags,
      totalUsers: users,
      totalWithWarranty: warranty,
      totalItemPrice: price.n,
    });
  });

  app.post("/api/v1/actions/ensure-asset-ids", (c: Context) => action(c, db, (actor) => ensureAssetIds(db, actor.groupId)));
  app.post("/api/v1/actions/zero-item-time-fields", (c: Context) => action(c, db, (actor) => zeroDates(db, actor.groupId)));
  app.post("/api/v1/actions/ensure-import-refs", (c: Context) => action(c, db, (actor) => ensureImportRefs(db, actor.groupId)));
  app.post("/api/v1/actions/set-primary-photos", (c: Context) => action(c, db, (actor) => setPrimaryPhotos(db, actor.groupId)));
  app.post("/api/v1/actions/create-missing-thumbnails", async (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const completed = await createMissingThumbnails(db, actor.groupId, layout(options));
    return Response.json({ completed });
  });
  app.post("/api/v1/actions/wipe-inventory", async (c: Context) => {
    const actor = actorOr(c, db, true);
    if (actor instanceof Response) return actor;
    if (options.demo) return jsonError(403, "wipe inventory is not allowed in demo mode");
    const body = await readJson(c);
    const completed = wipeInventory(db, actor.groupId, {
      tags: body.wipeTags === true,
      locations: body.wipeLocations === true,
      maintenance: body.wipeMaintenance === true,
    });
    publishEntityMutation(actor.groupId);
    if (body.wipeTags === true) publishTagMutation(actor.groupId);
    return Response.json({ completed });
  });

  app.get("/api/v1/tags", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    return Response.json(listTagsForGroup(db, actor.groupId).map((tag) => presentTag(db, tag)));
  });
  app.get("/api/v1/tags/:id", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const tag = getTagForGroup(db, actor.groupId, c.req.param("id"));
    if (!tag) return jsonError(404, "Not Found");
    return Response.json(presentTag(db, tag));
  });

  app.get("/api/v1/entity-types", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    return Response.json(listTypes(db, actor.groupId));
  });
  app.post("/api/v1/entity-types", async (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    try {
      const body = await readJson(c);
      const id = insertType(db, actor.groupId, body);
      return Response.json(typeById(db, id), { status: 201 });
    } catch (err) {
      return fromError(err);
    }
  });
  app.put("/api/v1/entity-types/:id", async (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const id = c.req.param("id");
    if (!typeById(db, id, actor.groupId)) return jsonError(404, "Not Found");
    const body = await readJson(c);
    const [bytes, text] = idPair(id);
    db.run(`UPDATE entity_types SET name = ?, icon = ?, is_location = ?, updated_at = ? WHERE id = ? OR id = ?`, [
      String(body.name ?? ""),
      String(body.icon ?? ""),
      body.isLocation ? 1 : 0,
      sqliteNow(),
      bytes,
      text,
    ]);
    publishEntityMutation(actor.groupId);
    return Response.json(typeById(db, id));
  });
  app.delete("/api/v1/entity-types/:id", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const id = c.req.param("id");
    if (!typeById(db, id, actor.groupId)) return jsonError(404, "Not Found");
    const [bytes, text] = idPair(id);
    const used = db.query(`SELECT COUNT(*) AS n FROM entities WHERE entity_type_entities = ? OR entity_type_entities = ?`).get(bytes, text) as {
      n: number;
    };
    if (used.n > 0) return jsonError(409, "entity type is in use");
    db.run(`DELETE FROM entity_types WHERE id = ? OR id = ?`, [bytes, text]);
    return new Response(null, { status: 204 });
  });

  app.get("/api/v1/entities/fields", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const [bytes, text] = idPair(actor.groupId);
    const rows = db
      .query(
        `SELECT DISTINCT f.name FROM entity_fields f
         JOIN entities e ON e.id = f.entity_fields
         WHERE e.group_entities = ? OR e.group_entities = ? ORDER BY f.name`,
      )
      .all(bytes, text) as Array<{ name: string }>;
    return Response.json(rows.map((row) => row.name));
  });
  app.get("/api/v1/entities/fields/values", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const field = new URL(c.req.url).searchParams.get("field") ?? "";
    const [bytes, text] = idPair(actor.groupId);
    const rows = db
      .query(
        `SELECT DISTINCT f.text_value AS value FROM entity_fields f
         JOIN entities e ON e.id = f.entity_fields
         WHERE f.name = ? AND (e.group_entities = ? OR e.group_entities = ?) AND f.text_value IS NOT NULL`,
      )
      .all(field, bytes, text) as Array<{ value: string }>;
    return Response.json(rows.map((row) => row.value));
  });
  app.get("/api/v1/entities/tree", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const withItems = new URL(c.req.url).searchParams.get("withItems") === "true";
    return Response.json(entityTree(db, actor.groupId, withItems));
  });
  app.get("/api/v1/entities/export", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const csv = exportEntitiesCsv(db, actor.groupId, hbUrl(c, options));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv",
        "content-disposition": `attachment;filename=homebox-entities_${stamp}.csv`,
      },
    });
  });
  app.post("/api/v1/entities/import", async (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    try {
      const form = await c.req.formData();
      const file = form.get("csv");
      if (!(file instanceof File)) return jsonError(400, "csv file is required");
      importEntitiesCsv(db, actor.groupId, await file.text());
      publishEntityMutation(actor.groupId);
      publishTagMutation(actor.groupId);
      return new Response(null, { status: 204 });
    } catch (err) {
      return fromError(err);
    }
  });

  app.get("/api/v1/entities/:id/path", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const row = getEntityForGroup(db, actor.groupId, c.req.param("id"));
    if (!row) return jsonError(404, "Not Found");
    const path = [];
    let cursor: typeof row | null = row;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      path.push({ id: cursor.id, name: cursor.name, type: "location" });
      cursor = cursor.parentId ? getEntityForGroup(db, actor.groupId, cursor.parentId) : null;
    }
    path.reverse();
    return Response.json(path);
  });
  app.put("/api/v1/entities/:id", async (c: Context) => updateEntity(c, db));
  app.post("/api/v1/entities/:id/duplicate", async (c: Context) => duplicateEntity(c, db));
  app.get("/api/v1/entities/:id/maintenance", (c: Context) => maintenanceList(c, db, c.req.param("id")));

  app.get("/api/v1/templates", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    return Response.json(listTemplates(db, actor.groupId));
  });
  app.get("/api/v1/templates/:id", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const row = templateById(db, actor.groupId, c.req.param("id"));
    if (!row) return jsonError(404, "Not Found");
    return Response.json(row);
  });
  app.put("/api/v1/templates/:id", async (c: Context) => saveTemplate(c, db, c.req.param("id")));
  app.delete("/api/v1/templates/:id", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const [bytes, text] = idPair(c.req.param("id"));
    const [gidBytes, gidText] = idPair(actor.groupId);
    const result = db.run(
      `DELETE FROM entity_templates WHERE (id = ? OR id = ?) AND (group_entity_templates = ? OR group_entity_templates = ?)`,
      [bytes, text, gidBytes, gidText],
    );
    if (result.changes === 0) return jsonError(404, "Not Found");
    return new Response(null, { status: 204 });
  });
  app.post("/api/v1/templates/:id/create-item", async (c: Context) => createFromTemplate(c, db));

  app.get("/api/v1/maintenance", (c: Context) => maintenanceList(c, db));
  app.put("/api/v1/maintenance/:id", async (c: Context) => updateMaintenance(c, db));
  app.delete("/api/v1/maintenance/:id", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const [bytes, text] = idPair(c.req.param("id"));
    const [gidBytes, gidText] = idPair(actor.groupId);
    const result = db.run(
      `DELETE FROM maintenance_entries WHERE (id = ? OR id = ?) AND entity_id IN (SELECT id FROM entities WHERE group_entities = ? OR group_entities = ?)`,
      [bytes, text, gidBytes, gidText],
    );
    if (result.changes === 0) return jsonError(404, "Not Found");
    return new Response(null, { status: 204 });
  });

  app.get("/api/v1/notifiers", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    return Response.json(listNotifiers(db, actor));
  });
  app.post("/api/v1/notifiers/test", async (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const body = await readJson(c);
    try {
      await validateNotifierUrl(String(body.url ?? ""));
    } catch (err) {
      return jsonError(400, err instanceof Error ? err.message : "invalid notifier URL");
    }
    return new Response(null, { status: 200 });
  });
  app.post("/api/v1/notifiers", async (c: Context) => saveNotifier(c, db));
  app.put("/api/v1/notifiers/:id", async (c: Context) => saveNotifier(c, db, c.req.param("id")));
  app.delete("/api/v1/notifiers/:id", (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const [bytes, text] = idPair(c.req.param("id"));
    const result = db.run(`DELETE FROM notifiers WHERE (id = ? OR id = ?) AND (user_id = ? OR user_id = ?)`, [
      bytes,
      text,
      actor.userId,
      actor.userIdText,
    ]);
    if (result.changes === 0) return jsonError(404, "Not Found");
    return new Response(null, { status: 204 });
  });

  app.get("/api/v1/products/search-from-barcode", async (c: Context) => {
    const actor = actorOr(c, db);
    if (actor instanceof Response) return actor;
    const ean = new URL(c.req.url).searchParams.get("productEAN") ?? "";
    if (!ean || ean.length > 80) return jsonError(400, "productEAN is required");
    const hits = await searchBarcode(ean, env);
    return Response.json(hits);
  });

  app.get("/api/v1/qrcode", async (c: Context) => {
    const actor = authorize(c.req.raw, db, { anyRole: ["user", "attachments"] });
    if (actor instanceof Response) return actor;
    const data = new URL(c.req.url).searchParams.get("data") ?? "";
    if (!data || data.length > 4296) return jsonError(400, "data is required");
    const image = await qrJpeg(decodeURIComponent(data));
    return new Response(image, {
      headers: { "content-type": "image/jpeg", "content-disposition": "attachment; filename=qrcode.jpg" },
    });
  });

  app.get("/api/v1/labelmaker/entity/:id", (c: Context) => labelFor(c, db, options, "entity"));
  app.get("/api/v1/labelmaker/item/:id", (c: Context) => labelFor(c, db, options, "entity"));
  app.get("/api/v1/labelmaker/location/:id", (c: Context) => labelFor(c, db, options, "location"));
  app.get("/api/v1/labelmaker/asset/:id", (c: Context) => labelFor(c, db, options, "asset"));
  app.get("/api/v1/reporting/bill-of-materials", (c: Context) => billOfMaterials(c, db));

  app.post("/api/v1/group/exports", (c: Context) => startExport(c, db, options));
  app.get("/api/v1/group/exports/:id/download", (c: Context) => downloadExport(c, db, options));
  app.post("/api/v1/group/import", async (c: Context) => importGroup(c, db, options));

  app.get("/api/v1/assets/:id", (c: Context) => assetsById(c, db));
}

function userOut(db: Database, actor: Actor) {
  const row = db.query(`SELECT name, email, is_superuser, oidc_issuer, oidc_subject, default_group_id FROM users WHERE id = ?`).get(actor.userId) as
    | {
        name: string;
        email: string;
        is_superuser: number;
        oidc_issuer: string | null;
        oidc_subject: string | null;
        default_group_id: unknown;
      }
    | null;
  return {
    id: actor.userIdText,
    name: row?.name ?? "",
    email: row?.email ?? "",
    isSuperuser: row?.is_superuser === 1,
    oidcIssuer: row?.oidc_issuer ?? "",
    oidcSubject: row?.oidc_subject ?? "",
    defaultGroupId: readUuid(row?.default_group_id) ?? actor.groupId,
    groupIds: actor.groupIds,
  };
}

function settingsResponse(db: Database, userId: Uint8Array): Response {
  const row = db.query(`SELECT settings FROM users WHERE id = ?`).get(userId) as { settings: string | null } | null;
  let item: Record<string, unknown> = {};
  if (row?.settings) {
    try {
      item = JSON.parse(row.settings) as Record<string, unknown>;
    } catch {
      item = {};
    }
  }
  return Response.json({ item }, { headers: { "cache-control": "no-store" } });
}

function apiKeyOut(row: Record<string, unknown>, userId: string) {
  return {
    id: readUuid(row.id) ?? "",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    name: row.name,
    userId,
  };
}

function count(db: Database, sql: string, bytes: Uint8Array, text: string): number {
  return (db.query(sql).get(bytes, text) as { n: number }).n;
}

function statsBy(c: Context, db: Database, kind: "location" | "tag"): Response {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  const [bytes, text] = idPair(actor.groupId);
  if (kind === "tag") {
    const rows = db
      .query(
        `SELECT t.id, t.name, COALESCE(SUM(e.purchase_price * e.quantity), 0) AS total
         FROM tags t
         LEFT JOIN tag_entities te ON te.tag_id = t.id
         LEFT JOIN entities e ON e.id = te.entity_id
         WHERE t.group_tags = ? OR t.group_tags = ?
         GROUP BY t.id ORDER BY t.name`,
      )
      .all(bytes, text) as Array<{ id: unknown; name: string; total: number }>;
    return Response.json(rows.map((row) => ({ id: readUuid(row.id), name: row.name, total: row.total })));
  }
  const rows = db
    .query(
      `SELECT loc.id, loc.name, COALESCE(SUM(child.purchase_price * child.quantity), 0) AS total
       FROM entities loc
       JOIN entity_types lt ON lt.id = loc.entity_type_entities AND lt.is_location = 1
       LEFT JOIN entities child ON child.entity_children = loc.id
       WHERE loc.group_entities = ? OR loc.group_entities = ?
       GROUP BY loc.id ORDER BY loc.name`,
    )
    .all(bytes, text) as Array<{ id: unknown; name: string; total: number }>;
  return Response.json(rows.map((row) => ({ id: readUuid(row.id), name: row.name, total: row.total })));
}

function action(c: Context, db: Database, fn: (actor: Actor) => number): Response {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  return Response.json({ completed: fn(actor) });
}

function ensureAssetIds(db: Database, groupId: string): number {
  const [bytes, text] = idPair(groupId);
  const max = db
    .query(`SELECT COALESCE(MAX(asset_id), 0) AS n FROM entities WHERE group_entities = ? OR group_entities = ?`)
    .get(bytes, text) as { n: number };
  const rows = db
    .query(`SELECT id FROM entities WHERE (group_entities = ? OR group_entities = ?) AND asset_id <= 0`)
    .all(bytes, text) as Array<{ id: unknown }>;
  let next = max.n;
  for (const row of rows) {
    next += 1;
    db.run(`UPDATE entities SET asset_id = ? WHERE id = ?`, [next, row.id]);
  }
  if (rows.length) publishEntityMutation(groupId);
  return rows.length;
}

function zeroDates(db: Database, groupId: string): number {
  const [bytes, text] = idPair(groupId);
  const result = db.run(
    `UPDATE entities SET
       purchase_date = CASE WHEN purchase_date IS NULL THEN NULL ELSE substr(purchase_date, 1, 10) END,
       sold_date = CASE WHEN sold_date IS NULL THEN NULL ELSE substr(sold_date, 1, 10) END,
       warranty_expires = CASE WHEN warranty_expires IS NULL THEN NULL ELSE substr(warranty_expires, 1, 10) END
     WHERE group_entities = ? OR group_entities = ?`,
    [bytes, text],
  );
  return result.changes;
}

function ensureImportRefs(db: Database, groupId: string): number {
  const [bytes, text] = idPair(groupId);
  const rows = db
    .query(`SELECT id FROM entities WHERE (group_entities = ? OR group_entities = ?) AND (import_ref IS NULL OR import_ref = '')`)
    .all(bytes, text) as Array<{ id: unknown }>;
  for (const row of rows) db.run(`UPDATE entities SET import_ref = ? WHERE id = ?`, [bytesToUuid(newUuidBytes()), row.id]);
  return rows.length;
}

async function createMissingThumbnails(db: Database, groupId: string, files: ReturnType<typeof storageLayout>): Promise<number> {
  const [bytes, text] = idPair(groupId);
  const rows = db
    .query(
      `SELECT a.id, a.path, a.title FROM attachments a
       JOIN entities e ON e.id = a.entity_attachments
       WHERE a.type = 'photo' AND a.attachment_thumbnail IS NULL
         AND (e.group_entities = ? OR e.group_entities = ?)`,
    )
    .all(bytes, text) as Array<{ id: unknown; path: string; title: string }>;
  let completed = 0;
  for (const row of rows) {
    const content = readAttachmentBytes(files, row.path);
    if (!content) continue;
    try {
      const webp = await renderThumbnail(content, row.title, { enabled: true, width: 500, height: 500 });
      const thumbPath = attachmentRelativePath(groupId, webp);
      writeAttachmentBytes(files, thumbPath, webp);
      const thumbId = newUuidBytes();
      const now = sqliteNow();
      db.run(
        `INSERT INTO attachments (id, created_at, updated_at, type, "primary", path, title, mime_type)
         VALUES (?, ?, ?, 'thumbnail', 0, ?, ?, 'image/webp')`,
        [thumbId, now, now, thumbPath, `${row.title}-thumb`],
      );
      db.run(`UPDATE attachments SET attachment_thumbnail = ?, updated_at = ? WHERE id = ?`, [thumbId, now, row.id]);
      completed++;
    } catch (err) {
      console.warn(`[homebox] missing thumbnail skipped: ${err instanceof Error ? err.message : err}`);
    }
  }
  return completed;
}

function setPrimaryPhotos(db: Database, groupId: string): number {
  const [bytes, text] = idPair(groupId);
  const entities = db
    .query(`SELECT id FROM entities WHERE group_entities = ? OR group_entities = ?`)
    .all(bytes, text) as Array<{ id: unknown }>;
  let completed = 0;
  for (const entity of entities) {
    const primary = db
      .query(`SELECT id FROM attachments WHERE type = 'photo' AND "primary" = 1 AND entity_attachments = ?`)
      .get(entity.id) as { id: unknown } | null;
    if (primary) continue;
    const first = db
      .query(`SELECT id FROM attachments WHERE type = 'photo' AND entity_attachments = ? ORDER BY created_at LIMIT 1`)
      .get(entity.id) as { id: unknown } | null;
    if (!first) continue;
    db.run(`UPDATE attachments SET "primary" = 1 WHERE id = ?`, [first.id]);
    completed++;
  }
  return completed;
}

function wipeInventory(db: Database, groupId: string, flags: { tags: boolean; locations: boolean; maintenance: boolean }): number {
  const [bytes, text] = idPair(groupId);
  const items = db
    .query(
      `SELECT e.id FROM entities e JOIN entity_types t ON t.id = e.entity_type_entities
       WHERE (e.group_entities = ? OR e.group_entities = ?) AND t.is_location = 0`,
    )
    .all(bytes, text) as Array<{ id: unknown }>;
  for (const item of items) db.run(`DELETE FROM entities WHERE id = ?`, [item.id]);
  if (flags.maintenance) {
    db.run(
      `DELETE FROM maintenance_entries WHERE entity_id IN (SELECT id FROM entities WHERE group_entities = ? OR group_entities = ?)`,
      [bytes, text],
    );
  }
  if (flags.locations) db.run(`DELETE FROM entities WHERE group_entities = ? OR group_entities = ?`, [bytes, text]);
  if (flags.tags) db.run(`DELETE FROM tags WHERE group_tags = ? OR group_tags = ?`, [bytes, text]);
  return items.length;
}

function listTypes(db: Database, groupId: string) {
  const [bytes, text] = idPair(groupId);
  const rows = db
    .query(
      `SELECT id, name, description, icon, is_location, created_at, updated_at, entity_type_default_template
       FROM entity_types WHERE group_entity_types = ? OR group_entity_types = ? ORDER BY name`,
    )
    .all(bytes, text) as Array<Record<string, unknown>>;
  return rows.map((row) => typeSummary(row));
}

function typeSummary(row: Record<string, unknown>) {
  return {
    id: readUuid(row.id) ?? "",
    name: row.name,
    description: row.description ?? "",
    icon: row.icon ?? "",
    isLocation: row.is_location === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    defaultTemplateId: readUuid(row.entity_type_default_template) ?? "",
    defaultTemplate: { id: "", name: "", description: "", createdAt: "", updatedAt: "" },
  };
}

function typeById(db: Database, id: string, groupId?: string) {
  const [bytes, text] = idPair(id);
  const row = db
    .query(
      `SELECT id, name, description, icon, is_location, created_at, updated_at, entity_type_default_template, group_entity_types
       FROM entity_types WHERE id = ? OR id = ?`,
    )
    .get(bytes, text) as Record<string, unknown> | null;
  if (!row) return null;
  if (groupId && readUuid(row.group_entity_types) !== groupId) return null;
  return typeSummary(row);
}

function insertType(db: Database, groupId: string, body: Record<string, unknown>): string {
  const id = newUuidBytes();
  const now = sqliteNow();
  db.run(
    `INSERT INTO entity_types (id, created_at, updated_at, name, description, is_location, icon, group_entity_types)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, now, now, String(body.name ?? ""), "", body.isLocation ? 1 : 0, String(body.icon ?? ""), uuidToBytes(groupId)],
  );
  publishEntityMutation(groupId);
  return bytesToUuid(id);
}

function entityTree(db: Database, groupId: string, withItems: boolean) {
  const locations = listEntitiesSafe(db, groupId, true);
  const items = withItems ? listEntitiesSafe(db, groupId, false) : [];
  const nodes = new Map<string, { id: string; name: string; type: string; parentId: string | null; children: unknown[] }>();
  for (const row of locations) nodes.set(row.id, { id: row.id, name: row.name, type: "location", parentId: row.parentId, children: [] });
  for (const row of items) nodes.set(row.id, { id: row.id, name: row.name, type: "item", parentId: row.parentId, children: [] });
  const roots: unknown[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push({ id: node.id, name: node.name, type: node.type, children: node.children });
    else if (node.type === "location" || !node.parentId) roots.push({ id: node.id, name: node.name, type: node.type, children: node.children });
  }
  return roots;
}

function listEntitiesSafe(db: Database, groupId: string, isLocation: boolean) {
  return listEntities(db, { groupId, isLocation });
}

async function updateEntity(c: Context, db: Database): Promise<Response> {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  const id = c.req.param("id");
  if (!getEntityForGroup(db, actor.groupId, id)) return jsonError(404, "Not Found");
  const body = await readJson(c);
  const [bytes, text] = idPair(id);
  db.run(
    `UPDATE entities SET name = ?, description = ?, notes = ?, quantity = ?, insured = ?, archived = ?,
       lifetime_warranty = ?, manufacturer = ?, model_number = ?, serial_number = ?,
       purchase_price = ?, sold_price = ?, purchase_from = ?, purchase_date = ?, warranty_expires = ?,
       warranty_details = ?, sold_date = ?, sold_to = ?, sold_notes = ?, sync_child_entity_locations = ?,
       entity_type_entities = COALESCE(?, entity_type_entities), entity_children = ?, updated_at = ?
     WHERE id = ? OR id = ?`,
    [
      String(body.name ?? ""),
      String(body.description ?? ""),
      String(body.notes ?? ""),
      Number(body.quantity ?? 1),
      body.insured ? 1 : 0,
      body.archived ? 1 : 0,
      body.lifetimeWarranty ? 1 : 0,
      body.manufacturer ?? null,
      body.modelNumber ?? null,
      body.serialNumber ?? null,
      Number(body.purchasePrice ?? 0),
      Number(body.soldPrice ?? 0),
      body.purchaseFrom ?? null,
      body.purchaseDate || null,
      body.warrantyExpires || null,
      body.warrantyDetails ?? null,
      body.soldDate || null,
      body.soldTo ?? null,
      body.soldNotes ?? null,
      body.syncChildEntityLocations ? 1 : 0,
      typeof body.entityTypeId === "string" ? uuidToBytes(body.entityTypeId) : null,
      typeof body.parentId === "string" && body.parentId ? uuidToBytes(body.parentId) : null,
      sqliteNow(),
      bytes,
      text,
    ],
  );
  if (Array.isArray(body.tagIds)) {
    db.run(`DELETE FROM tag_entities WHERE entity_id = ? OR entity_id = ?`, [bytes, text]);
    for (const tagId of body.tagIds) {
      if (typeof tagId === "string") db.run(`INSERT INTO tag_entities (tag_id, entity_id) VALUES (?, ?)`, [uuidToBytes(tagId), uuidToBytes(id)]);
    }
  }
  publishEntityMutation(actor.groupId);
  return Response.json(presentEntity(db, actor.groupId, id));
}

async function duplicateEntity(c: Context, db: Database): Promise<Response> {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  const source = getEntityForGroup(db, actor.groupId, c.req.param("id"));
  if (!source) return jsonError(404, "Not Found");
  const body = await readJson(c);
  const prefix = typeof body.copyPrefix === "string" ? body.copyPrefix : "Copy of ";
  const id = createEntityForGroup(db, actor.groupId, {
    name: `${prefix}${source.name}`,
    entityTypeId: source.entityTypeId,
    parentId: source.parentId,
  });
  const [srcBytes, srcText] = idPair(source.id);
  const [dstBytes, dstText] = idPair(id);
  db.run(
    `UPDATE entities SET description = (SELECT description FROM entities WHERE id = ? OR id = ?),
       notes = (SELECT notes FROM entities WHERE id = ? OR id = ?),
       quantity = ?, manufacturer = ?, model_number = ?, serial_number = ?
     WHERE id = ? OR id = ?`,
    [srcBytes, srcText, srcBytes, srcText, source.quantity, source.manufacturer, source.modelNumber, source.serialNumber, dstBytes, dstText],
  );
  if (body.copyCustomFields) {
    const fields = db.query(`SELECT name, type, text_value, number_value, boolean_value, time_value FROM entity_fields WHERE entity_fields = ? OR entity_fields = ?`).all(srcBytes, srcText) as Array<Record<string, unknown>>;
    for (const field of fields) {
      db.run(
        `INSERT INTO entity_fields (id, created_at, updated_at, name, type, text_value, number_value, boolean_value, time_value, entity_fields)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newUuidBytes(), sqliteNow(), sqliteNow(), field.name, field.type, field.text_value, field.number_value, field.boolean_value, field.time_value, uuidToBytes(id)],
      );
    }
  }
  publishEntityMutation(actor.groupId);
  return Response.json(presentEntity(db, actor.groupId, id), { status: 201 });
}

function maintenanceList(c: Context, db: Database, entityId?: string): Response {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  const [bytes, text] = idPair(actor.groupId);
  const status = new URL(c.req.url).searchParams.get("status");
  let sql = `SELECT m.id, m.name, m.description, m.cost, m.date, m.scheduled_date, m.entity_id, e.name AS item_name
    FROM maintenance_entries m JOIN entities e ON e.id = m.entity_id
    WHERE e.group_entities = ? OR e.group_entities = ?`;
  const params: unknown[] = [bytes, text];
  if (entityId) {
    const [idBytes, idText] = idPair(entityId);
    sql += ` AND (m.entity_id = ? OR m.entity_id = ?)`;
    params.push(idBytes, idText);
  }
  const rows = db.query(sql).all(...params) as Array<Record<string, unknown>>;
  const filtered = rows.filter((row) => {
    if (status === "completed") return Boolean(row.date);
    if (status === "scheduled") return Boolean(row.scheduled_date) && !row.date;
    return true;
  });
  return Response.json(
    filtered.map((row) => ({
      id: readUuid(row.id),
      name: row.name,
      description: row.description ?? "",
      cost: String(row.cost ?? 0),
      completedDate: row.date ?? "",
      scheduledDate: row.scheduled_date ?? "",
      itemID: readUuid(row.entity_id),
      itemName: row.item_name,
    })),
  );
}

async function updateMaintenance(c: Context, db: Database): Promise<Response> {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  const id = c.req.param("id");
  const [bytes, text] = idPair(id);
  const [gidBytes, gidText] = idPair(actor.groupId);
  const existing = db
    .query(
      `SELECT m.id FROM maintenance_entries m JOIN entities e ON e.id = m.entity_id
       WHERE (m.id = ? OR m.id = ?) AND (e.group_entities = ? OR e.group_entities = ?)`,
    )
    .get(bytes, text, gidBytes, gidText);
  if (!existing) return jsonError(404, "Not Found");
  const body = await readJson(c);
  db.run(`UPDATE maintenance_entries SET name = ?, description = ?, cost = ?, date = ?, scheduled_date = ?, updated_at = ? WHERE id = ? OR id = ?`, [
    String(body.name ?? ""),
    body.description ?? null,
    Number(body.cost ?? 0),
    body.completedDate || null,
    body.scheduledDate || null,
    sqliteNow(),
    bytes,
    text,
  ]);
  return Response.json({
    id,
    name: String(body.name ?? ""),
    description: String(body.description ?? ""),
    cost: String(body.cost ?? 0),
    completedDate: body.completedDate ?? "",
    scheduledDate: body.scheduledDate ?? "",
  });
}

function listTemplates(db: Database, groupId: string) {
  const [bytes, text] = idPair(groupId);
  const rows = db
    .query(`SELECT id, name, description, created_at, updated_at FROM entity_templates WHERE group_entity_templates = ? OR group_entity_templates = ?`)
    .all(bytes, text) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: readUuid(row.id),
    name: row.name,
    description: row.description ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function templateById(db: Database, groupId: string, id: string) {
  const [bytes, text] = idPair(id);
  const [gidBytes, gidText] = idPair(groupId);
  const row = db
    .query(
      `SELECT * FROM entity_templates WHERE (id = ? OR id = ?) AND (group_entity_templates = ? OR group_entity_templates = ?)`,
    )
    .get(bytes, text, gidBytes, gidText) as Record<string, unknown> | null;
  if (!row) return null;
  const fields = db
    .query(`SELECT id, name, type, text_value, number_value, boolean_value, time_value FROM template_fields WHERE entity_template_fields = ? OR entity_template_fields = ?`)
    .all(bytes, text) as Array<Record<string, unknown>>;
  return {
    id: readUuid(row.id),
    name: row.name,
    description: row.description ?? "",
    notes: row.notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    defaultName: row.default_name ?? "",
    defaultDescription: row.default_description ?? "",
    defaultManufacturer: row.default_manufacturer ?? "",
    defaultModelNumber: row.default_model_number ?? "",
    defaultQuantity: row.default_quantity ?? 1,
    defaultInsured: row.default_insured === 1,
    defaultLifetimeWarranty: row.default_lifetime_warranty === 1,
    defaultWarrantyDetails: row.default_warranty_details ?? "",
    includeWarrantyFields: row.include_warranty_fields === 1,
    includePurchaseFields: row.include_purchase_fields === 1,
    includeSoldFields: row.include_sold_fields === 1,
    defaultLocation: { id: readUuid(row.entity_template_location) ?? "", name: "" },
    defaultTags: [],
    fields: fields.map((field) => ({
      id: readUuid(field.id),
      name: field.name,
      type: field.type,
      textValue: field.text_value ?? "",
      numberValue: field.number_value ?? 0,
      booleanValue: field.boolean_value === 1,
      timeValue: field.time_value ?? "",
    })),
  };
}

async function saveTemplate(c: Context, db: Database, id: string): Promise<Response> {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  if (!templateById(db, actor.groupId, id)) return jsonError(404, "Not Found");
  const body = await readJson(c);
  const [bytes, text] = idPair(id);
  db.run(
    `UPDATE entity_templates SET name = ?, description = ?, notes = ?, default_name = ?, default_description = ?,
       default_manufacturer = ?, default_model_number = ?, default_quantity = ?, default_insured = ?,
       default_lifetime_warranty = ?, default_warranty_details = ?, include_warranty_fields = ?,
       include_purchase_fields = ?, include_sold_fields = ?, updated_at = ?
     WHERE id = ? OR id = ?`,
    [
      String(body.name ?? ""),
      body.description ?? null,
      body.notes ?? null,
      body.defaultName ?? null,
      body.defaultDescription ?? null,
      body.defaultManufacturer ?? null,
      body.defaultModelNumber ?? null,
      Number(body.defaultQuantity ?? 1),
      body.defaultInsured ? 1 : 0,
      body.defaultLifetimeWarranty ? 1 : 0,
      body.defaultWarrantyDetails ?? null,
      body.includeWarrantyFields ? 1 : 0,
      body.includePurchaseFields ? 1 : 0,
      body.includeSoldFields ? 1 : 0,
      sqliteNow(),
      bytes,
      text,
    ],
  );
  return Response.json(templateById(db, actor.groupId, id));
}

async function createFromTemplate(c: Context, db: Database): Promise<Response> {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  const template = templateById(db, actor.groupId, c.req.param("id"));
  if (!template) return jsonError(404, "Not Found");
  const body = await readJson(c);
  const types = listTypes(db, actor.groupId);
  const itemType = types.find((type) => !type.isLocation);
  if (!itemType) return jsonError(400, "no item entity type");
  const id = createEntityForGroup(db, actor.groupId, {
    name: String(body.name ?? template.defaultName ?? template.name),
    entityTypeId: itemType.id,
    parentId: template.defaultLocation.id || null,
  });
  publishEntityMutation(actor.groupId);
  return Response.json(presentEntity(db, actor.groupId, id), { status: 201 });
}

function listNotifiers(db: Database, actor: Actor) {
  const [gidBytes, gidText] = idPair(actor.groupId);
  const rows = db
    .query(
      `SELECT id, name, url, is_active, created_at, updated_at, group_id, user_id FROM notifiers
       WHERE (group_id = ? OR group_id = ?) AND (user_id = ? OR user_id = ?)`,
    )
    .all(gidBytes, gidText, actor.userId, actor.userIdText) as Array<Record<string, unknown>>;
  return rows.map(notifierOut);
}

function notifierOut(row: Record<string, unknown>) {
  return {
    id: readUuid(row.id),
    name: row.name,
    url: row.url,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    groupId: readUuid(row.group_id),
    userId: readUuid(row.user_id),
  };
}

async function saveNotifier(c: Context, db: Database, id?: string): Promise<Response> {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  const body = await readJson(c);
  const name = String(body.name ?? "").trim();
  if (!name) return jsonError(400, "name is required");
  if (typeof body.url === "string" && body.url) {
    try {
      await validateNotifierUrl(body.url);
    } catch (err) {
      return jsonError(400, err instanceof Error ? err.message : "invalid notifier URL");
    }
  }
  const now = sqliteNow();
  if (!id) {
    if (typeof body.url !== "string" || !body.url) return jsonError(400, "url is required");
    const created = newUuidBytes();
    db.run(
      `INSERT INTO notifiers (id, created_at, updated_at, name, url, is_active, group_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [created, now, now, name, body.url, body.isActive === false ? 0 : 1, uuidToBytes(actor.groupId), actor.userId],
    );
    const row = db.query(`SELECT id, name, url, is_active, created_at, updated_at, group_id, user_id FROM notifiers WHERE id = ?`).get(created) as Record<string, unknown>;
    return Response.json(notifierOut(row), { status: 201 });
  }
  const [bytes, text] = idPair(id);
  const existing = db
    .query(`SELECT id FROM notifiers WHERE (id = ? OR id = ?) AND (user_id = ? OR user_id = ?)`)
    .get(bytes, text, actor.userId, actor.userIdText);
  if (!existing) return jsonError(404, "Not Found");
  db.run(`UPDATE notifiers SET name = ?, url = COALESCE(?, url), is_active = ?, updated_at = ? WHERE id = ? OR id = ?`, [
    name,
    typeof body.url === "string" ? body.url : null,
    body.isActive === false ? 0 : 1,
    now,
    bytes,
    text,
  ]);
  const row = db.query(`SELECT id, name, url, is_active, created_at, updated_at, group_id, user_id FROM notifiers WHERE id = ? OR id = ?`).get(bytes, text) as Record<string, unknown>;
  return Response.json(notifierOut(row));
}

async function labelFor(c: Context, db: Database, options: ContractOptions, kind: "entity" | "location" | "asset"): Promise<Response> {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  const base = hbUrl(c, options);
  if (kind === "asset") {
    const assetId = Number(c.req.param("id").replaceAll("-", ""));
    if (!Number.isFinite(assetId)) return jsonError(404, "failed to find asset id");
    const [bytes, text] = idPair(actor.groupId);
    const row = db
      .query(`SELECT id, name, asset_id FROM entities WHERE asset_id = ? AND (group_entities = ? OR group_entities = ?)`)
      .get(assetId, bytes, text) as { id: unknown; name: string; asset_id: number } | null;
    if (!row) return jsonError(404, "failed to find asset id");
    const label = await labelPng(formatAsset(row.asset_id), row.name, `${base}/a/${formatAsset(row.asset_id)}`);
    return new Response(label, { headers: { "content-type": "image/png" } });
  }
  const entity = getEntityForGroup(db, actor.groupId, c.req.param("id"));
  if (!entity) return jsonError(404, "Not Found");
  if (kind === "location" && !entity.isLocation) return jsonError(404, "Not Found");
  const url = kind === "location" ? `${base}/location/${entity.id}` : `${base}/item/${entity.id}`;
  const description = kind === "location" ? "Homebox Location" : entity.parentId ? `Location: ${getEntityForGroup(db, actor.groupId, entity.parentId)?.name ?? ""}` : "";
  const label = await labelPng(entity.name, description, url);
  return new Response(label, { headers: { "content-type": "image/png" } });
}

function formatAsset(value: number): string {
  const padded = String(value).padStart(6, "0");
  return `${padded.slice(0, 3)}-${padded.slice(3)}`;
}

function billOfMaterials(c: Context, db: Database): Response {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  const rows = listEntitiesSafe(db, actor.groupId, false);
  const header = ["Purchase Date", "Name", "Description", "Manufacturer", "Serial Number", "Model Number", "Quantity", "Price", "Total Price"];
  const body = rows.map((row) =>
    [row.purchaseDate ?? "", row.name, row.description ?? "", row.manufacturer ?? "", row.serialNumber ?? "", row.modelNumber ?? "", String(row.quantity), String(row.purchasePrice), String(row.purchasePrice * row.quantity)]
      .map((value) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value))
      .join(","),
  );
  return new Response([header.join(","), ...body].join("\n"), {
    headers: { "content-type": "text/csv", "content-disposition": "attachment;filename=bill-of-materials.csv" },
  });
}

function startExport(c: Context, db: Database, options: ContractOptions): Response {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  const id = bytesToUuid(newUuidBytes());
  const now = sqliteNow();
  const built = buildCollectionZip(db, actor.groupId, id, layout(options));
  storeExportArtifact(layout(options), built.artifactPath, built.bytes);
  db.run(
    `INSERT INTO exports (id, created_at, updated_at, kind, status, progress, artifact_path, size_bytes, group_id)
     VALUES (?, ?, ?, 'export', 'completed', 100, ?, ?, ?)`,
    [uuidToBytes(id), now, now, built.artifactPath, built.bytes.byteLength, uuidToBytes(actor.groupId)],
  );
  publishExportMutation(actor.groupId);
  const row = getExportForGroup(db, actor.groupId, id);
  return Response.json({ ...row, createdAt: now, updatedAt: now, status: "completed", progress: 100, sizeBytes: built.bytes.byteLength, artifactPath: built.artifactPath }, { status: 202 });
}

function downloadExport(c: Context, db: Database, options: ContractOptions): Response {
  const actor = actorOr(c, db);
  if (actor instanceof Response) return actor;
  const row = getExportForGroup(db, actor.groupId, c.req.param("id"));
  if (!row) return jsonError(404, "Not Found");
  if (row.status !== "completed" || !row.artifactPath) return jsonError(409, "export not ready");
  if (!row.artifactPath.startsWith(`${actor.groupId}/exports/`)) return jsonError(403, "artifact outside group prefix");
  const bytes = readExportArtifact(layout(options), row.artifactPath);
  if (!bytes) return jsonError(404, "Not Found");
  return new Response(bytes, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="homebox-export-${row.id}.zip"`,
      "content-length": String(bytes.byteLength),
    },
  });
}

async function importGroup(c: Context, db: Database, options: ContractOptions): Promise<Response> {
  const actor = actorOr(c, db, true);
  if (actor instanceof Response) return actor;
  if (options.demo) return jsonError(403, "import is not allowed in demo mode");
  if (!isOwnerOf(db, actor.userId, actor.groupId)) return jsonError(403, "only group owners can import");
  if (!groupReadyForImport(db, actor.groupId)) {
    return jsonError(409, "import requires a collection with no user-created items, tags, templates, notifiers, or custom types");
  }
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "file is required");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = bytesToUuid(newUuidBytes());
  const now = sqliteNow();
  const uploadKey = `${actor.groupId}/imports/${id}.zip`;
  storeExportArtifact(layout(options), uploadKey, bytes);
  db.run(
    `INSERT INTO exports (id, created_at, updated_at, kind, status, progress, artifact_path, size_bytes, group_id)
     VALUES (?, ?, ?, 'import', 'running', 10, ?, ?, ?)`,
    [uuidToBytes(id), now, now, uploadKey, bytes.byteLength, uuidToBytes(actor.groupId)],
  );
  try {
    importCollectionZip(db, actor.groupId, actor.userIdText, bytes, layout(options));
    db.run(`UPDATE exports SET status = 'completed', progress = 100, updated_at = ? WHERE id = ?`, [sqliteNow(), uuidToBytes(id)]);
  } catch (err) {
    db.run(`UPDATE exports SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`, [
      err instanceof Error ? err.message.slice(0, 1000) : "import failed",
      sqliteNow(),
      uuidToBytes(id),
    ]);
    return fromError(err);
  }
  publishImportMutation(actor.groupId);
  const row = getExportForGroup(db, actor.groupId, id);
  return Response.json({ ...row, createdAt: now, updatedAt: sqliteNow() }, { status: 202 });
}

function assetsById(c: Context, db: Database): Response {
  const actor = authorize(c.req.raw, db, { anyRole: ["user", "attachments"] });
  if (actor instanceof Response) return actor;
  const assetId = Number(c.req.param("id").replaceAll("-", ""));
  if (!Number.isFinite(assetId) || assetId <= 0) return jsonError(404, "Not Found");
  const page = Number(new URL(c.req.url).searchParams.get("page") ?? -1);
  const pageSize = Number(new URL(c.req.url).searchParams.get("pageSize") ?? -1);
  const [bytes, text] = idPair(actor.groupId);
  const rows = db
    .query(`SELECT id FROM entities WHERE asset_id = ? AND (group_entities = ? OR group_entities = ?)`)
    .all(assetId, bytes, text) as Array<{ id: unknown }>;
  const items = rows
    .map((row) => readUuid(row.id))
    .filter((id): id is string => Boolean(id))
    .map((id) => getEntityForGroup(db, actor.groupId, id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => presentSummary(db, row));
  const size = pageSize > 0 ? pageSize : items.length;
  const start = page > 0 ? (page - 1) * size : 0;
  return Response.json({ items: items.slice(start, start + size), page, pageSize, total: items.length });
}

export { queryEntityList, presentEntity, presentTag };
