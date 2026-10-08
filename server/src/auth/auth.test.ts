import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

import { createApp } from "../app.ts";
import { assertApiKeyPepper, generateApiKey, hashApiKey, hashToken, setApiKeyPepper } from "./token.ts";
import { prepareDatabase } from "../boot.ts";
import { loadConfig } from "../config.ts";
import { StartupError } from "../errors.ts";
import { newUuidBytes, sqliteNow } from "../db/storage.ts";
import { authorizationUrl, initOidc, type OidcRuntime } from "./oidc.ts";
import { GO_ARGON2_VECTOR, GO_BCRYPT_VECTOR, checkPasswordHash, hashPassword } from "./password.ts";
import { pkceChallenge } from "./token.ts";
import { buildResetLink, countApiKeys, countSessions } from "./users.ts";

const migrationsDir = resolve(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const serverRoot = resolve(import.meta.dir, "../..");
const PEPPER = "test-pepper-not-for-production-use!!";
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "homebox-auth-"));
  temps.push(dir);
  return dir;
}

function openFixture(): { db: Database; close: () => void } {
  const dir = tempDir();
  const path = join(dir, "homebox.db");
  const prepared = prepareDatabase({
    HBOX_DATABASE_DRIVER: "sqlite3",
    HBOX_DATABASE_SQLITE_PATH: path,
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_WEB_PORT: "0",
  });
  return { db: prepared.db, close: () => prepared.db.close() };
}

function insertUser(db: Database, email: string, password: string | null, id = newUuidBytes()): Uint8Array {
  const now = sqliteNow();
  db.run(
    `INSERT INTO users (id, created_at, updated_at, name, email, password, is_superuser, superuser, settings)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, '{}')`,
    [id, now, now, "Ada", email, password],
  );
  return id;
}

function passwordOf(db: Database, email: string): string | null {
  const row = db.query(`SELECT password FROM users WHERE email = ?`).get(email) as { password: string | null };
  return row.password;
}

function appFor(db: Database, extra: Parameters<typeof createApp>[2] = {}) {
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
  return createApp(config, process.env, { db, ...extra });
}

function cookiesOf(response: Response): string[] {
  return typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
}

function cookie(headers: string[], name: string): string | undefined {
  return headers.find((header) => header.startsWith(`${name}=`));
}

describe("password hashes", () => {
  test("an argon2id PHC hash from Go verifies, and a wrong password does not", async () => {
    const ok = await checkPasswordHash(GO_ARGON2_VECTOR.password, GO_ARGON2_VECTOR.hash);
    expect(ok).toEqual({ match: true, needsRehash: false });
    const wrong = await checkPasswordHash("not-the-password", GO_ARGON2_VECTOR.hash);
    expect(wrong).toEqual({ match: false, needsRehash: false });
  });

  test("a newly hashed password round-trips with the same parameters", async () => {
    const hashed = await hashPassword("correct horse");
    expect(hashed.startsWith("$argon2id$v=19$m=65536,t=3,p=2$")).toBe(true);
    expect((await checkPasswordHash("correct horse", hashed)).match).toBe(true);
    expect((await checkPasswordHash("wrong", hashed)).match).toBe(false);
  });

  test("a legacy bcrypt hash verifies and a failed attempt does not ask for a rehash", async () => {
    const ok = await checkPasswordHash(GO_BCRYPT_VECTOR.password, GO_BCRYPT_VECTOR.hash);
    expect(ok).toEqual({ match: true, needsRehash: true });
    const wrong = await checkPasswordHash("nope", GO_BCRYPT_VECTOR.hash);
    expect(wrong).toEqual({ match: false, needsRehash: false });
  });
});

describe("login, sessions, and cookies", () => {
  test("login sets the four Go cookies and a wrong password does not authenticate", async () => {
    const fixture = openFixture();
    try {
      insertUser(fixture.db, "ada@example.com", GO_ARGON2_VECTOR.hash);
      const app = appFor(fixture.db);
      const bad = await app.request("http://127.0.0.1:7745/api/v1/users/login", {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:7745" },
        body: JSON.stringify({ username: "ada@example.com", password: "wrong-password", stayLoggedIn: false }),
      });
      expect(bad.status).toBe(401);
      expect(passwordOf(fixture.db, "ada@example.com")).toBe(GO_ARGON2_VECTOR.hash);

      const ok = await app.request("http://127.0.0.1:7745/api/v1/users/login", {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:7745" },
        body: JSON.stringify({ username: "Ada@Example.com", password: GO_ARGON2_VECTOR.password, stayLoggedIn: true }),
      });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { token: string; attachmentToken: string };
      expect(body.token.startsWith("Bearer ")).toBe(true);
      expect(body.attachmentToken.length).toBeGreaterThan(10);

      const set = cookiesOf(ok);
      const token = cookie(set, "hb.auth.token");
      const remember = cookie(set, "hb.auth.remember");
      const session = cookie(set, "hb.auth.session");
      const attachment = cookie(set, "hb.auth.attachment_token");
      expect(token).toBeDefined();
      expect(remember).toBeDefined();
      expect(session).toBeDefined();
      expect(attachment).toBeDefined();
      for (const header of [token, remember, session, attachment]) {
        expect(header).toContain("Path=/");
        expect(header).toContain("Domain=127.0.0.1");
        expect(header).toContain("SameSite=Lax");
        expect(header).not.toContain("Secure");
      }
      expect(token).toContain("HttpOnly");
      expect(remember).toContain("HttpOnly");
      expect(remember).toContain("hb.auth.remember=true");
      expect(session).not.toContain("HttpOnly");
      expect(session).toContain("hb.auth.session=true");
      expect(attachment).not.toContain("HttpOnly");
      expect(attachment).toContain(body.attachmentToken);
    } finally {
      fixture.close();
    }
  });

  test("a legacy bcrypt login is rehashed to argon2id and a failed attempt is not", async () => {
    const fixture = openFixture();
    try {
      insertUser(fixture.db, "legacy@example.com", GO_BCRYPT_VECTOR.hash);
      const app = appFor(fixture.db);
      const bad = await app.request("http://127.0.0.1:7745/api/v1/users/login", {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:7745" },
        body: JSON.stringify({ username: "legacy@example.com", password: "not-legacy", stayLoggedIn: false }),
      });
      expect(bad.status).toBe(401);
      expect(passwordOf(fixture.db, "legacy@example.com")).toBe(GO_BCRYPT_VECTOR.hash);

      const ok = await app.request("http://127.0.0.1:7745/api/v1/users/login", {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:7745" },
        body: JSON.stringify({ username: "legacy@example.com", password: GO_BCRYPT_VECTOR.password, stayLoggedIn: false }),
      });
      expect(ok.status).toBe(200);
      expect(passwordOf(fixture.db, "legacy@example.com")).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=2\$/);
    } finally {
      fixture.close();
    }
  });

  test("refresh rotates the session, logout clears it, and logout-all leaves API keys", async () => {
    const fixture = openFixture();
    try {
      const userId = insertUser(fixture.db, "ada@example.com", GO_ARGON2_VECTOR.hash);
      setApiKeyPepper(PEPPER);
      const key = generateApiKey();
      const now = sqliteNow();
      fixture.db.run(
        `INSERT INTO api_keys (id, created_at, updated_at, user_id, name, token) VALUES (?, ?, ?, ?, ?, ?)`,
        [newUuidBytes(), now, now, userId, "ci", key.hash],
      );
      const app = appFor(fixture.db);
      const loginResponse = await app.request("http://127.0.0.1:7745/api/v1/users/login", {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:7745" },
        body: JSON.stringify({ username: "ada@example.com", password: GO_ARGON2_VECTOR.password, stayLoggedIn: false }),
      });
      const loginBody = (await loginResponse.json()) as { token: string };
      const raw = loginBody.token.slice("Bearer ".length);
      const cookieHeader = `hb.auth.token=${raw}`;

      const refreshed = await app.request("http://127.0.0.1:7745/api/v1/users/refresh", {
        headers: { cookie: cookieHeader, host: "127.0.0.1:7745" },
      });
      expect(refreshed.status).toBe(200);
      const next = (await refreshed.json()) as { raw: string; attachmentToken: string };
      expect(next.raw).not.toBe(raw);
      expect(cookie(cookiesOf(refreshed), "hb.auth.remember")).toContain("hb.auth.remember=false");
      const stale = await app.request("http://127.0.0.1:7745/api/v1/users/refresh", {
        headers: { cookie: cookieHeader, host: "127.0.0.1:7745" },
      });
      expect(stale.status).toBe(401);

      const loggedOut = await app.request("http://127.0.0.1:7745/api/v1/users/logout", {
        method: "POST",
        headers: { cookie: `hb.auth.token=${next.raw}`, host: "127.0.0.1:7745" },
      });
      expect(loggedOut.status).toBe(204);
      expect(cookie(cookiesOf(loggedOut), "hb.auth.token")).toContain("Expires=Thu, 01 Jan 1970");
      expect(cookie(cookiesOf(loggedOut), "hb.auth.session")).toContain("hb.auth.session=false");
      expect(cookie(cookiesOf(loggedOut), "hb.auth.session")).not.toContain("HttpOnly");

      const again = await app.request("http://127.0.0.1:7745/api/v1/users/login", {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:7745" },
        body: JSON.stringify({ username: "ada@example.com", password: GO_ARGON2_VECTOR.password, stayLoggedIn: false }),
      });
      const againRaw = ((await again.json()) as { token: string }).token.slice("Bearer ".length);
      expect(countSessions(fixture.db, userId)).toBeGreaterThan(0);
      expect(countApiKeys(fixture.db, userId)).toBe(1);

      const all = await app.request("http://127.0.0.1:7745/api/v1/users/logout/all", {
        method: "POST",
        headers: { cookie: `hb.auth.token=${againRaw}`, host: "127.0.0.1:7745" },
      });
      expect(all.status).toBe(204);
      expect(countSessions(fixture.db, userId)).toBe(0);
      expect(countApiKeys(fixture.db, userId)).toBe(1);

      const keyLogout = await app.request("http://127.0.0.1:7745/api/v1/users/logout", {
        method: "POST",
        headers: { authorization: `Bearer ${key.raw}`, host: "127.0.0.1:7745" },
      });
      expect(keyLogout.status).toBe(400);
      expect(countApiKeys(fixture.db, userId)).toBe(1);

      const otherPepper = "other-pepper-other-pepper-other-pepper";
      setApiKeyPepper(otherPepper);
      const mismatch = await app.request("http://127.0.0.1:7745/api/v1/users/logout/all", {
        method: "POST",
        headers: { authorization: `Bearer ${key.raw}`, host: "127.0.0.1:7745" },
      });
      expect(mismatch.status).toBe(401);
      const stored = fixture.db.query(`SELECT token FROM api_keys WHERE user_id = ?`).get(userId) as { token: Uint8Array };
      expect(Buffer.from(stored.token).equals(Buffer.from(key.hash))).toBe(true);
      expect(Buffer.from(hashApiKey(key.raw)).equals(Buffer.from(key.hash))).toBe(false);
      setApiKeyPepper(PEPPER);
      expect(Buffer.from(hashToken("same")).equals(Buffer.from(hashToken("same")))).toBe(true);
    } finally {
      fixture.close();
    }
  });
});

describe("registration and password reset", () => {
  test("registration writes a user that can log in, and reset revokes sessions", async () => {
    const fixture = openFixture();
    try {
      const sent: string[] = [];
      const app = appFor(fixture.db, {
        mailer: {
          ready: true,
          send: (message) => {
            sent.push(message.body);
          },
        },
      });
      const config = loadConfig({ HBOX_OPTIONS_HOSTNAME: "http://homebox.local" }, [], migrationsDir);
      const hosted = createApp(config, process.env, {
        db: fixture.db,
        mailer: {
          ready: true,
          send: (message) => {
            sent.push(message.body);
          },
        },
      });

      const created = await app.request("http://127.0.0.1:7745/api/v1/users/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada", email: "New.User@Example.com", password: "secret1" }),
      });
      expect(created.status).toBe(204);
      const row = fixture.db.query(`SELECT email, password FROM users WHERE email = ?`).get("new.user@example.com") as {
        email: string;
        password: string;
      };
      expect(row.email).toBe("new.user@example.com");
      expect(row.password.startsWith("$argon2id$")).toBe(true);
      const group = fixture.db.query(`SELECT name FROM groups`).get() as { name: string };
      expect(group.name).toBe("Ada's Home");

      const short = await app.request("http://127.0.0.1:7745/api/v1/users/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Bo", email: "bo@example.com", password: "short" }),
      });
      expect(short.status).toBe(500);

      const loginResponse = await app.request("http://127.0.0.1:7745/api/v1/users/login", {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:7745" },
        body: JSON.stringify({ username: "new.user@example.com", password: "secret1", stayLoggedIn: false }),
      });
      expect(loginResponse.status).toBe(200);
      const raw = ((await loginResponse.json()) as { token: string }).token.slice("Bearer ".length);
      expect(countSessions(fixture.db, (fixture.db.query(`SELECT id FROM users WHERE email = ?`).get("new.user@example.com") as { id: Uint8Array }).id)).toBe(2);

      const forgot = await hosted.request("http://127.0.0.1:7745/api/v1/users/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "new.user@example.com" }),
      });
      expect(forgot.status).toBe(204);
      expect(sent.length).toBe(1);
      expect(sent[0]).toContain("http://homebox.local/reset-password?token=");
      const unknown = await hosted.request("http://127.0.0.1:7745/api/v1/users/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com" }),
      });
      expect(unknown.status).toBe(204);
      expect(sent.length).toBe(1);

      const link = /token=([^"<&]+)/.exec(sent[0]);
      expect(link).not.toBeNull();
      const token = decodeURIComponent(link![1]);
      expect(buildResetLink("http://homebox.local", token)).toContain(token);

      const reset = await hosted.request("http://127.0.0.1:7745/api/v1/users/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: "new-secret" }),
      });
      expect(reset.status).toBe(204);
      const userId = (fixture.db.query(`SELECT id FROM users WHERE email = ?`).get("new.user@example.com") as { id: Uint8Array }).id;
      expect(countSessions(fixture.db, userId)).toBe(0);
      const oldSession = await hosted.request("http://127.0.0.1:7745/api/v1/users/refresh", {
        headers: { cookie: `hb.auth.token=${raw}` },
      });
      expect(oldSession.status).toBe(401);
      const relogin = await hosted.request("http://127.0.0.1:7745/api/v1/users/login", {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:7745" },
        body: JSON.stringify({ username: "new.user@example.com", password: "new-secret", stayLoggedIn: false }),
      });
      expect(relogin.status).toBe(200);
      const reused = await hosted.request("http://127.0.0.1:7745/api/v1/users/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: "another-secret" }),
      });
      expect(reused.status).toBe(400);
    } finally {
      fixture.close();
    }
  });
});

describe("OIDC routes", () => {
  test("OIDC routes are absent unless a provider is configured", async () => {
    const fixture = openFixture();
    try {
      const app = appFor(fixture.db);
      const missing = await app.request("http://127.0.0.1:7745/api/v1/users/login/oidc");
      expect(missing.status).toBe(404);
      const callback = await app.request("http://127.0.0.1:7745/api/v1/users/login/oidc/callback");
      expect(callback.status).toBe(404);

      const runtime: OidcRuntime = {
        config: {
          ...loadConfig({}, []).oidc,
          enabled: true,
          clientId: "client",
          clientSecret: "secret",
          issuerUrl: "https://issuer.example",
          scope: "openid email",
        },
        endpoints: {
          issuer: "https://issuer.example",
          authorizationEndpoint: "https://issuer.example/auth",
          tokenEndpoint: "https://issuer.example/token",
          jwksUri: "https://issuer.example/jwks",
        },
        keys: [],
      };
      const configured = createApp(loadConfig({ HBOX_OIDC_ENABLED: "true", HBOX_AUTH_API_KEY_PEPPER: PEPPER }, []), process.env, {
        db: fixture.db,
        oidc: runtime,
      });
      const start = await configured.request("http://127.0.0.1:7745/api/v1/users/login/oidc", {
        headers: { host: "127.0.0.1:7745" },
      });
      expect(start.status).toBe(302);
      const location = start.headers.get("location") ?? "";
      expect(location.startsWith("https://issuer.example/auth?")).toBe(true);
      const params = new URL(location).searchParams;
      expect(params.get("code_challenge_method")).toBe("S256");
      expect(params.get("response_type")).toBe("code");
      const set = cookiesOf(start);
      expect(cookie(set, "oidc_state")).toContain("HttpOnly");
      expect(cookie(set, "oidc_state")).toContain("SameSite=Lax");
      expect(cookie(set, "oidc_nonce")).toContain("HttpOnly");
      expect(cookie(set, "oidc_pkce_verifier")).toContain("HttpOnly");
      const state = /oidc_state=([^;]+)/.exec(cookie(set, "oidc_state") ?? "")?.[1];
      const verifier = /oidc_pkce_verifier=([^;]+)/.exec(cookie(set, "oidc_pkce_verifier") ?? "")?.[1];
      expect(params.get("state")).toBe(state);
      expect(params.get("code_challenge")).toBe(pkceChallenge(verifier ?? ""));
      expect(authorizationUrl(runtime, "http://127.0.0.1:7745", "state", "nonce", "verifier")).toContain("code_challenge_method=S256");

      const status = await configured.request("http://127.0.0.1:7745/api/v1/status");
      const statusBody = (await status.json()) as { oidc: { enabled: boolean } };
      expect(statusBody.oidc.enabled).toBe(true);
      const plain = await app.request("http://127.0.0.1:7745/api/v1/status");
      expect(((await plain.json()) as { oidc: { enabled: boolean } }).oidc.enabled).toBe(false);
    } finally {
      fixture.close();
    }
  });

  test("OIDC startup refuses a configured provider that is missing its client id", async () => {
    const config = loadConfig(
      {
        HBOX_OIDC_ENABLED: "true",
        HBOX_OIDC_ISSUER_URL: "https://issuer.example",
        HBOX_AUTH_API_KEY_PEPPER: PEPPER,
      },
      [],
    );
    await expect(initOidc(config)).rejects.toThrow(/HBOX_OIDC_CLIENT_ID/);
  });
});

describe("API key pepper", () => {
  test("startup fails when the pepper is missing or shorter than 32 bytes", async () => {
    expect(() => assertApiKeyPepper("")).toThrow(StartupError);
    expect(() => assertApiKeyPepper("too-short")).toThrow(/HBOX_AUTH_API_KEY_PEPPER/);
    expect(() => assertApiKeyPepper(PEPPER)).not.toThrow();

    const proc = Bun.spawn([process.execPath, "src/index.ts"], {
      cwd: serverRoot,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        HBOX_DATABASE_SQLITE_PATH: join(tempDir(), "unused.db"),
        HBOX_MIGRATIONS_DIR: migrationsDir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(code).not.toBe(0);
    expect(stderr).toContain("HBOX_AUTH_API_KEY_PEPPER");
    expect(stderr).toContain("32 bytes");
  });
});
