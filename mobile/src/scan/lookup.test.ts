import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { HomeboxClient, type EntitySummary } from "../api/client";
import { isProductBarcode, noMatchCopy, parseLabel, resolveCode, searchItems } from "./lookup";

const GROUP = "group-a";
const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function summary(overrides: Partial<EntitySummary> & Pick<EntitySummary, "id" | "name">): EntitySummary {
  return {
    description: "",
    quantity: 1,
    assetId: "000-042",
    parentId: null,
    parentName: null,
    entityTypeId: "type-1",
    entityTypeName: "Item",
    isLocation: false,
    itemCount: 0,
    ...overrides,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("parseLabel reads item, location, and asset paths from any host", () => {
  assert.deepEqual(parseLabel("https://labels.example/item/" + ITEM_ID), { kind: "item", id: ITEM_ID });
  assert.deepEqual(parseLabel("http://192.168.1.20:7745/location/" + ITEM_ID + "?print=1"), { kind: "location", id: ITEM_ID });
  assert.deepEqual(parseLabel("https://home.example/a/000-042"), { kind: "asset", id: "000-042" });
  assert.deepEqual(parseLabel("/assets/000042"), { kind: "asset", id: "000042" });
  assert.equal(parseLabel("4006381333931"), null);
  assert.equal(parseLabel("https://example.com/login"), null);
});

test("search sends the accented query unchanged and does not open another group's row", async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", async (url, init) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("q"), "café");
    return json(200, { items: [summary({ id: ITEM_ID, name: "café" })] });
  });

  const found = await searchItems(client, GROUP, "café");
  assert.equal(found.ok, true);
  if (!found.ok) return;
  assert.deepEqual(found.items.map((item) => item.name), ["café"]);
  assert.equal(calls[0]?.headers["X-Tenant"], GROUP);
  assert.equal(calls[0]?.headers.Authorization, "Bearer session");
  const url = calls[0]?.url ?? "";
  assert.equal(url.includes("caf%C3%A9") || url.includes("café"), true);
  assert.equal(url.includes("q=cafe&") || url.endsWith("q=cafe"), false);
});

test("a combining mark in the query is not rewritten before it reaches the server", async () => {
  const query = "cafe\u0301";
  let seen = "";
  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", async (url) => {
    seen = new URL(url).searchParams.get("q") ?? "";
    return json(200, { items: [] });
  });
  client.setGroup(GROUP);
  const result = await client.searchEntities(query);
  assert.equal(result.ok, true);
  assert.equal(seen, query);
  assert.notEqual(seen, "cafe");
});

test("an asset label opens that item, and another group's item id does not", async () => {
  const calls: string[] = [];
  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", async (url, init) => {
    calls.push(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    assert.equal(headers["X-Tenant"], GROUP);
    const pathName = new URL(url).pathname;
    if (pathName.endsWith("/assets/000-042")) {
      return json(200, { items: [summary({ id: ITEM_ID, name: "Drill" })] });
    }
    if (pathName.endsWith("/entities/" + OTHER_ID)) return json(404, { error: "Not Found" });
    return json(500, { error: "unexpected " + pathName });
  });

  const owned = await resolveCode(client, GROUP, "https://other-host.example/a/000-042");
  assert.equal(owned.status, "match");
  if (owned.status !== "match") return;
  assert.deepEqual(owned.matches, [{ kind: "item", id: ITEM_ID, name: "Drill" }]);

  const foreign = await resolveCode(client, GROUP, "https://labels.example/item/" + OTHER_ID);
  assert.equal(foreign.status, "none");
  if (foreign.status !== "none") return;
  assert.equal(foreign.code, "https://labels.example/item/" + OTHER_ID);
  assert.equal(calls.some((url) => url.includes(OTHER_ID)), true);
});

test("a product barcode with no inventory row is a no-match and does not create an item", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET" });
    const pathName = new URL(url).pathname;
    if (pathName.endsWith("/entities")) {
      assert.equal(new URL(url).searchParams.get("q"), "4006381333931");
      return json(200, { items: [] });
    }
    if (pathName.endsWith("/products/search-from-barcode")) {
      assert.equal(new URL(url).searchParams.get("productEAN"), "4006381333931");
      return json(200, [{ barcode: "4006381333931", search_engine_name: "openfoodfacts.org", item: { name: "Oat milk" } }]);
    }
    return json(500, { error: "unexpected" });
  });

  const result = await resolveCode(client, GROUP, "4006381333931");
  assert.equal(result.status, "none");
  if (result.status !== "none") return;
  assert.equal(result.productName, "Oat milk");
  assert.equal(noMatchCopy(result.code, result.productName).includes("was not added"), true);
  assert.equal(calls.some((call) => call.method === "POST"), false);
  assert.equal(isProductBarcode("4006381333931"), true);
  assert.equal(isProductBarcode("000042"), false);
});

test("an unknown code that is not a label shows the empty state", async () => {
  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", async (url) => {
    assert.equal(new URL(url).pathname.endsWith("/products/search-from-barcode"), false);
    return json(200, { items: [] });
  });
  const result = await resolveCode(client, GROUP, "zzzz-not-a-code");
  assert.deepEqual(result, { status: "none", code: "zzzz-not-a-code" });
  assert.match(noMatchCopy("zzzz-not-a-code"), /No item in this collection/);
});

test("the phone source does not implement a second search normalization", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = await sourceFiles(root);
  const needles = ["normalizeSearchQuery", "removeAccents", "normalize(\"NFD\")", "normalize('NFD')", "\\p{Mn}"];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const needle of needles) {
      assert.equal(text.includes(needle), false, `${path.relative(root, file)} contains ${needle}`);
    }
  }
});

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(full)));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) found.push(full);
  }
  return found;
}
