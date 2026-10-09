import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createApp } from "../app.ts";
import { prepareDatabase } from "../boot.ts";
import { loadConfig } from "../config.ts";
import { setApiKeyPepper } from "./token.ts";

const migrationsDir = resolve(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const pepper = "test-pepper-not-for-production-use!!";
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("registration and a new collection can file items without seeing the other group", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hb-defaults-"));
  temps.push(dir);
  const sqlitePath = join(dir, "homebox.db");
  setApiKeyPepper(pepper);
  const prepared = prepareDatabase({
    HBOX_DATABASE_SQLITE_PATH: sqlitePath,
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_AUTH_API_KEY_PEPPER: pepper,
    HBOX_OPTIONS_ALLOW_REGISTRATION: "true",
    HBOX_WEB_PORT: "0",
  });
  const config = loadConfig(
    {
      HBOX_DATABASE_SQLITE_PATH: sqlitePath,
      HBOX_MIGRATIONS_DIR: migrationsDir,
      HBOX_AUTH_API_KEY_PEPPER: pepper,
      HBOX_OPTIONS_ALLOW_REGISTRATION: "true",
    },
    [],
    migrationsDir,
  );
  const app = createApp(config, process.env, { db: prepared.db });
  const base = "http://127.0.0.1:7745";

  const registered = await app.request(`${base}/api/v1/users/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada", email: "ada-defaults@example.com", password: "secret1" }),
  });
  expect(registered.status).toBe(204);

  const login = await app.request(`${base}/api/v1/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ada-defaults@example.com", password: "secret1", stayLoggedIn: false }),
  });
  expect(login.status).toBe(200);
  const token = ((await login.json()) as { token: string }).token;

  async function types(tenant?: string) {
    const headers: Record<string, string> = { authorization: token };
    if (tenant) headers["x-tenant"] = tenant;
    const response = await app.request(`${base}/api/v1/entity-types`, { headers });
    expect(response.status).toBe(200);
    return (await response.json()) as Array<{ id: string; name: string; isLocation: boolean }>;
  }

  const home = await types();
  expect(home.map((row) => row.name).sort()).toEqual(["Item", "Location"]);
  const homeItem = home.find((row) => !row.isLocation);
  expect(homeItem?.id).toBeTruthy();

  const createdGroup = await app.request(`${base}/api/v1/groups`, {
    method: "POST",
    headers: { authorization: token, "content-type": "application/json" },
    body: JSON.stringify({ name: "Cabin" }),
  });
  expect(createdGroup.status).toBe(201);
  const cabin = (await createdGroup.json()) as { id: string; name: string };
  expect(cabin.name).toBe("Cabin");

  const cabinTypes = await types(cabin.id);
  expect(cabinTypes.map((row) => row.name).sort()).toEqual(["Item", "Location"]);
  const cabinItem = cabinTypes.find((row) => !row.isLocation);
  expect(cabinItem?.id).toBeTruthy();
  expect(cabinItem?.id).not.toBe(homeItem?.id);

  const stool = await app.request(`${base}/api/v1/entities`, {
    method: "POST",
    headers: { authorization: token, "content-type": "application/json", "x-tenant": cabin.id },
    body: JSON.stringify({
      name: "Cabin stool",
      description: "",
      quantity: 1,
      parentId: null,
      entityTypeId: cabinItem?.id,
      tagIds: [],
    }),
  });
  expect(stool.status).toBe(201);
  const stoolId = ((await stool.json()) as { id: string }).id;

  const hidden = await app.request(`${base}/api/v1/entities/${stoolId}`, {
    headers: { authorization: token },
  });
  expect(hidden.status).not.toBe(200);

  const homeList = await app.request(`${base}/api/v1/entities?isLocation=false`, {
    headers: { authorization: token },
  });
  expect(homeList.status).toBe(200);
  const names = ((await homeList.json()) as { items: Array<{ name: string }> }).items.map((row) => row.name);
  expect(names).not.toContain("Cabin stool");
  prepared.db.close();
});
