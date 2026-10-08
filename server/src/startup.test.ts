import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

import { prepareDatabase, startServer } from "./boot.ts";
import { loadConfig, sqliteFileFromSetting } from "./config.ts";
import { BUSY_TIMEOUT_MS, openDatabase } from "./db.ts";
import { StartupError } from "./errors.ts";
import {
  MERGE_ENTITIES_VERSION,
  SYNC_CHILDREN_VERSION,
  collectMigrations,
  missingGoMigrationMessage,
  readGooseRows,
  runMigrations,
} from "./migrate.ts";
import { drizzleClientAttached, resetUuidGateForTests, uuidMappingCommitted } from "./uuid-check.ts";

const migrationsDir = resolve(import.meta.dir, "../../backend/internal/data/migrations/sqlite3");
const repoRoot = resolve(import.meta.dir, "../..");
const serverRoot = resolve(import.meta.dir, "..");
const temps: string[] = [];
const stops: Array<() => void> = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  resetUuidGateForTests();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "homebox-server-"));
  temps.push(dir);
  return dir;
}

function dbPath(dir: string, name = "homebox.db"): string {
  return join(dir, name);
}

function envFor(path: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    HBOX_DATABASE_DRIVER: "sqlite3",
    HBOX_DATABASE_SQLITE_PATH: path,
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_WEB_PORT: "0",
    HBOX_WEB_HOST: "127.0.0.1",
    ...extra,
  };
}

const GROUP_ID = new Uint8Array([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);
const LOCATION_ID = new Uint8Array(16).fill(0x11);
const ITEM_ID = new Uint8Array(16).fill(0x22);

describe("sqlite path and postgres rejection", () => {
  test("strips the Go _pragma query string and defaults to /data/homebox.db", () => {
    expect(
      sqliteFileFromSetting(
        "/data/homebox.db?_pragma=busy_timeout=1000&_pragma=journal_mode=WAL&_fk=1&_time_format=sqlite",
      ),
    ).toBe("/data/homebox.db");
    expect(sqliteFileFromSetting(undefined)).toBe("/data/homebox.db");
    expect(sqliteFileFromSetting("file:///data/homebox.db?_fk=1")).toBe("/data/homebox.db");

    const config = loadConfig({}, []);
    expect(config.port).toBe(7745);
    expect(config.sqlitePath).toBe("/data/homebox.db");
    expect(config.staticDir).toBe("frontend/.output/public");
  });

  test("a config file path is honored and still has its Go pragma query stripped", () => {
    const dir = tempDir();
    const file = join(dir, "config.yml");
    writeFileSync(
      file,
      "database:\n  driver: sqlite3\n  sqlite_path: /var/lib/homebox/homebox.db?_pragma=journal_mode=DELETE&_fk=1\nweb:\n  port: 7745\n",
    );
    const config = loadConfig({}, [file]);
    expect(config.sqlitePath).toBe("/var/lib/homebox/homebox.db");
    expect(config.port).toBe(7745);
    const missing = loadConfig({ HBOX_DATABASE_SQLITE_PATH: ".data/homebox.db?_fk=1" }, [join(dir, "missing.yml")]);
    expect(missing.sqlitePath).toBe(".data/homebox.db");
  });

  test("a postgres driver or DSN is rejected and does not open a database", () => {
    expect(() => loadConfig({ HBOX_DATABASE_DRIVER: "postgres" }, [])).toThrow(StartupError);
    expect(() => loadConfig({ HBOX_DATABASE_DRIVER: "postgres" }, [])).toThrow(/not supported/);
    expect(() => loadConfig({ HBOX_DATABASE_DRIVER: "postgres" }, [])).toThrow(/PostgreSQL/);
    expect(() =>
      loadConfig({ HBOX_DATABASE_SQLITE_PATH: "postgres://homebox:secret@localhost:5432/homebox" }, []),
    ).toThrow(/not supported/);
  });

  test("the process exits non-zero on a postgres DSN", async () => {
    const proc = Bun.spawn([process.execPath, "src/index.ts"], {
      cwd: serverRoot,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        HBOX_DATABASE_DRIVER: "postgresql",
        HBOX_DATABASE_SQLITE_PATH: "postgres://localhost/homebox",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(code).not.toBe(0);
    expect(stderr).toContain("not supported");
    expect(stderr).toContain("PostgreSQL");
  });
});

describe("goose and pragmas", () => {
  test("a current database opens in WAL and a second start does not duplicate goose rows", () => {
    const dir = tempDir();
    const path = dbPath(dir);
    const legacyPath = `${path}?_pragma=busy_timeout=1&_pragma=journal_mode=DELETE&_fk=1`;

    const first = prepareDatabase(envFor(legacyPath));
    expect(first.pragmas.journalMode).toBe("wal");
    expect(first.pragmas.foreignKeys).toBe(1);
    expect(first.pragmas.busyTimeout).toBe(BUSY_TIMEOUT_MS);
    expect(first.applied.length).toBeGreaterThan(0);
    expect(first.applied).toContain(SYNC_CHILDREN_VERSION);
    expect(first.applied).toContain(MERGE_ENTITIES_VERSION);
    const rowsAfterFirst = first.gooseRows.map((row) => ({ ...row }));
    expect(rowsAfterFirst.filter((row) => row.versionId === MERGE_ENTITIES_VERSION)).toHaveLength(1);
    first.db.close();

    resetUuidGateForTests();
    const second = prepareDatabase(envFor(path));
    expect(second.applied).toEqual([]);
    expect(second.gooseRows).toEqual(rowsAfterFirst);
    expect(second.pragmas.journalMode).toBe("wal");
    expect(second.pragmas.busyTimeout).toBe(BUSY_TIMEOUT_MS);
    second.db.close();
  });

  test("a database behind merge_entities is upgraded without replaying earlier versions", () => {
    const dir = tempDir();
    const path = dbPath(dir);
    const db = openDatabase(path);
    runMigrations(db, migrationsDir, { maxVersionExclusive: MERGE_ENTITIES_VERSION });

    db.run(
      "INSERT INTO groups (id, created_at, updated_at, name, currency) VALUES (?, '2020-01-01 00:00:00', '2020-01-01 00:00:00', 'Home', 'usd')",
      [GROUP_ID],
    );
    db.run(
      "INSERT INTO locations (id, created_at, updated_at, name, group_locations) VALUES (?, '2020-01-01 00:00:00', '2020-01-01 00:00:00', 'Kitchen', ?)",
      [LOCATION_ID, GROUP_ID],
    );
    db.run(
      "INSERT INTO items (id, created_at, updated_at, name, group_items, location_items) VALUES (?, '2020-01-01 00:00:00', '2020-01-01 00:00:00', 'Mug', ?, ?)",
      [ITEM_ID, GROUP_ID, LOCATION_ID],
    );
    const before = readGooseRows(db);
    expect(before.some((row) => row.versionId === MERGE_ENTITIES_VERSION)).toBe(false);
    const initCount = before.filter((row) => row.versionId === 20220929052825).length;
    db.close();

    resetUuidGateForTests();
    const prepared = prepareDatabase(envFor(path));
    expect(prepared.applied).toContain(MERGE_ENTITIES_VERSION);
    expect(prepared.applied).not.toContain(20220929052825);
    expect(prepared.applied).not.toContain(SYNC_CHILDREN_VERSION);
    const initAfter = prepared.gooseRows.filter((row) => row.versionId === 20220929052825);
    expect(initAfter).toHaveLength(initCount);
    expect(prepared.gooseRows.filter((row) => row.versionId === MERGE_ENTITIES_VERSION)).toHaveLength(1);

    const row = prepared.db
      .query("SELECT typeof(id) AS t, length(id) AS n, hex(id) AS hex, hex(entity_children) AS parent FROM entities WHERE name = 'Mug'")
      .get() as { t: string; n: number; hex: string; parent: string };
    expect(row.t).toBe("blob");
    expect(row.n).toBe(16);
    expect(row.hex).toBe(Buffer.from(ITEM_ID).toString("hex").toUpperCase());
    expect(row.parent).toBe(Buffer.from(LOCATION_ID).toString("hex").toUpperCase());
    prepared.db.close();
  });

  test("an unported goose version refuses to start and names the version", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "20990101010101_not_ported.go"), "package sqlite3\n");
    const db = openDatabase(dbPath(dir, "empty.db"));
    expect(() => runMigrations(db, dir)).toThrow(StartupError);
    expect(() => runMigrations(db, dir)).toThrow(/20990101010101/);
    expect(() => runMigrations(db, dir)).toThrow(/not_ported/);
    expect(missingGoMigrationMessage(20990101010101, "not_ported")).toContain("20990101010101");
    const rows = readGooseRows(db);
    expect(rows.some((row) => row.versionId === 20990101010101)).toBe(false);
    db.close();
  });
});

describe("uuid blob check", () => {
  test("records typeof(id) and does not commit mapping when id is not a 16-byte blob", () => {
    const dir = tempDir();
    const path = dbPath(dir);
    const seeded = prepareDatabase(envFor(path));
    seeded.db.exec("PRAGMA foreign_keys = OFF");
    seeded.db.run(
      "INSERT INTO entities (id, created_at, updated_at, name, group_entities, entity_type_entities) VALUES ('00112233-4455-6677-8899-aabbccddeeff', datetime('now'), datetime('now'), 'Text', x'00', x'00')",
    );
    seeded.db.run(
      "INSERT INTO groups (id, created_at, updated_at, name) VALUES (?, datetime('now'), datetime('now'), 'Home')",
      [GROUP_ID],
    );
    const observed = seeded.db.query("SELECT typeof(id) AS t, length(id) AS n FROM entities LIMIT 1").get() as {
      t: string;
      n: number;
    };
    expect(observed.t).toBe("text");
    expect(observed.n).toBe(36);
    seeded.db.close();

    resetUuidGateForTests();
    expect(uuidMappingCommitted()).toBe(false);
    expect(drizzleClientAttached()).toBe(false);
    expect(() => prepareDatabase(envFor(path))).toThrow(/16-byte blob/);
    expect(() => prepareDatabase(envFor(path))).toThrow(/entities\.id is text/);
    expect(uuidMappingCommitted()).toBe(false);
    expect(drizzleClientAttached()).toBe(false);

    const check = new Database(path);
    const versions = check.query("SELECT version_id, count(*) AS n FROM goose_db_version GROUP BY version_id").all() as Array<{
      version_id: number;
      n: number;
    }>;
    expect(versions.every((row) => row.n === 1)).toBe(true);
    expect(check.query("SELECT typeof(id) AS t FROM entities LIMIT 1").get()).toEqual({ t: "text" });
    check.close();
  });

  test("a 16-byte blob id is recorded and mapping may be attached", () => {
    const dir = tempDir();
    const path = dbPath(dir);
    const seeded = prepareDatabase(envFor(path));
    seeded.db.exec("PRAGMA foreign_keys = OFF");
    seeded.db.run(
      "INSERT INTO groups (id, created_at, updated_at, name) VALUES (?, datetime('now'), datetime('now'), 'Home')",
      [GROUP_ID],
    );
    seeded.db.run(
      "INSERT INTO users (id, created_at, updated_at, name, email) VALUES (?, datetime('now'), datetime('now'), 'Ada', 'ada@example.com')",
      [GROUP_ID],
    );
    seeded.db.run(
      "INSERT INTO entities (id, created_at, updated_at, name, group_entities, entity_type_entities) VALUES (?, datetime('now'), datetime('now'), 'Mug', ?, ?)",
      [ITEM_ID, GROUP_ID, GROUP_ID],
    );
    seeded.db.close();

    resetUuidGateForTests();
    const prepared = prepareDatabase(envFor(path));
    for (const table of ["entities", "users", "groups"] as const) {
      const observation = prepared.observations.find((item) => item.table === table);
      expect(observation?.type).toBe("blob");
      expect(observation?.length).toBe(16);
    }
    expect(uuidMappingCommitted()).toBe(true);
    expect(drizzleClientAttached()).toBe(true);
    prepared.db.close();
  });
});

describe("http", () => {
  test("listens on port 7745 and serves the already-built Vue assets", async () => {
    const dir = tempDir();
    const publicDir = join(dir, "public");
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(publicDir, "index.html"), "<!doctype html><head><title>Homebox</title></head><body>inventory</body>");
    writeFileSync(join(publicDir, "app.js"), "console.log('asset');");

    const running = await startServer(
      envFor(dbPath(dir), {
        HBOX_WEB_PORT: "7745",
        HBOX_STATIC_DIR: publicDir,
        LARINE_ACTIVE_WORK_ITEM_ID: "wi-1",
        HBOX_AUTH_API_KEY_PEPPER: "test-pepper-not-for-production-use!!",
      }),
    );
    stops.push(running.stop);

    expect(running.server.port).toBe(7745);
    const status = await fetch("http://127.0.0.1:7745/api/v1/status");
    expect(status.status).toBe(200);
    const body = (await status.json()) as { health: boolean };
    expect(body.health).toBe(true);

    const home = await fetch("http://127.0.0.1:7745/");
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain("inventory");
    expect(html).toContain("window.__LARINE_ACTIVE_WORK_ITEM_ID__=");
    expect(home.headers.get("cache-control")).toBe("no-store");

    const route = await fetch("http://127.0.0.1:7745/login");
    expect(await route.text()).toContain("inventory");

    const asset = await fetch("http://127.0.0.1:7745/app.js");
    expect(await asset.text()).toContain("console.log");
    expect(asset.headers.get("content-type")).toContain("javascript");
  });
});

describe("production image", () => {
  test("Dockerfiles run Bun, keep port 7745 and /data, and do not compile Go", () => {
    for (const name of ["Dockerfile", "Dockerfile.rootless", "Dockerfile.hardened"]) {
      const text = readFileSync(join(repoRoot, name), "utf8");
      expect(text).toContain("oven/bun");
      expect(text).toContain("7745");
      expect(text).toContain('VOLUME [ "/data" ]');
      expect(text).toContain(".output/public");
      expect(text.toLowerCase()).not.toContain("golang");
      expect(text).not.toContain("CGO_ENABLED");
      expect(text).not.toContain("/go/bin/api");
      expect(text).not.toContain("go build");
    }
    const compose = readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");
    expect(compose).toContain("7745");
  });

  test("repo migrations include the two Go versions the server ports", () => {
    const migrations = collectMigrations(migrationsDir);
    expect(migrations.find((migration) => migration.version === SYNC_CHILDREN_VERSION)?.name).toBe("sync_children");
    expect(migrations.find((migration) => migration.version === MERGE_ENTITIES_VERSION)?.name).toBe("merge_entities");
  });
});
