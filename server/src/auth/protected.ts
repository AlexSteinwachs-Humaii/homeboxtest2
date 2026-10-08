import type { Context } from "hono";
import type { Database } from "bun:sqlite";

import { formatSqliteDateTime } from "../db/storage.ts";
import { authorize, jsonError, type Actor } from "./guard.ts";
import { isSupportedCurrency } from "./currencies.ts";
import {
  acceptInvitation,
  createEntityForGroup,
  createInvitation,
  createMaintenanceForGroup,
  createTemplateForGroup,
  deleteAttachmentForGroup,
  deleteExportForGroup,
  deleteGroup,
  deleteInvitation,
  getAttachmentForGroup,
  getEntityForGroup,
  getExportForGroup,
  getGroup,
  listAttachmentsForEntity,
  listEntitiesForGroup,
  listExportsForGroup,
  listInvitations,
  listMembers,
  patchEntityTagsForGroup,
  removeMember,
  renameEntityForGroup,
  TenancyError,
  updateGroup,
} from "./tenancy.ts";

type App = {
  get: Function;
  post: Function;
  put: Function;
  patch: Function;
  delete: Function;
};

function actorOrResponse(c: Context, db: Database, owner = false, anyRole?: string[]): Actor | Response {
  return authorize(c.req.raw, db, { owner, anyRole });
}

function fromTenancy(err: unknown): Response {
  if (err instanceof TenancyError) return jsonError(err.status, err.message);
  console.warn(`[homebox] tenancy request failed: ${err instanceof Error ? err.message : err}`);
  return jsonError(500, "Unknown Error");
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  return (await c.req.json()) as Record<string, unknown>;
}

export function mountProtectedRoutes(app: App, db: Database): void {
  app.get("/api/v1/entities", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    const location = new URL(c.req.url).searchParams.get("location");
    const isLocation = location === null ? undefined : location === "true" || location === "1";
    return Response.json(listEntitiesForGroup(db, actor.groupId, isLocation));
  });

  app.post("/api/v1/entities", async (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    try {
      const body = await readJson(c);
      const id = createEntityForGroup(db, actor.groupId, {
        name: String(body.name ?? ""),
        entityTypeId: String(body.entityTypeId ?? ""),
        parentId: typeof body.parentId === "string" ? body.parentId : null,
        tagIds: Array.isArray(body.tagIds) ? body.tagIds.map(String) : [],
      });
      const row = getEntityForGroup(db, actor.groupId, id);
      return Response.json(row, { status: 201 });
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.get("/api/v1/entities/:id", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    const row = getEntityForGroup(db, actor.groupId, c.req.param("id"));
    if (!row) return jsonError(404, "Not Found");
    return Response.json(row);
  });

  app.patch("/api/v1/entities/:id", async (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    try {
      const body = await readJson(c);
      const id = c.req.param("id");
      if (typeof body.name === "string") {
        if (!renameEntityForGroup(db, actor.groupId, id, body.name)) return jsonError(404, "Not Found");
      }
      if (Array.isArray(body.tagIds)) patchEntityTagsForGroup(db, actor.groupId, id, body.tagIds.map(String));
      const row = getEntityForGroup(db, actor.groupId, id);
      if (!row) return jsonError(404, "Not Found");
      return Response.json(row);
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.get("/api/v1/entities/:id/attachments", (c: Context) => {
    const actor = actorOrResponse(c, db, false, ["user", "attachments"]);
    if (actor instanceof Response) return actor;
    try {
      return Response.json(listAttachmentsForEntity(db, actor.groupId, c.req.param("id")));
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.get("/api/v1/entities/:id/attachments/:attachment_id", (c: Context) => {
    const actor = actorOrResponse(c, db, false, ["user", "attachments"]);
    if (actor instanceof Response) return actor;
    const entity = getEntityForGroup(db, actor.groupId, c.req.param("id"));
    const row = getAttachmentForGroup(db, actor.groupId, c.req.param("attachment_id"));
    if (!entity || !row || row.entityId !== entity.id) return jsonError(404, "Not Found");
    return Response.json(row);
  });

  app.delete("/api/v1/entities/:id/attachments/:attachment_id", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    const entity = getEntityForGroup(db, actor.groupId, c.req.param("id"));
    const row = getAttachmentForGroup(db, actor.groupId, c.req.param("attachment_id"));
    if (!entity || !row || row.entityId !== entity.id) return jsonError(404, "Not Found");
    deleteAttachmentForGroup(db, actor.groupId, row.id);
    return new Response(null, { status: 204 });
  });

  app.post("/api/v1/entities/:id/maintenance", async (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    try {
      const body = await readJson(c);
      const id = createMaintenanceForGroup(db, actor.groupId, c.req.param("id"), { name: String(body.name ?? "") });
      return Response.json({ id }, { status: 201 });
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.get("/api/v1/assets/:id", (c: Context) => {
    const actor = actorOrResponse(c, db, false, ["user", "attachments"]);
    if (actor instanceof Response) return actor;
    const row = getAttachmentForGroup(db, actor.groupId, c.req.param("id"));
    if (!row) return jsonError(404, "Not Found");
    return Response.json(row);
  });

  app.get("/api/v1/group/exports", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    return Response.json(listExportsForGroup(db, actor.groupId));
  });

  app.get("/api/v1/group/exports/:id", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    const row = getExportForGroup(db, actor.groupId, c.req.param("id"));
    if (!row) return jsonError(404, "Not Found");
    return Response.json(row);
  });

  app.delete("/api/v1/group/exports/:id", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    if (!deleteExportForGroup(db, actor.groupId, c.req.param("id"))) return jsonError(404, "Not Found");
    return new Response(null, { status: 204 });
  });

  app.post("/api/v1/templates", async (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    try {
      const body = await readJson(c);
      const id = createTemplateForGroup(db, actor.groupId, {
        name: String(body.name ?? ""),
        defaultLocationId: typeof body.defaultLocationId === "string" ? body.defaultLocationId : null,
      });
      return Response.json({ id }, { status: 201 });
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.get("/api/v1/groups", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    const group = getGroup(db, actor.groupId);
    if (!group) return jsonError(404, "Not Found");
    return Response.json(group);
  });

  app.put("/api/v1/groups", async (c: Context) => {
    const actor = actorOrResponse(c, db, true);
    if (actor instanceof Response) return actor;
    try {
      const body = await readJson(c);
      const currency = String(body.currency ?? "");
      if (!isSupportedCurrency(currency)) {
        return Response.json(
          { error: "Validation Error", fields: { currency: `currency '${currency}' is not supported` } },
          { status: 422 },
        );
      }
      return Response.json(updateGroup(db, actor.groupId, String(body.name ?? ""), currency));
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.delete("/api/v1/groups", (c: Context) => {
    const actor = actorOrResponse(c, db, true);
    if (actor instanceof Response) return actor;
    if (actor.groupIds.length <= 1) return jsonError(400, "cannot delete the only group you are a member of");
    try {
      deleteGroup(db, actor.groupId);
      return new Response(null, { status: 204 });
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.get("/api/v1/groups/members", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    return Response.json(listMembers(db, actor.groupId));
  });

  app.delete("/api/v1/groups/members/:user_id", (c: Context) => {
    const actor = actorOrResponse(c, db, true);
    if (actor instanceof Response) return actor;
    const userId = c.req.param("user_id");
    if (userId === actor.userIdText) return jsonError(400, "cannot remove yourself from the group");
    try {
      removeMember(db, actor.groupId, userId);
      return new Response(null, { status: 204 });
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.get("/api/v1/groups/invitations", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    return Response.json(listInvitations(db, actor.groupId));
  });

  app.post("/api/v1/groups/invitations", async (c: Context) => {
    const actor = actorOrResponse(c, db, true);
    if (actor instanceof Response) return actor;
    try {
      const body = await readJson(c);
      const uses = Number(body.uses ?? 1);
      const expiresAt =
        typeof body.expiresAt === "string" && body.expiresAt
          ? body.expiresAt
          : formatSqliteDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
      const invitation = createInvitation(db, actor.groupId, uses, expiresAt);
      return Response.json(invitation, { status: 201 });
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.delete("/api/v1/groups/invitations/:id", (c: Context) => {
    const actor = actorOrResponse(c, db, true);
    if (actor instanceof Response) return actor;
    try {
      deleteInvitation(db, actor.groupId, c.req.param("id"));
      return new Response(null, { status: 204 });
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.post("/api/v1/groups/invitations/:id", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    try {
      const group = acceptInvitation(db, actor.userId, c.req.param("id"));
      return Response.json({ id: group.id, name: group.name });
    } catch (err) {
      return fromTenancy(err);
    }
  });
}
