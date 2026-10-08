import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { HomeboxClient } from "../api/client";
import { NOT_IN_THIS_RELEASE, notInThisRelease, resolveWebPath, TOOLS } from "./catalog";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const REQUIRED = [
  "Labels",
  "QR",
  "CSV import/export",
  "Collection import/export",
  "Profile",
  "Collection settings",
  "Members",
  "Invites",
  "Notifiers",
  "Entity types",
  "Templates",
];

async function source(relative: string): Promise<string> {
  return readFile(path.join(mobileRoot, relative), "utf8");
}

test("every Vue tool is named and either calls an existing route or states the gap", () => {
  for (const title of REQUIRED) {
    const tool = TOOLS.find((entry) => entry.title === title);
    assert.ok(tool, `missing tool ${title}`);
    if (tool.implemented) {
      assert.ok(tool.endpoints.length > 0, `${title} is implemented without a route`);
      for (const endpoint of tool.endpoints) {
        assert.match(endpoint, /^\/api\/v1\//, `${title} must use /api/v1`);
        assert.equal(endpoint.includes("/api/v1/"), true);
        assert.equal(/\/api\/(?!v1)/.test(endpoint), false);
      }
    } else {
      assert.match(notInThisRelease(tool.title), new RegExp(NOT_IN_THIS_RELEASE));
      assert.match(notInThisRelease(tool.title), new RegExp(tool.title));
    }
  }
  const tags = TOOLS.find((entry) => entry.title === "Tags");
  assert.equal(tags?.implemented, true);
  assert.deepEqual(tags?.endpoints, ["/api/v1/tags"]);
});

test("Vue addresses open the tool or a named notice, never a blank path", () => {
  assert.deepEqual(resolveWebPath("/reports/label-generator"), { kind: "tool", id: "labels" });
  assert.deepEqual(resolveWebPath("/profile"), { kind: "tool", id: "profile" });
  assert.deepEqual(resolveWebPath("/collection/settings/"), { kind: "tool", id: "collection-settings" });
  assert.deepEqual(resolveWebPath("/collection/members"), { kind: "tool", id: "members" });
  assert.deepEqual(resolveWebPath("/collection/invites"), { kind: "tool", id: "invites" });
  assert.deepEqual(resolveWebPath("/collection/notifiers"), { kind: "tool", id: "notifiers" });
  assert.deepEqual(resolveWebPath("/collection/entity-types"), { kind: "tool", id: "entity-types" });
  assert.deepEqual(resolveWebPath("/templates"), { kind: "tool", id: "templates" });
  assert.equal(resolveWebPath("/template/abc").kind, "tool");
  assert.equal(resolveWebPath("/collection/tools").kind, "hub");
  assert.equal(resolveWebPath("/tags").kind, "tool");
  assert.deepEqual(resolveWebPath("/label/abc"), { kind: "tool", id: "labels", focusId: "abc" });
  assert.deepEqual(resolveWebPath("/tag/abc"), { kind: "tool", id: "tags", focusId: "abc" });
  const unknown = resolveWebPath("/scanner-ar");
  assert.equal(unknown.kind, "gap");
  if (unknown.kind === "gap") assert.match(notInThisRelease(unknown.title), /is not in this release/);
});

test("navigation and the catch-all route keep the tools reachable", async () => {
  const list = await source("src/screens/InventoryScreen.tsx");
  assert.match(list, /accessibilityLabel="Tools"/);
  const screen = await source("src/screens/ToolsScreen.tsx");
  const client = await source("src/api/client.ts");
  const combined = `${client}\n${screen}`;
  assert.match(screen, /Open \$\{tool\.title\}/);
  assert.match(screen, /notInThisRelease/);
  for (const tool of TOOLS) {
    if (!tool.implemented) continue;
    for (const endpoint of tool.endpoints) {
      const literal = combined.includes(endpoint) || combined.includes(endpoint.replace(/\/$/, ""));
      const labelmaker = endpoint.startsWith("/api/v1/labelmaker/") && combined.includes("/api/v1/labelmaker/");
      assert.equal(literal || labelmaker, true, endpoint);
    }
  }
  const route = await source("app/[...slug].tsx");
  assert.match(route, /SessionGate/);
  assert.match(route, /requestedPath/);
  const missing = await source("app/+not-found.tsx");
  assert.match(missing, /requestedPath/);
  assert.equal(screen.includes("homebox.db"), false);
  assert.equal(screen.includes("expo-sqlite"), false);
  assert.equal(screen.includes("app/api"), false);
});

test("label, QR, and CSV calls stay on the Bun routes", async () => {
  const calls: string[] = [];
  const client = new HomeboxClient("http://127.0.0.1:7745", "session-raw", async (url) => {
    calls.push(url);
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/png", "content-disposition": 'attachment; filename="label.png"' },
    });
  });
  client.setGroup("11111111-1111-4111-8111-111111111111");
  const label = await client.labelImage("entity", "item-1");
  const qr = await client.qrImage("https://example.com/item");
  const csv = await client.exportEntitiesCsv();
  assert.equal(label.ok, true);
  assert.equal(qr.ok, true);
  assert.equal(csv.ok, true);
  assert.equal(calls[0], "http://127.0.0.1:7745/api/v1/labelmaker/entity/item-1");
  assert.match(calls[1] ?? "", /\/api\/v1\/qrcode\?data=/);
  assert.equal(calls[2], "http://127.0.0.1:7745/api/v1/entities/export");
  for (const url of calls) {
    assert.equal(url.includes("homebox.db"), false);
    assert.equal(/\/api\/(?!v1)/.test(url), false);
  }
});
