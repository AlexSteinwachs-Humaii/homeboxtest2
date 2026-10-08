import type { Context } from "hono";
import type { Database } from "bun:sqlite";

import {
  AttachmentError,
  createExternalAttachment,
  createFileAttachment,
  deleteStoredAttachment,
  entityAttachmentBody,
  serveAttachment,
  updateAttachment,
  type AttachmentServiceOptions,
} from "../attachments/service.ts";
import { formatSqliteDateTime } from "../db/storage.ts";
import { eventsHttpResponse } from "../events/channel.ts";
import { searchEntities } from "../search/entities.ts";
import { authorize, jsonError, type Actor } from "./guard.ts";
import { isSupportedCurrency } from "./currencies.ts";
import {
  acceptInvitation,
  createEntityForGroup,
  createInvitation,
  createMaintenanceForGroup,
  createTagForGroup,
  createTemplateForGroup,
  deleteEntityForGroup,
  deleteExportForGroup,
  deleteGroup,
  deleteInvitation,
  deleteTagForGroup,
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
  renameTagForGroup,
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

export type AttachmentRouteOptions = AttachmentServiceOptions;

function attachmentError(err: unknown): Response {
  if (err instanceof AttachmentError) {
    if (err.fields && err.status === 422) return Response.json(err.fields, { status: 422 });
    if (err.fields) {
      return Response.json(
        { error: err.message, fields: Object.fromEntries(err.fields.map((field) => [field.field, field.error])) },
        { status: err.status },
      );
    }
    return jsonError(err.status, err.message);
  }
  console.warn(`[homebox] attachment request failed: ${err instanceof Error ? err.message : err}`);
  return jsonError(500, "Unknown Error");
}

function parseBool(value: string): boolean {
  return value === "1" || value.toLowerCase() === "t" || value.toLowerCase() === "true";
}

export function mountProtectedRoutes(app: App, db: Database, storage?: AttachmentRouteOptions): void {
  const files = storage ?? {
    connString: "file:///./",
    prefixPath: ".data",
    thumbnail: { enabled: true, width: 500, height: 500 },
    maxUploadBytes: 10 * 1024 * 1024,
  };
  app.get("/api/v1/ws/events", (c: Context) => eventsHttpResponse(c.req.raw, db));

  app.get("/api/v1/entities", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    const params = new URL(c.req.url).searchParams;
    const location = params.get("location");
    const isLocation = location === null ? undefined : location === "true" || location === "1";
    const q = params.get("q");
    if (q) return Response.json(searchEntities(db, { groupId: actor.groupId, isLocation, search: q }));
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

  app.delete("/api/v1/entities/:id", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    try {
      if (!deleteEntityForGroup(db, actor.groupId, c.req.param("id"))) return jsonError(404, "Not Found");
      return new Response(null, { status: 204 });
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.post("/api/v1/tags", async (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    try {
      const body = await readJson(c);
      const id = createTagForGroup(db, actor.groupId, {
        name: String(body.name ?? ""),
        description: typeof body.description === "string" ? body.description : null,
        color: typeof body.color === "string" ? body.color : null,
        icon: typeof body.icon === "string" ? body.icon : null,
        parentId: typeof body.parentId === "string" ? body.parentId : null,
      });
      return Response.json({ id }, { status: 201 });
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.put("/api/v1/tags/:id", async (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    try {
      const body = await readJson(c);
      if (!renameTagForGroup(db, actor.groupId, c.req.param("id"), String(body.name ?? ""))) {
        return jsonError(404, "Not Found");
      }
      return Response.json({ id: c.req.param("id"), name: String(body.name ?? "") });
    } catch (err) {
      return fromTenancy(err);
    }
  });

  app.delete("/api/v1/tags/:id", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    try {
      if (!deleteTagForGroup(db, actor.groupId, c.req.param("id"))) return jsonError(404, "Not Found");
      return new Response(null, { status: 204 });
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

  app.post("/api/v1/entities/:id/attachments", async (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    const length = Number(c.req.header("content-length") ?? "0");
    if (length > files.maxUploadBytes) {
      return jsonError(413, `uploaded file exceeds the size limit of ${files.maxUploadBytes} bytes`);
    }
    try {
      const form = await c.req.formData();
      const fields: Array<{ field: string; error: string }> = [];
      const file = form.get("file");
      const name = form.get("name");
      if (!(file instanceof File)) fields.push({ field: "file", error: "file is required" });
      if (typeof name !== "string" || name === "") fields.push({ field: "name", error: "name is required" });
      if (fields.length) return Response.json(fields, { status: 422 });
      const content = new Uint8Array(await (file as File).arrayBuffer());
      const type = form.get("type");
      const primary = form.get("primary");
      const stored = await createFileAttachment(
        db,
        actor.groupId,
        c.req.param("id"),
        {
          title: String(name),
          type: typeof type === "string" ? type : "",
          primary: typeof primary === "string" ? parseBool(primary) : false,
          content,
        },
        files,
      );
      return Response.json(entityAttachmentBody(c.req.param("id"), stored), { status: 201 });
    } catch (err) {
      return attachmentError(err);
    }
  });

  app.post("/api/v1/entities/:id/attachments/external", async (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    try {
      const body = await readJson(c);
      const stored = createExternalAttachment(db, actor.groupId, c.req.param("id"), {
        sourceType: String(body.source_type ?? ""),
        externalId: String(body.external_id ?? ""),
        title: String(body.title ?? ""),
        attachmentType: String(body.attachment_type ?? ""),
      });
      return Response.json(entityAttachmentBody(c.req.param("id"), stored), { status: 201 });
    } catch (err) {
      return attachmentError(err);
    }
  });

  app.get("/api/v1/entities/:id/attachments/:attachment_id", (c: Context) => {
    const actor = actorOrResponse(c, db, false, ["user", "attachments"]);
    if (actor instanceof Response) return actor;
    return serveAttachment(db, actor.groupId, c.req.param("id"), c.req.param("attachment_id"), files);
  });

  app.put("/api/v1/entities/:id/attachments/:attachment_id", async (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    try {
      const body = await readJson(c);
      const stored = updateAttachment(db, actor.groupId, c.req.param("id"), c.req.param("attachment_id"), {
        type: String(body.type ?? ""),
        title: String(body.title ?? ""),
        primary: body.primary === true || body.primary === "true",
      });
      return Response.json(entityAttachmentBody(c.req.param("id"), stored));
    } catch (err) {
      return attachmentError(err);
    }
  });

  app.delete("/api/v1/entities/:id/attachments/:attachment_id", (c: Context) => {
    const actor = actorOrResponse(c, db);
    if (actor instanceof Response) return actor;
    if (!deleteStoredAttachment(db, actor.groupId, c.req.param("id"), c.req.param("attachment_id"), files)) {
      return jsonError(404, "Not Found");
    }
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
