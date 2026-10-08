import type { Database } from "bun:sqlite";

import { StartupError } from "../errors.ts";
import type { OidcConfig, ServerConfig } from "../config.ts";
import { newUuidBytes, sqliteNow } from "../db/storage.ts";
import { cookieDomain, OIDC_NONCE, OIDC_PKCE, OIDC_STATE, oidcClearCookies, oidcSetCookies, readCookie } from "./cookies.ts";
import { pkceChallenge, randomUrlToken } from "./token.ts";
import { createSession, getUserByEmail, normalizeEmail, type SessionDetail } from "./users.ts";

export type OidcEndpoints = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint?: string;
  jwksUri: string;
};

export type OidcRuntime = {
  config: OidcConfig;
  endpoints: OidcEndpoints;
  keys: JsonWebKey[];
  fetchImpl?: typeof fetch;
};

type JwtHeader = { alg?: string; kid?: string };
type Claims = Record<string, unknown>;

const RETRY_DELAYS_MS = [0, 500, 2000, 5000];

export async function initOidc(config: ServerConfig, fetchImpl: typeof fetch = fetch): Promise<OidcRuntime> {
  const oidc = config.oidc;
  if (!oidc.enabled) throw new StartupError("OIDC is not enabled");
  if (!oidc.clientId) {
    throw new StartupError("OIDC client ID is required when OIDC is enabled (set HBOX_OIDC_CLIENT_ID)");
  }
  if (!oidc.clientSecret) {
    throw new StartupError("OIDC client secret is required when OIDC is enabled (set HBOX_OIDC_CLIENT_SECRET)");
  }
  if (!oidc.issuerUrl) {
    throw new StartupError("OIDC issuer URL is required when OIDC is enabled (set HBOX_OIDC_ISSUER_URL)");
  }
  const endpoints = await discoverWithRetry(oidc.issuerUrl, oidc.requestTimeoutMs, fetchImpl);
  const keys = await fetchJwks(endpoints.jwksUri, oidc.requestTimeoutMs, fetchImpl);
  return { config: oidc, endpoints, keys, fetchImpl };
}

async function discoverWithRetry(issuer: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<OidcEndpoints> {
  let last = "unknown error";
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) await sleep(RETRY_DELAYS_MS[attempt]);
    try {
      return await discover(issuer, timeoutMs, fetchImpl);
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      console.warn(`[homebox] failed to create OIDC provider, attempt ${attempt + 1}: ${last}`);
    }
  }
  throw new StartupError(
    `failed to create OIDC provider from issuer URL after ${RETRY_DELAYS_MS.length} attempts: ${last}`,
  );
}

export async function discover(issuer: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<OidcEndpoints> {
  const url = issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`discovery ${response.status} from ${url}`);
  const body = (await response.json()) as Record<string, unknown>;
  const authorizationEndpoint = stringClaim(body, "authorization_endpoint");
  const tokenEndpoint = stringClaim(body, "token_endpoint");
  const jwksUri = stringClaim(body, "jwks_uri");
  const discoveredIssuer = stringClaim(body, "issuer") || issuer;
  if (!authorizationEndpoint || !tokenEndpoint || !jwksUri) {
    throw new Error("OIDC discovery document is missing authorization, token, or jwks endpoint");
  }
  const userinfo = stringClaim(body, "userinfo_endpoint");
  return {
    issuer: discoveredIssuer,
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
    userinfoEndpoint: userinfo || undefined,
  };
}

async function fetchJwks(jwksUri: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<JsonWebKey[]> {
  const response = await fetchImpl(jwksUri, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`jwks ${response.status}`);
  const body = (await response.json()) as { keys?: JsonWebKey[] };
  return body.keys ?? [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function oidcBaseURL(request: Request, config: ServerConfig): string {
  let scheme = "http";
  if (config.trustProxy && firstHeader(request.headers.get("x-forwarded-proto")) === "https") scheme = "https";
  let host = request.headers.get("host") ?? new URL(request.url).host;
  if (config.hostname) host = config.hostname;
  else if (config.trustProxy) {
    const forwarded = firstHeader(request.headers.get("x-forwarded-host"));
    if (forwarded && validProxyHost(forwarded)) host = forwarded;
  }
  if (host.startsWith("http://") || host.startsWith("https://")) return host.replace(/\/$/, "");
  return `${scheme}://${host}`;
}

export function oidcCookieDomain(request: Request, config: ServerConfig): string {
  const base = oidcBaseURL(request, config);
  try {
    const host = new URL(base).hostname;
    if (host) return host;
  } catch {
    // fall through
  }
  return cookieDomain(request);
}

export function startOidcLogin(request: Request, config: ServerConfig, runtime: OidcRuntime): Response {
  const state = randomUrlToken();
  const nonce = randomUrlToken();
  const verifier = randomUrlToken();
  const base = oidcBaseURL(request, config);
  const domain = oidcCookieDomain(request, config);
  const expires = new Date(Date.now() + runtime.config.stateExpiryMs);
  const headers = new Headers();
  for (const cookie of oidcSetCookies(domain, expires, config.cookieSecure, {
    [OIDC_STATE]: state,
    [OIDC_NONCE]: nonce,
    [OIDC_PKCE]: verifier,
  })) {
    headers.append("set-cookie", cookie);
  }
  headers.set("location", authorizationUrl(runtime, base, state, nonce, verifier));
  return new Response(null, { status: 302, headers });
}

export function authorizationUrl(runtime: OidcRuntime, baseURL: string, state: string, nonce: string, verifier: string): string {
  const redirect = new URL("/api/v1/users/login/oidc/callback", ensureSlash(baseURL)).toString();
  const url = new URL(runtime.endpoints.authorizationEndpoint);
  url.searchParams.set("client_id", runtime.config.clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", runtime.config.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function finishOidcCallback(
  db: Database,
  request: Request,
  config: ServerConfig,
  runtime: OidcRuntime,
): Promise<{ session: SessionDetail; clear: string[] } | { error: string; clear: string[] }> {
  const domain = oidcCookieDomain(request, config);
  const clear = oidcClearCookies(domain, config.cookieSecure);
  const url = new URL(request.url);
  if (url.searchParams.get("error")) {
    return { error: "oidc provider error", clear };
  }
  const stateCookie = readCookie(request.headers.get("cookie"), OIDC_STATE);
  const nonceCookie = readCookie(request.headers.get("cookie"), OIDC_NONCE);
  const pkceCookie = readCookie(request.headers.get("cookie"), OIDC_PKCE);
  const state = url.searchParams.get("state") ?? "";
  if (!stateCookie || !state || stateCookie !== state) return { error: "state parameter mismatch", clear };
  if (!nonceCookie) return { error: "nonce cookie not found", clear };
  if (!pkceCookie) return { error: "PKCE verifier cookie not found", clear };
  const code = url.searchParams.get("code") ?? "";
  if (!code) return { error: "missing authorization code", clear };

  try {
    const session = await exchangeAndLogin(db, request, config, runtime, code, nonceCookie, pkceCookie);
    return { session, clear };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[homebox] OIDC callback failed: ${message}`);
    return { error: message, clear };
  }
}

async function exchangeAndLogin(
  db: Database,
  request: Request,
  config: ServerConfig,
  runtime: OidcRuntime,
  code: string,
  expectedNonce: string,
  verifier: string,
): Promise<SessionDetail> {
  const base = oidcBaseURL(request, config);
  const redirect = new URL("/api/v1/users/login/oidc/callback", ensureSlash(base)).toString();
  const fetchImpl = runtime.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    client_id: runtime.config.clientId,
    client_secret: runtime.config.clientSecret,
    code_verifier: verifier,
  });
  const tokenResponse = await fetchImpl(runtime.endpoints.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(runtime.config.requestTimeoutMs),
  });
  if (!tokenResponse.ok) throw new Error("failed to exchange code for token");
  const token = (await tokenResponse.json()) as { access_token?: string; id_token?: string };
  if (!token.id_token) throw new Error("no id_token in response");
  const verified = await verifyIdToken(token.id_token, runtime);
  let claims = verified.claims;
  if (runtime.endpoints.userinfoEndpoint && token.access_token) {
    try {
      const info = await fetchImpl(runtime.endpoints.userinfoEndpoint, {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(runtime.config.requestTimeoutMs),
      });
      if (info.ok) {
        const userInfo = (await info.json()) as Claims;
        claims = mergeClaims(userInfo, verified.claims);
      }
    } catch (err) {
      console.warn(`[homebox] OIDC UserInfo fetch failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  const nonce = claims.nonce;
  if (typeof nonce !== "string" || nonce !== expectedNonce) throw new Error("nonce parameter mismatch");
  const parsed = parseClaims(claims, runtime.config);
  if (runtime.config.verifyEmail) {
    if (parsed.emailVerified === undefined) throw new Error("email verification status not found in token claims");
    if (!parsed.emailVerified) throw new Error("email not verified");
  }
  if (runtime.config.allowedGroups) {
    const allowed = runtime.config.allowedGroups.split(",").map((group) => group.trim());
    if (!parsed.groups.some((group) => allowed.includes(group))) throw new Error("user not in allowed groups");
  }
  if (!parsed.email) throw new Error("no email found in token claims");
  if (!parsed.subject) throw new Error("no subject (sub) claim present");
  const issuer = parsed.issuer || runtime.config.issuerUrl;
  return loginOidc(db, issuer, parsed.subject, parsed.email, parsed.name);
}

export function loginOidc(db: Database, issuer: string, subject: string, email: string, name: string): SessionDetail {
  issuer = issuer.trim();
  subject = subject.trim();
  email = normalizeEmail(email);
  name = name.trim();
  if (!issuer || !subject) throw new Error("invalid username or password");

  let user = findOidcUser(db, issuer, subject);
  if (!user && email) {
    const legacy = getUserByEmail(db, email);
    if (legacy && !legacy.oidcIssuer && !legacy.oidcSubject) {
      db.run(`UPDATE users SET oidc_issuer = ?, oidc_subject = ?, updated_at = ? WHERE id = ?`, [
        issuer,
        subject,
        sqliteNow(),
        legacy.id,
      ]);
      user = legacy;
    }
  }
  if (!user) {
    try {
      user = insertOidcUser(db, issuer, subject, email, name || email);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("UNIQUE")) throw err;
      user = findOidcUser(db, issuer, subject);
      if (!user) throw err;
    }
  }
  return createSession(db, user.id, true);
}

function findOidcUser(db: Database, issuer: string, subject: string) {
  const row = db
    .query(
      `SELECT id, email, name, password, oidc_issuer, oidc_subject FROM users WHERE oidc_issuer = ? AND oidc_subject = ?`,
    )
    .get(issuer, subject) as
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
    id: row.id instanceof Uint8Array ? row.id : new Uint8Array(row.id),
    email: row.email,
    name: row.name,
    password: row.password,
    oidcIssuer: row.oidc_issuer,
    oidcSubject: row.oidc_subject,
  };
}

function insertOidcUser(db: Database, issuer: string, subject: string, email: string, name: string) {
  const now = sqliteNow();
  const groupId = newUuidBytes();
  const userId = newUuidBytes();
  db.transaction(() => {
    db.run(`INSERT INTO groups (id, created_at, updated_at, name, currency) VALUES (?, ?, ?, ?, ?)`, [
      groupId,
      now,
      now,
      "Home",
      "usd",
    ]);
    db.run(
      `INSERT INTO users (id, created_at, updated_at, name, email, password, is_superuser, superuser, oidc_issuer, oidc_subject, default_group_id, settings)
       VALUES (?, ?, ?, ?, ?, NULL, 0, 0, ?, ?, ?, '{}')`,
      [userId, now, now, name, email, issuer, subject, groupId],
    );
    db.run(`INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, 'owner')`, [userId, groupId]);
  })();
  const created = findOidcUser(db, issuer, subject);
  if (!created) throw new Error("failed to create OIDC user");
  return created;
}

async function verifyIdToken(token: string, runtime: OidcRuntime): Promise<{ claims: Claims }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("failed to verify ID token");
  const header = JSON.parse(Buffer.from(pad(parts[0]), "base64url").toString("utf8")) as JwtHeader;
  const claims = JSON.parse(Buffer.from(pad(parts[1]), "base64url").toString("utf8")) as Claims;
  const signature = Buffer.from(pad(parts[2]), "base64url");
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const alg = header.alg;
  if (alg !== "RS256" && alg !== "ES256") throw new Error("failed to verify ID token");
  const jwk = runtime.keys.find((key) => !header.kid || key.kid === header.kid) ?? runtime.keys[0];
  if (!jwk) throw new Error("failed to verify ID token");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    alg === "RS256" ? "RSASSA-PKCS1-v1_5" : { name: "ECDSA", hash: "SHA-256" },
    key,
    signature,
    signingInput,
  );
  if (!ok) throw new Error("failed to verify ID token");
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp <= now) throw new Error("failed to verify ID token");
  const iss = typeof claims.iss === "string" ? claims.iss.replace(/\/$/, "") : "";
  const expected = runtime.endpoints.issuer.replace(/\/$/, "");
  if (iss !== expected) throw new Error("failed to verify ID token");
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(runtime.config.clientId)) throw new Error("failed to verify ID token");
  return { claims };
}

function parseClaims(claims: Claims, config: OidcConfig): {
  email: string;
  name: string;
  subject: string;
  issuer: string;
  groups: string[];
  emailVerified?: boolean;
} {
  const emailKey = config.emailClaim || "email";
  const nameKey = config.nameClaim || "name";
  const groupKey = config.groupClaim || "groups";
  const verifiedKey = config.emailVerifiedClaim || "email_verified";
  const groupsValue = claims[groupKey];
  let groups: string[] = [];
  if (Array.isArray(groupsValue)) groups = groupsValue.filter((item): item is string => typeof item === "string");
  else if (typeof groupsValue === "string") groups = [groupsValue];
  let emailVerified: boolean | undefined;
  const verified = claims[verifiedKey];
  if (typeof verified === "boolean") emailVerified = verified;
  else if (typeof verified === "string") emailVerified = verified === "true" || verified === "1";
  return {
    email: typeof claims[emailKey] === "string" ? claims[emailKey] : "",
    name: typeof claims[nameKey] === "string" ? claims[nameKey] : "",
    subject: typeof claims.sub === "string" ? claims.sub : "",
    issuer: typeof claims.iss === "string" ? claims.iss : "",
    groups,
    emailVerified,
  };
}

function mergeClaims(primary: Claims, secondary: Claims): Claims {
  const merged: Claims = { ...primary };
  for (const [key, value] of Object.entries(secondary)) {
    if (!(key in merged) || isEmptyClaim(merged[key])) merged[key] = value;
  }
  return merged;
}

function isEmptyClaim(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function stringClaim(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === "string" ? body[key] : "";
}

function firstHeader(value: string | null): string {
  if (!value) return "";
  return value.split(",")[0]?.trim().toLowerCase() ?? "";
}

function validProxyHost(host: string): boolean {
  if (!host || /[\s/?#\\]/.test(host) || host.includes("://")) return false;
  try {
    const url = new URL(`http://${host}`);
    return url.host === host;
  } catch {
    return false;
  }
}

function ensureSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

function pad(value: string): string {
  const remainder = value.length % 4;
  return remainder === 0 ? value : value + "=".repeat(4 - remainder);
}
