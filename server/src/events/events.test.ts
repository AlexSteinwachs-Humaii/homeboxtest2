import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { startServer } from "../boot.ts";
import { insertEntityType, insertGroup, insertUser } from "../db/inventory.ts";
import { uuidToBytes } from "../db/storage.ts";
import { createSession } from "../auth/users.ts";
import { resetUuidGateForTests } from "../uuid-check.ts";
import {
  EventEntityMutation,
  EventExportMutation,
  EventImportMutation,
  EventTagMutation,
  EventUserMutation,
  WIRE_EVENT,
  bus,
  publishEntityMutation,
  publishExportMutation,
  publishImportMutation,
  publishUserMutation,
} from "./bus.ts";

const migrationsDir = resolve(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const PEPPER = "test-pepper-not-for-production-use!!";
const temps: string[] = [];
const stops: Array<() => void> = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  resetUuidGateForTests();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "homebox-events-"));
  temps.push(dir);
  return dir;
}

describe("in-process bus", () => {
  test("delivers a group event to a subscriber in this process and nowhere else", () => {
    const seen: string[] = [];
    const stop = bus.subscribe(EventEntityMutation, (groupId) => seen.push(groupId));
    const groupId = crypto.randomUUID();
    publishEntityMutation(groupId);
    stop();
    expect(seen).toEqual([groupId]);
    expect(WIRE_EVENT[EventTagMutation]).toBe("tag.mutation");
    expect(WIRE_EVENT[EventEntityMutation]).toBe("entity.mutation");
    expect(WIRE_EVENT[EventUserMutation]).toBe("user.mutation");
    expect(WIRE_EVENT[EventExportMutation]).toBe("export.mutation");
    expect(WIRE_EVENT[EventImportMutation]).toBe("import.mutation");
  });
});

describe("websocket invalidation", () => {
  test("authenticated sessions in the same group see mutations; another group and an anonymous client do not", async () => {
    const dir = tempDir();
    const running = await startServer({
      HBOX_DATABASE_DRIVER: "sqlite3",
      HBOX_DATABASE_SQLITE_PATH: join(dir, "homebox.db"),
      HBOX_MIGRATIONS_DIR: migrationsDir,
      HBOX_WEB_PORT: "0",
      HBOX_WEB_HOST: "127.0.0.1",
      HBOX_AUTH_API_KEY_PEPPER: PEPPER,
    });
    stops.push(running.stop);
    const { port } = running.server;
    const db = running.db;

    const groupA = insertGroup(db, { name: "Alpha", currency: "usd" });
    const groupB = insertGroup(db, { name: "Beta", currency: "eur" });
    const userA = insertUser(db, { name: "Ada", email: "ada@alpha.test", groupId: groupA });
    const userB = insertUser(db, { name: "Bea", email: "bea@beta.test", groupId: groupB });
    const typeA = insertEntityType(db, { name: "Item", groupId: groupA, isLocation: 0 });
    const sessionA = createSession(db, uuidToBytes(userA), false);
    const sessionA2 = createSession(db, uuidToBytes(userA), false);
    const sessionB = createSession(db, uuidToBytes(userB), false);

    const anonymous = await fetch(`http://127.0.0.1:${port}/api/v1/ws/events`);
    expect(anonymous.status).toBe(401);
    const upgradeDenied = await websocketOpened(port, undefined);
    expect(upgradeDenied).toBe(false);

    const plain = await fetch(`http://127.0.0.1:${port}/api/v1/ws/events`, {
      headers: { cookie: `hb.auth.token=${sessionA.raw}` },
    });
    expect(plain.status).toBe(400);

    const same = await connect(port, sessionA.raw, sessionA.attachmentToken, groupA);
    const second = await connect(port, sessionA2.raw, sessionA2.attachmentToken, groupA);
    const other = await connect(port, sessionB.raw, sessionB.attachmentToken, groupB);
    const otherEvents: string[] = [];
    other.addEventListener("message", (ev) => {
      const parsed = JSON.parse(String(ev.data)) as { event: string };
      if (parsed.event !== "ping") otherEvents.push(parsed.event);
    });

    const sameEvents = collect(same);
    const secondEvents = collect(second);

    const expectBoth = async (event: string) => {
      await expect(sameEvents.take()).resolves.toBe(event);
      await expect(secondEvents.take()).resolves.toBe(event);
    };

    const created = await json(port, sessionA.raw, "POST", "/api/v1/entities", {
      name: "Lamp",
      entityTypeId: typeA,
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string };
    await expectBoth("entity.mutation");

    const patched = await json(port, sessionA.raw, "PATCH", `/api/v1/entities/${createdBody.id}`, { name: "Lamp updated" });
    expect(patched.status).toBe(200);
    await expectBoth("entity.mutation");

    const removed = await json(port, sessionA.raw, "DELETE", `/api/v1/entities/${createdBody.id}`);
    expect(removed.status).toBe(204);
    await expectBoth("entity.mutation");

    const tag = await json(port, sessionA.raw, "POST", "/api/v1/tags", { name: "Lighting", color: "#fff", description: "", icon: "" });
    expect(tag.status).toBe(201);
    const tagBody = (await tag.json()) as { id: string };
    await expectBoth("tag.mutation");

    const renamed = await json(port, sessionA.raw, "PUT", `/api/v1/tags/${tagBody.id}`, { name: "Lights" });
    expect(renamed.status).toBe(200);
    await expectBoth("tag.mutation");

    const tagGone = await json(port, sessionA.raw, "DELETE", `/api/v1/tags/${tagBody.id}`);
    expect(tagGone.status).toBe(204);
    await expectBoth("tag.mutation");

    const foreignDelete = await json(port, sessionB.raw, "DELETE", `/api/v1/tags/${tagBody.id}`);
    expect(foreignDelete.status).toBe(404);

    publishUserMutation(groupA);
    publishExportMutation(groupA);
    publishImportMutation(groupA);
    await expectBoth("user.mutation");
    await expectBoth("export.mutation");
    await expectBoth("import.mutation");

    await Bun.sleep(50);
    expect(otherEvents).toEqual([]);

    same.close();
    second.close();
    other.close();
  });
});

function json(port: number, token: string, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      cookie: `hb.auth.token=${token}`,
      host: "127.0.0.1",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function connect(port: number, token: string, attachmentToken: string, tenant: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws/events?tenant=${tenant}`, {
      protocols: ["hb-auth", attachmentToken],
      headers: { cookie: `hb.auth.token=${token}`, host: "127.0.0.1" },
    });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("websocket open timed out"));
    }, 3000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket failed to open"));
    });
  });
}

function websocketOpened(port: number, token: string | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws/events`, token ? { headers: { cookie: `hb.auth.token=${token}` } } : undefined);
    let opened = false;
    const finish = (value: boolean) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(opened), 1000);
    ws.addEventListener("open", () => {
      opened = true;
      finish(true);
    });
    ws.addEventListener("error", () => finish(false));
    ws.addEventListener("close", () => finish(opened));
  });
}

function collect(ws: WebSocket): { take: () => Promise<string> } {
  const queued: string[] = [];
  const waiters: Array<(event: string) => void> = [];
  ws.addEventListener("message", (ev) => {
    const parsed = JSON.parse(String(ev.data)) as { event: string };
    if (parsed.event === "ping") return;
    const waiter = waiters.shift();
    if (waiter) waiter(parsed.event);
    else queued.push(parsed.event);
  });
  return {
    take: () =>
      new Promise((resolve, reject) => {
        const ready = queued.shift();
        if (ready) {
          resolve(ready);
          return;
        }
        const timer = setTimeout(() => reject(new Error("timed out waiting for event")), 2000);
        waiters.push((event) => {
          clearTimeout(timer);
          resolve(event);
        });
      }),
  };
}
