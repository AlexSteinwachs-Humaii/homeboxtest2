import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { AuthError, login, registerUser } from "../auth/users.ts";
import { prepareDatabase, startServer } from "../boot.ts";
import { resetUuidGateForTests } from "../uuid-check.ts";
import { DEMO_EMAIL, DEMO_ITEM_NAMES, DEMO_PASSWORD_DEFAULT, seedDemoDatabase } from "./seed.ts";

const migrationsDir = resolve(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const temps: string[] = [];
const stops: Array<() => void> = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  resetUuidGateForTests();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "homebox-demo-"));
  temps.push(dir);
  return dir;
}

function envFor(path: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    HBOX_DATABASE_DRIVER: "sqlite3",
    HBOX_DATABASE_SQLITE_PATH: path,
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_WEB_PORT: "0",
    HBOX_WEB_HOST: "127.0.0.1",
    HBOX_AUTH_API_KEY_PEPPER: "test-pepper-not-for-production-use!!",
    UNSAFE_DISABLE_PASSWORD_PROJECTION: "yes_i_am_sure",
    ...extra,
  };
}

function names(db: { query: (sql: string) => { all: () => Array<{ name: string }> } }): string[] {
  return db.query(`SELECT name FROM entities`).all().map((row) => row.name);
}

describe("demo seed", () => {
  test("registers the Go demo user and imports the demo inventory once", async () => {
    const dir = tempDir();
    const env = envFor(join(dir, "homebox.db"));
    const prepared = prepareDatabase(env);
    const first = await seedDemoDatabase(prepared.db, env);
    expect(first.skipped).toBe(false);
    expect(first.imported).toBe(DEMO_ITEM_NAMES.length);
    expect(first.email).toBe(DEMO_EMAIL);

    const stored = names(prepared.db);
    for (const name of DEMO_ITEM_NAMES) expect(stored).toContain(name);
    expect(stored).toContain("Garage");
    expect(stored).toContain("Downstairs");
    const tags = prepared.db.query(`SELECT name FROM tags`).all() as Array<{ name: string }>;
    expect(tags.map((tag) => tag.name).sort()).toEqual(["Home Assistant", "IOT", "Z-Wave"]);

    const session = await login(prepared.db, DEMO_EMAIL, DEMO_PASSWORD_DEFAULT, false, env);
    expect(session.raw.length).toBeGreaterThan(10);
    const wrong = login(prepared.db, DEMO_EMAIL, "not-the-demo-password", false, env);
    await expect(wrong).rejects.toThrow(/invalid username or password/);

    const again = await seedDemoDatabase(prepared.db, env);
    expect(again.skipped).toBe(true);
    expect(again.imported).toBe(0);
    expect(names(prepared.db).filter((name) => (DEMO_ITEM_NAMES as readonly string[]).includes(name))).toHaveLength(
      DEMO_ITEM_NAMES.length,
    );
    prepared.db.close();
  });

  test("accepts a short HBOX_DEMO_PASSWORD that public registration still rejects", async () => {
    const dir = tempDir();
    const env = envFor(join(dir, "homebox.db"), { HBOX_DEMO_PASSWORD: "x" });
    const prepared = prepareDatabase(env);
    await expect(registerUser(prepared.db, { name: "Ada", email: "ada@example.com", password: "x" }, env)).rejects.toBeInstanceOf(
      AuthError,
    );
    const seeded = await seedDemoDatabase(prepared.db, env);
    expect(seeded.skipped).toBe(false);
    const session = await login(prepared.db, "Demo@Example.com", "x", false, env);
    expect(session.raw.length).toBeGreaterThan(10);
    prepared.db.close();
  });

  test("startup seeds only when demo mode is on, and a second start does not duplicate rows", async () => {
    const dir = tempDir();
    const path = join(dir, "homebox.db");
    const off = await startServer(envFor(path));
    stops.push(off.stop);
    const before = off.db.query(`SELECT count(*) AS n FROM users`).get() as { n: number };
    expect(before.n).toBe(0);
    off.stop();
    stops.pop();

    resetUuidGateForTests();
    const on = await startServer(envFor(path, { HBOX_DEMO: "true" }));
    stops.push(on.stop);
    const users = on.db.query(`SELECT email FROM users`).all() as Array<{ email: string }>;
    expect(users.map((row) => row.email)).toEqual([DEMO_EMAIL]);
    expect(names(on.db)).toEqual(expect.arrayContaining([...DEMO_ITEM_NAMES]));

    const port = on.server.port;
    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/v1/users/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: DEMO_EMAIL, password: DEMO_PASSWORD_DEFAULT, stayLoggedIn: false }),
    });
    expect(loginResponse.status).toBe(200);
    const token = ((await loginResponse.json()) as { token: string }).token;
    const list = await fetch(`http://127.0.0.1:${port}/api/v1/entities`, {
      headers: { authorization: token },
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: Array<{ name: string }> };
    for (const name of DEMO_ITEM_NAMES) {
      expect(body.items.some((item) => item.name === name)).toBe(true);
    }
    on.stop();
    stops.pop();

    resetUuidGateForTests();
    const second = await startServer(envFor(path, { HBOX_DEMO: "true" }));
    stops.push(second.stop);
    const count = second.db.query(`SELECT count(*) AS n FROM users`).get() as { n: number };
    expect(count.n).toBe(1);
    expect(names(second.db).filter((name) => (DEMO_ITEM_NAMES as readonly string[]).includes(name))).toHaveLength(
      DEMO_ITEM_NAMES.length,
    );
  });
});
