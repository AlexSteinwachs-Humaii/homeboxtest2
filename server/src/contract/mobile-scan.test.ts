import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HomeboxClient } from "../../../mobile/src/api/client.ts";
import { resolveCode, searchItems } from "../../../mobile/src/scan/lookup.ts";
import { createApp } from "../app.ts";
import { createSession } from "../auth/users.ts";
import { prepareDatabase } from "../boot.ts";
import { loadConfig } from "../config.ts";
import { insertEntity, insertEntityType, insertGroup, insertUser } from "../db/inventory.ts";
import { uuidToBytes } from "../db/storage.ts";

const migrationsDir = join(import.meta.dir, "../../../backend/internal/data/migrations/sqlite3");
const pepper = "test-pepper-not-for-production-use!!";

function openDb() {
  const dir = mkdtempSync(join(tmpdir(), "hb-mobile-scan-"));
  return prepareDatabase({
    HBOX_DATABASE_SQLITE_PATH: join(dir, "homebox.db"),
    HBOX_MIGRATIONS_DIR: migrationsDir,
    HBOX_AUTH_API_KEY_PEPPER: pepper,
    HBOX_WEB_PORT: "0",
  }).db;
}

test("phone search matches the server accent fold and a label from another group does not open", async () => {
  const db = openDb();
  const groupA = insertGroup(db, { name: "Home", currency: "usd" });
  const groupB = insertGroup(db, { name: "Cabin", currency: "eur" });
  const owner = insertUser(db, { name: "Ada", email: "ada@home.test", groupId: groupA });
  db.run(`INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, ?)`, [uuidToBytes(owner), uuidToBytes(groupB), "member"]);
  const typeA = insertEntityType(db, { name: "Item", groupId: groupA, isLocation: 0 });
  const typeB = insertEntityType(db, { name: "Item", groupId: groupB, isLocation: 0 });
  insertEntity(db, { name: "café", groupId: groupA, entityTypeId: typeA, assetId: 42 });
  const secret = insertEntity(db, { name: "café secret", groupId: groupB, entityTypeId: typeB, assetId: 99 });
  const session = createSession(db, uuidToBytes(owner), false);

  const config = loadConfig(
    {
      HBOX_DATABASE_SQLITE_PATH: ":memory:",
      HBOX_AUTH_API_KEY_PEPPER: pepper,
      HBOX_OPTIONS_ALLOW_REGISTRATION: "true",
    },
    [],
    migrationsDir,
  );
  const app = createApp(config, process.env, { db });
  const seen: string[] = [];
  const client = new HomeboxClient("http://127.0.0.1:7745", `Bearer ${session.raw}`, (url, init) => {
    seen.push(String(url));
    return app.request(url, init);
  });

  const folded = await searchItems(client, groupA, "cafe");
  expect(folded.ok).toBe(true);
  if (!folded.ok) throw new Error(folded.message);
  expect(folded.items.map((item) => item.name)).toEqual(["café"]);

  const typed = await searchItems(client, groupA, "café");
  expect(typed.ok).toBe(true);
  if (!typed.ok) throw new Error(typed.message);
  expect(typed.items.map((item) => item.name)).toEqual(["café"]);
  expect(seen.some((url) => url.includes("q=caf%C3%A9") || url.includes("q=café"))).toBe(true);
  expect(seen.some((url) => url.includes("q=cafe") && !url.includes("caf%C3%A9") && !url.includes("café"))).toBe(true);

  const label = await resolveCode(client, groupA, "https://labels.example/a/000-042");
  expect(label.status).toBe("match");
  if (label.status !== "match") return;
  expect(label.matches.map((match) => match.name)).toEqual(["café"]);

  const foreign = await resolveCode(client, groupA, `https://labels.example/item/${secret}`);
  expect(foreign.status).toBe("none");

  const otherAsset = await resolveCode(client, groupA, "https://labels.example/a/000-099");
  expect(otherAsset.status).toBe("none");

  const missing = await resolveCode(client, groupA, "zzzz-not-a-code");
  expect(missing).toEqual({ status: "none", code: "zzzz-not-a-code" });
});
