import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function source(relative: string): Promise<string> {
  return readFile(path.join(root, relative), "utf8");
}

test("browser inventory tasks stay on the shared screens and the server", async () => {
  const search = await source("src/screens/shared/Search.tsx");
  assert.match(search, /accessibilityLabel="Search items"/);
  assert.equal(search.includes("normalize("), false);
  assert.equal(search.includes("NFD"), false);
  assert.equal(search.toLowerCase().includes("homebox.db"), false);

  const photos = await source("src/screens/shared/PhotoAttach.tsx");
  assert.match(photos, /aria-label": "Attach a photo"/);
  assert.match(photos, /type: "file"/);
  assert.equal(photos.includes("homebox.db"), false);

  const list = await source("src/screens/InventoryScreen.tsx");
  assert.match(list, /Switch to \$\{group\.name\}/);
  assert.match(list, /New collection/);
  assert.match(list, /Create collection/);

  const app = await source("src/screens/InventoryApp.tsx");
  assert.match(app, /writePreferredCollection/);
  assert.match(app, /createGroup/);
  assert.match(app, /createMaintenance/);
  assert.match(app, /onWebFile/);
  assert.equal(app.includes("homebox.db"), false);

  const picker = await source("src/photos/picker.web.ts");
  assert.match(picker, /type = "file"/);
  assert.match(picker, /arrayBuffer/);
  assert.equal(picker.includes("homebox.db"), false);
  assert.equal(picker.includes("expo-sqlite"), false);
});
