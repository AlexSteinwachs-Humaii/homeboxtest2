import type { Database } from "bun:sqlite";

import { bytesToUuid, canonicalUuid, isUuidText, parseSqliteDateTime, sqliteNow } from "../db/storage.ts";
import { COOKIE_TOKEN, readCookie } from "./cookies.ts";
import { listMemberships, NOT_GROUP_OWNER, readDefaultGroupId } from "./tenancy.ts";
import { hashApiKey } from "./token.ts";
import { sessionFromToken } from "./users.ts";

export type ResolvedAuth = {
  raw: string;
  source: "cookie" | "bearer" | "query" | "ws_protocol";
  userId: Uint8Array;
  isApiKey: boolean;
  roles: string[];
};

export type Actor = {
  userId: Uint8Array;
  userIdText: string;
  raw: string;
  isApiKey: boolean;
  tokenRoles: string[];
  groupId: string;
  membershipRole: string;
  groupIds: string[];
};

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

// Session cookie, Authorization header, websocket protocol, or access_token query.
// API keys are accepted only from the Authorization header, matching middleware.go.
export function resolveAuth(request: Request, db: Database): ResolvedAuth | null {
  const cookie = readCookie(request.headers.get("cookie"), COOKIE_TOKEN);
  let raw = cookie ?? "";
  let source: ResolvedAuth["source"] = "cookie";
  if (!raw) {
    const header = request.headers.get("authorization");
    if (header) {
      raw = header;
      source = "bearer";
    }
  }
  if (!raw) {
    const protocol = request.headers.get("sec-websocket-protocol");
    const parts = protocol?.split(",") ?? [];
    if (parts.length >= 2 && parts[1].trim()) {
      raw = parts[1].trim();
      source = "ws_protocol";
    }
  }
  if (!raw) {
    const query = new URL(request.url).searchParams.get("access_token");
    if (query) {
      raw = query;
      source = "query";
    }
  }
  if (!raw) return null;
  raw = raw.startsWith("Bearer ") ? raw.slice("Bearer ".length) : raw;

  const session = sessionFromToken(db, raw);
  if (session) {
    return { raw, source, userId: session.user.id, isApiKey: false, roles: session.roles };
  }
  if (source !== "bearer") return null;
  const key = lookupApiKey(db, raw);
  if (!key) return null;
  return { raw, source, userId: key, isApiKey: true, roles: ["user"] };
}

function lookupApiKey(db: Database, raw: string): Uint8Array | null {
  let hash: Uint8Array;
  try {
    hash = hashApiKey(raw);
  } catch {
    return null;
  }
  const row = db.query(`SELECT id, user_id, expires_at FROM api_keys WHERE token = ?`).get(hash) as {
    id: Uint8Array;
    user_id: Uint8Array;
    expires_at: string | null;
  } | null;
  if (!row) return null;
  if (row.expires_at) {
    try {
      if (parseSqliteDateTime(row.expires_at).getTime() <= Date.now()) return null;
    } catch {
      return null;
    }
  }
  const stamp = sqliteNow();
  db.run(`UPDATE api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?`, [stamp, stamp, row.id]);
  const userId = row.user_id instanceof Uint8Array ? row.user_id : new Uint8Array(row.user_id);
  return userId;
}

export type AuthorizeOptions = {
  owner?: boolean;
  anyRole?: string[];
};

// mwAuthToken + mwTenant + mwRoles, and mwGroupOwner when owner is set.
// The active group is X-Tenant, then ?tenant=, then users.default_group_id.
// Membership is user_groups, not a global role column.
export function authorize(request: Request, db: Database, options: AuthorizeOptions = {}): Actor | Response {
  const auth = resolveAuth(request, db);
  if (!auth) return jsonError(401, "authorization header or query is required");

  const required = options.anyRole ?? ["user"];
  if (!required.some((role) => auth.roles.includes(role))) {
    return jsonError(403, "Forbidden");
  }

  const memberships = listMemberships(db, auth.userId);
  const groupIds = memberships.map((row) => row.groupId);
  let tenant = readDefaultGroupId(db, auth.userId);

  const header = request.headers.get("x-tenant") ?? request.headers.get("X-Tenant");
  let rawTenant = header ?? "";
  if (!rawTenant) rawTenant = new URL(request.url).searchParams.get("tenant") ?? "";
  if (rawTenant) {
    if (!isUuidText(rawTenant)) return jsonError(400, "invalid X-Tenant header format");
    tenant = canonicalUuid(rawTenant);
  }

  const membership = tenant ? memberships.find((row) => row.groupId === tenant) : undefined;
  if (!tenant || !membership || !groupIds.includes(tenant)) {
    return jsonError(403, "user does not have access to the requested tenant");
  }
  if (options.owner && membership.role !== "owner") {
    return jsonError(403, NOT_GROUP_OWNER);
  }

  return {
    userId: auth.userId,
    userIdText: bytesToUuid(auth.userId),
    raw: auth.raw,
    isApiKey: auth.isApiKey,
    tokenRoles: auth.roles,
    groupId: tenant,
    membershipRole: membership.role,
    groupIds,
  };
}
