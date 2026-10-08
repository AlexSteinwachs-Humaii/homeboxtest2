import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizationHeader,
  defaultWebServerUrl,
  HomeboxClient,
  normalizeServerUrl,
  readUser,
  resolveClientServerUrl,
  ServerUrlError,
} from "./client";

const USER = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  isSuperuser: false,
  oidcIssuer: "",
  oidcSubject: "",
  defaultGroupId: "group-1",
  groupIds: ["group-1"],
};

function json(status: number, body: unknown, statusText = "OK"): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });
}

test("normalizeServerUrl accepts a bare LAN address and strips an API suffix", () => {
  assert.equal(normalizeServerUrl("  192.168.1.20:7745/ "), "http://192.168.1.20:7745");
  assert.equal(normalizeServerUrl("https://home.example.com/api/v1/users/login"), "https://home.example.com");
  assert.equal(normalizeServerUrl("https://home.example.com/homebox/api/v1"), "https://home.example.com/homebox");
});

test("normalizeServerUrl rejects missing, credential, and non-http addresses", () => {
  assert.throws(() => normalizeServerUrl("   "), ServerUrlError);
  assert.throws(() => normalizeServerUrl("ftp://files.example.com"), ServerUrlError);
  assert.throws(() => normalizeServerUrl("http://ada:secret@192.168.1.20:7745"), ServerUrlError);
});

test("the web export uses the page origin and /api/v1, not an Expo API route or a local database", async () => {
  const previous = process.env.EXPO_PUBLIC_HOMEBOX_API_ORIGIN;
  process.env.EXPO_PUBLIC_HOMEBOX_API_ORIGIN = "same";
  const scope = globalThis as { location?: { origin?: string } };
  const prior = scope.location;
  scope.location = { origin: "http://127.0.0.1:7745" };
  try {
    assert.equal(defaultWebServerUrl(), "http://127.0.0.1:7745");
    assert.equal(resolveClientServerUrl(""), "http://127.0.0.1:7745");
    assert.equal(resolveClientServerUrl("http://192.168.1.20:7745"), "http://192.168.1.20:7745");
    const calls: string[] = [];
    const client = new HomeboxClient(resolveClientServerUrl(""), "", async (url) => {
      calls.push(url);
      return json(200, { token: "Bearer fresh", attachmentToken: "attach", expiresAt: "2026-11-01T00:00:00.000Z" });
    });
    await client.login("ada@example.com", "correct-horse", true);
    assert.equal(calls[0], "http://127.0.0.1:7745/api/v1/users/login");
    assert.equal(calls[0]?.includes("/api/v1/"), true);
    assert.equal(calls[0]?.includes("homebox.db"), false);
    assert.equal(/\/api\/(?!v1)/.test(calls[0] ?? ""), false);
  } finally {
    if (prior === undefined) delete scope.location;
    else scope.location = prior;
    if (previous === undefined) delete process.env.EXPO_PUBLIC_HOMEBOX_API_ORIGIN;
    else process.env.EXPO_PUBLIC_HOMEBOX_API_ORIGIN = previous;
  }
});

test("authorizationHeader sends the login token as Bearer and does not double-prefix it", () => {
  assert.equal(authorizationHeader("Bearer session-raw"), "Bearer session-raw");
  assert.equal(authorizationHeader("session-raw"), "Bearer session-raw");
  assert.equal(authorizationHeader("bearer session-raw"), "Bearer session-raw");
});

test("login posts JSON to /api/v1/users/login without an Authorization header", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new HomeboxClient("http://192.168.1.20:7745", "Bearer stale", async (url, init) => {
    calls.push({ url, init });
    return json(200, { token: "Bearer fresh", attachmentToken: "attach", expiresAt: "2026-11-01T00:00:00.000Z" });
  });

  const result = await client.login("Ada@Example.com", "correct-horse", true);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.token, "Bearer fresh");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://192.168.1.20:7745/api/v1/users/login");
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(calls[0]?.init?.credentials, "omit");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ username: "Ada@Example.com", password: "correct-horse", stayLoggedIn: true }));
  assert.equal(String(calls[0]?.url).includes("password"), false);
});

test("a wrong password is a failed login and does not look like a stored session", async () => {
  const client = new HomeboxClient("http://127.0.0.1:7745", "", async () => json(401, { error: "unauthorized" }, "Unauthorized"));
  const result = await client.login("ada@example.com", "wrong-password", false);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 401);
  assert.equal(result.error, "Invalid email or password");
});

test("self sends the session token and reads the wrapped account", async () => {
  let authorization = "";
  const client = new HomeboxClient("https://home.example.com", "Bearer session-raw", async (url, init) => {
    authorization = (init?.headers as Record<string, string>).Authorization ?? "";
    assert.equal(url, "https://home.example.com/api/v1/users/self");
    return json(200, { item: USER });
  });
  const result = await client.self();
  assert.equal(authorization, "Bearer session-raw");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.item, USER);
  assert.deepEqual(readUser({ item: USER })?.email, "ada@example.com");
  assert.equal(readUser(USER), null);
});

test("refresh reads the rotated raw token", async () => {
  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer old", async () =>
    json(200, { raw: "rotated", attachmentToken: "attach-2", expiresAt: "2026-12-01T00:00:00.000Z" }),
  );
  const result = await client.refresh();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.raw, "rotated");
});

test("a network failure is not a stored session", async () => {
  const client = new HomeboxClient("http://127.0.0.1:7745", "", async () => {
    throw new Error("connect ECONNREFUSED");
  });
  const result = await client.login("ada@example.com", "secret", false);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 0);
});
