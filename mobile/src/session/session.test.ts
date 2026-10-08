import assert from "node:assert/strict";
import test from "node:test";

import type { FetchLike } from "../api/client";
import { MemorySessionStore, restoreSession, signIn, signOut, type StoredSession } from "./session";

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

type Call = { url: string; init?: RequestInit };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function router(handlers: Record<string, (call: Call) => Response | Promise<Response>>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const path = new URL(url).pathname;
    const handler = handlers[path];
    if (!handler) return json(404, { error: `unexpected ${path}` });
    return handler(call);
  };
  return { fetch: fetchImpl, calls };
}

test("sign-in stores a session only after the server returns the account", async () => {
  const store = new MemorySessionStore();
  const { fetch, calls } = router({
    "/api/v1/users/login": () => json(200, { token: "Bearer fresh", attachmentToken: "attach", expiresAt: "2026-11-01T00:00:00.000Z" }),
    "/api/v1/users/self": (call) => {
      assert.equal((call.init?.headers as Record<string, string>).Authorization, "Bearer fresh");
      return json(200, { item: USER });
    },
  });

  const result = await signIn(
    { store, fetch },
    { serverUrl: "192.168.1.20:7745", username: " ada@example.com ", password: "correct-horse", stayLoggedIn: true },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.account.name, "Ada Lovelace");
  assert.equal(result.account.email, "ada@example.com");
  assert.equal(result.account.serverUrl, "http://192.168.1.20:7745");
  assert.equal(store.saves, 1);
  assert.equal(store.value?.token, "Bearer fresh");
  assert.equal(store.value?.attachmentToken, "attach");
  assert.equal("name" in (store.value ?? {}), false);
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ["/api/v1/users/login", "/api/v1/users/self"],
  );
});

test("a wrong password shows a failed sign-in and does not store a session", async () => {
  const store = new MemorySessionStore();
  store.save = async () => {
    throw new Error("save must not be called");
  };
  const { fetch, calls } = router({
    "/api/v1/users/login": () => json(401, { error: "unauthorized" }),
    "/api/v1/users/self": () => {
      throw new Error("self must not be called");
    },
  });

  const result = await signIn({ store, fetch }, { serverUrl: "http://127.0.0.1:7745", username: "ada@example.com", password: "wrong" });
  assert.deepEqual(result, { ok: false, message: "Invalid email or password" });
  assert.equal(store.value, null);
  assert.equal(calls.length, 1);
});

test("sign-in does not store a session when the account call fails", async () => {
  const store = new MemorySessionStore();
  const { fetch } = router({
    "/api/v1/users/login": () => json(200, { token: "Bearer fresh", attachmentToken: "attach", expiresAt: "2026-11-01T00:00:00.000Z" }),
    "/api/v1/users/self": () => json(500, { error: "internal error" }),
  });
  const result = await signIn({ store, fetch }, { serverUrl: "http://127.0.0.1:7745", username: "ada@example.com", password: "correct-horse" });
  assert.equal(result.ok, false);
  assert.equal(store.saves, 0);
  assert.equal(store.value, null);
});

test("reopening asks the server who you are and does not invent an account from storage", async () => {
  const store = new MemorySessionStore();
  const stored: StoredSession = {
    serverUrl: "http://192.168.1.20:7745",
    token: "Bearer saved",
    attachmentToken: "attach",
    expiresAt: "2026-11-01T00:00:00.000Z",
  };
  await store.save(stored);
  store.saves = 0;

  const { fetch, calls } = router({
    "/api/v1/users/self": (call) => {
      assert.equal((call.init?.headers as Record<string, string>).Authorization, "Bearer saved");
      return json(200, { item: { ...USER, name: "From the server" } });
    },
  });

  const result = await restoreSession({ store, fetch });
  assert.equal(result.status, "signed-in");
  if (result.status !== "signed-in") return;
  assert.equal(result.account.name, "From the server");
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/api/v1/users/self");
  assert.equal(store.saves, 0);
});

test("reopening refreshes an expired token, then confirms the account with the server", async () => {
  const store = new MemorySessionStore();
  await store.save({
    serverUrl: "http://127.0.0.1:7745",
    token: "Bearer old",
    attachmentToken: "attach-old",
    expiresAt: "2026-10-01T00:00:00.000Z",
  });
  store.saves = 0;

  let selfCalls = 0;
  const { fetch } = router({
    "/api/v1/users/self": (call) => {
      selfCalls += 1;
      const authorization = (call.init?.headers as Record<string, string>).Authorization;
      if (selfCalls === 1) {
        assert.equal(authorization, "Bearer old");
        return json(401, { error: "unauthorized" });
      }
      assert.equal(authorization, "Bearer rotated");
      return json(200, { item: USER });
    },
    "/api/v1/users/refresh": (call) => {
      assert.equal((call.init?.headers as Record<string, string>).Authorization, "Bearer old");
      assert.equal(call.init?.method, "GET");
      return json(200, { raw: "rotated", attachmentToken: "attach-new", expiresAt: "2026-12-01T00:00:00.000Z" });
    },
  });

  const result = await restoreSession({ store, fetch });
  assert.equal(result.status, "signed-in");
  assert.equal(store.value?.token, "Bearer rotated");
  assert.equal(store.value?.attachmentToken, "attach-new");
  assert.equal(store.saves, 1);
});

test("a rejected refresh clears the session instead of keeping a dead token", async () => {
  const store = new MemorySessionStore();
  await store.save({
    serverUrl: "http://127.0.0.1:7745",
    token: "Bearer old",
    attachmentToken: "attach",
    expiresAt: "2026-10-01T00:00:00.000Z",
  });
  const { fetch } = router({
    "/api/v1/users/self": () => json(401, { error: "unauthorized" }),
    "/api/v1/users/refresh": () => json(401, { error: "unauthorized" }),
  });
  const result = await restoreSession({ store, fetch });
  assert.equal(result.status, "signed-out");
  if (result.status !== "signed-out") return;
  assert.match(result.message ?? "", /expired/i);
  assert.equal(store.value, null);
  assert.equal(store.clears, 1);
});

test("an unreachable server on reopen keeps the token and does not show a cached account", async () => {
  const store = new MemorySessionStore();
  await store.save({
    serverUrl: "http://127.0.0.1:7745",
    token: "Bearer saved",
    attachmentToken: "attach",
    expiresAt: "2026-11-01T00:00:00.000Z",
  });
  const fetch: FetchLike = async () => {
    throw new Error("offline");
  };
  const result = await restoreSession({ store, fetch });
  assert.equal(result.status, "offline");
  assert.equal(store.value?.token, "Bearer saved");
  assert.equal(store.clears, 0);
});

test("sign-out tells the server and then forgets the token", async () => {
  const store = new MemorySessionStore();
  const session: StoredSession = {
    serverUrl: "http://127.0.0.1:7745",
    token: "Bearer saved",
    attachmentToken: "attach",
    expiresAt: "2026-11-01T00:00:00.000Z",
  };
  await store.save(session);
  const { fetch, calls } = router({
    "/api/v1/users/logout": (call) => {
      assert.equal(call.init?.method, "POST");
      assert.equal((call.init?.headers as Record<string, string>).Authorization, "Bearer saved");
      return new Response(null, { status: 204 });
    },
  });
  await signOut({ store, fetch }, session);
  assert.equal(calls.length, 1);
  assert.equal(store.value, null);
});
