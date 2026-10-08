import type { Database } from "bun:sqlite";

import { bytesToUuid, newUuidBytes, parseSqliteDateTime, sqliteNow, uuidToBytes } from "../db/storage.ts";
import { ensureDefaultEntityTypes } from "./defaults.ts";
import { checkDummyPasswordHash, checkPasswordHash, hashPassword } from "./password.ts";
import { generateToken, hashToken } from "./token.ts";

export const PASSWORD_MIN_LENGTH = 6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export const invalidLogin = () => new AuthError("invalid username or password", 401);
export const invalidToken = () => new AuthError("unauthorized", 401);
export const passwordResetInvalid = () => new AuthError("password reset link is invalid or has expired", 400);

export type SessionDetail = {
  raw: string;
  attachmentToken: string;
  expiresAt: Date;
};

export type UserRow = {
  id: Uint8Array;
  email: string;
  name: string;
  password: string | null;
  oidcIssuer: string | null;
  oidcSubject: string | null;
};

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return new Uint8Array(value);
  throw new Error("expected blob");
}

function isExpired(stored: string, now: Date): boolean {
  return parseSqliteDateTime(stored).getTime() <= now.getTime();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getUserByEmail(db: Database, email: string): UserRow | null {
  const rows = db
    .query(
      `SELECT id, email, name, password, oidc_issuer, oidc_subject
       FROM users WHERE lower(email) = lower(?)`,
    )
    .all(normalizeEmail(email)) as Array<{
    id: Uint8Array;
    email: string;
    name: string;
    password: string | null;
    oidc_issuer: string | null;
    oidc_subject: string | null;
  }>;
  if (rows.length === 0) return null;
  if (rows.length > 1) return null;
  const row = rows[0];
  return {
    id: asBytes(row.id),
    email: row.email,
    name: row.name,
    password: row.password,
    oidcIssuer: row.oidc_issuer,
    oidcSubject: row.oidc_subject,
  };
}

export function getUserById(db: Database, id: Uint8Array): UserRow | null {
  const row = db
    .query(
      `SELECT id, email, name, password, oidc_issuer, oidc_subject FROM users WHERE id = ?`,
    )
    .get(id) as
    | {
        id: Uint8Array;
        email: string;
        name: string;
        password: string | null;
        oidc_issuer: string | null;
        oidc_subject: string | null;
      }
    | null;
  if (!row) return null;
  return {
    id: asBytes(row.id),
    email: row.email,
    name: row.name,
    password: row.password,
    oidcIssuer: row.oidc_issuer,
    oidcSubject: row.oidc_subject,
  };
}

function insertToken(db: Database, userId: Uint8Array, hash: Uint8Array, expiresAt: string, role: string, now: string): void {
  const id = newUuidBytes();
  db.run(
    `INSERT INTO auth_tokens (id, created_at, updated_at, token, expires_at, user_auth_tokens)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, now, now, hash, expiresAt, userId],
  );
  db.run(`INSERT INTO auth_roles (role, auth_tokens_roles) VALUES (?, ?)`, [role, id]);
}

export function createSession(db: Database, userId: Uint8Array, extended: boolean, now = new Date()): SessionDetail {
  const expiresAt = new Date(now.getTime() + (extended ? 4 : 1) * WEEK_MS);
  const expires = sqliteNowFrom(expiresAt);
  const stamp = sqliteNowFrom(now);
  const attachment = generateToken();
  const user = generateToken();
  insertToken(db, userId, attachment.hash, expires, "attachments", stamp);
  insertToken(db, userId, user.hash, expires, "user", stamp);
  return { raw: user.raw, attachmentToken: attachment.raw, expiresAt };
}

function sqliteNowFrom(date: Date): string {
  // formatSqliteDateTime is UTC. Importing it here avoids a cycle with a local clock.
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const nanos = date.getUTCMilliseconds() * 1_000_000;
  let fraction = "";
  if (nanos !== 0) fraction = `.${String(nanos).padStart(9, "0").replace(/0+$/, "")}`;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}${fraction}+00:00`;
}

export async function login(
  db: Database,
  username: string,
  password: string,
  extended: boolean,
  env: Record<string, string | undefined> = process.env,
): Promise<SessionDetail> {
  const user = getUserByEmail(db, username);
  if (!user || !user.password) {
    await checkDummyPasswordHash(env);
    throw invalidLogin();
  }
  const check = await checkPasswordHash(password, user.password, env);
  if (!check.match) throw invalidLogin();
  if (check.needsRehash) {
    const hashed = await hashPassword(password, env);
    db.run(`UPDATE users SET password = ?, updated_at = ? WHERE id = ?`, [hashed, sqliteNow(), user.id]);
  }
  return createSession(db, user.id, extended);
}

export function sessionFromToken(db: Database, raw: string, now = new Date()): { user: UserRow; roles: string[] } | null {
  const hash = hashToken(raw);
  const row = db
    .query(`SELECT id, expires_at, user_auth_tokens AS user_id FROM auth_tokens WHERE token = ?`)
    .get(hash) as { id: Uint8Array; expires_at: string; user_id: Uint8Array | null } | null;
  if (!row || !row.user_id) return null;
  if (isExpired(row.expires_at, now)) return null;
  const user = getUserById(db, asBytes(row.user_id));
  if (!user) return null;
  const roles = db
    .query(`SELECT role FROM auth_roles WHERE auth_tokens_roles = ?`)
    .all(asBytes(row.id)) as Array<{ role: string }>;
  return { user, roles: roles.map((role) => role.role) };
}

export function deleteSessionToken(db: Database, raw: string): void {
  db.run(`DELETE FROM auth_tokens WHERE token = ?`, [hashToken(raw)]);
}

export function deleteAllSessions(db: Database, userId: Uint8Array): number {
  const result = db.run(`DELETE FROM auth_tokens WHERE user_auth_tokens = ?`, [userId]);
  return result.changes;
}

export function renewSession(db: Database, raw: string, now = new Date()): SessionDetail {
  const found = sessionFromToken(db, raw, now);
  if (!found) throw invalidToken();
  if (!found.roles.includes("user")) throw new AuthError("Forbidden", 403);
  const next = createSession(db, found.user.id, false, now);
  deleteSessionToken(db, raw);
  return next;
}

export type RegistrationInput = {
  name: string;
  email: string;
  password: string;
  groupToken?: string;
};

export async function registerUser(
  db: Database,
  input: RegistrationInput,
  env: Record<string, string | undefined> = process.env,
): Promise<{ id: string; email: string; groupId: string }> {
  if (input.password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(`password must be at least ${PASSWORD_MIN_LENGTH} characters`, 500);
  }
  const email = normalizeEmail(input.email);
  if (!email || !input.name.trim()) {
    throw new AuthError("name and email are required", 500);
  }

  const now = sqliteNow();
  const hashed = await hashPassword(input.password, env);
  const userId = newUuidBytes();

  let groupId: Uint8Array;
  let role = "owner";
  let invitationId: Uint8Array | null = null;

  if (input.groupToken) {
    const invite = findInvitation(db, input.groupToken, new Date());
    if (!invite) throw new AuthError("invitation expired", 500);
    groupId = invite.groupId;
    invitationId = invite.id;
    role = "user";
  } else {
    groupId = newUuidBytes();
    db.run(`INSERT INTO groups (id, created_at, updated_at, name, currency) VALUES (?, ?, ?, ?, ?)`, [
      groupId,
      now,
      now,
      `${input.name.trim()}'s Home`,
      "usd",
    ]);
  }

  try {
    db.transaction(() => {
      db.run(
        `INSERT INTO users (id, created_at, updated_at, name, email, password, is_superuser, superuser, default_group_id, settings)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, '{}')`,
        [userId, now, now, input.name.trim(), email, hashed, groupId],
      );
      db.run(`INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, ?)`, [userId, groupId, role]);
      if (invitationId) {
        const updated = db.run(
          `UPDATE group_invitation_tokens SET uses = uses - 1, updated_at = ? WHERE id = ? AND uses > 0`,
          [now, invitationId],
        );
        if (updated.changes !== 1) throw new AuthError("invitation used up", 500);
      }
    })();
  } catch (err) {
    if (err instanceof AuthError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE") && message.includes("email")) {
      throw new AuthError("failed to register user", 500);
    }
    throw new AuthError(message, 500);
  }

  ensureDefaultEntityTypes(db, groupId);
  return { id: bytesToUuid(userId), email, groupId: bytesToUuid(groupId) };
}

function findInvitation(
  db: Database,
  rawToken: string,
  now: Date,
): { id: Uint8Array; groupId: Uint8Array } | null {
  const row = db
    .query(
      `SELECT id, expires_at, uses, group_invitation_tokens AS group_id FROM group_invitation_tokens WHERE token = ?`,
    )
    .get(hashToken(rawToken)) as
    | { id: Uint8Array; expires_at: string; uses: number; group_id: Uint8Array | null }
    | null;
  if (!row || !row.group_id) return null;
  if (row.uses <= 0 || isExpired(row.expires_at, now)) return null;
  return { id: asBytes(row.id), groupId: asBytes(row.group_id) };
}

export type MailSender = {
  ready: boolean;
  send: (message: { toName: string; toEmail: string; subject: string; body: string }) => Promise<void> | void;
};

export async function requestPasswordReset(
  db: Database,
  email: string,
  baseURL: string,
  mailer: MailSender,
): Promise<void> {
  if (!mailer.ready) return;
  const created = createResetToken(db, email);
  if (!created) return;
  const link = buildResetLink(baseURL, created.raw);
  await mailer.send({
    toName: created.user.name,
    toEmail: created.user.email,
    subject: "Reset your Homebox password",
    body: buildResetEmailBody(created.user.name, link),
  });
}

export function createResetToken(db: Database, email: string, now = new Date()): { raw: string; user: UserRow } | null {
  const user = getUserByEmail(db, email);
  if (!user || !user.password) return null;
  const token = generateToken();
  const expires = sqliteNowFrom(new Date(now.getTime() + RESET_TTL_MS));
  const stamp = sqliteNowFrom(now);
  db.run(
    `INSERT INTO password_reset_tokens (id, created_at, updated_at, user_id, token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newUuidBytes(), stamp, stamp, user.id, token.hash, expires],
  );
  return { raw: token.raw, user };
}

export async function resetPassword(
  db: Database,
  rawToken: string,
  newPassword: string,
  env: Record<string, string | undefined> = process.env,
  now = new Date(),
): Promise<void> {
  if (!rawToken || !newPassword) {
    throw passwordResetInvalid();
  }
  const hash = hashToken(rawToken);
  const row = db
    .query(
      `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token = ?`,
    )
    .get(hash) as { id: Uint8Array; user_id: Uint8Array; expires_at: string; used_at: string | null } | null;
  if (!row || row.used_at || isExpired(row.expires_at, now)) {
    await hashPassword(newPassword, env);
    throw passwordResetInvalid();
  }

  const hashed = await hashPassword(newPassword, env);
  const stamp = sqliteNowFrom(now);
  let claimed = false;
  db.transaction(() => {
    const updated = db.run(
      `UPDATE password_reset_tokens SET used_at = ?, updated_at = ? WHERE id = ? AND used_at IS NULL`,
      [stamp, stamp, asBytes(row.id)],
    );
    if (updated.changes !== 1) return;
    db.run(`UPDATE users SET password = ?, updated_at = ? WHERE id = ?`, [hashed, stamp, asBytes(row.user_id)]);
    claimed = true;
  })();
  if (!claimed) throw passwordResetInvalid();
  deleteAllSessions(db, asBytes(row.user_id));
}

export function buildResetLink(baseURL: string, rawToken: string): string {
  const base = baseURL.replace(/\/$/, "");
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

export function buildResetEmailBody(name: string, link: string): string {
  const who = name || "there";
  const safeName = htmlEscape(who);
  const safeLink = htmlEscape(link);
  return `<!doctype html>
<html><body>
<p>Hi ${safeName},</p>
<p>Someone (hopefully you) requested a password reset for your Homebox account. Click the link below to choose a new password. The link will expire in one hour and can only be used once.</p>
<p><a href="${safeLink}">Reset password</a></p>
<p>If the button doesn't work, paste this URL into your browser:</p>
<p><code>${safeLink}</code></p>
<p>If you didn't request this, you can ignore this email — your password won't change.</p>
</body></html>`;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function countApiKeys(db: Database, userId: Uint8Array): number {
  const row = db.query(`SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?`).get(userId) as { n: number };
  return Number(row.n);
}

export function countSessions(db: Database, userId: Uint8Array): number {
  const row = db.query(`SELECT COUNT(*) AS n FROM auth_tokens WHERE user_auth_tokens = ?`).get(userId) as { n: number };
  return Number(row.n);
}

export function userIdText(id: Uint8Array): string {
  return bytesToUuid(id);
}

export function userIdBytes(id: string): Uint8Array {
  return uuidToBytes(id);
}
