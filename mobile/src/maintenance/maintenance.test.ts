import assert from "node:assert/strict";
import test from "node:test";

import { HomeboxClient, type MaintenanceEntry } from "../api/client";
import { completeMaintenance, completionUpdate, isComplete, loadMaintenance, localDateOnly } from "./maintenance";

const GROUP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ENTRY = "33333333-3333-4333-8333-333333333333";
const ITEM = "44444444-4444-4444-8444-444444444444";

type Call = { url: string; init?: RequestInit };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function header(call: Call | undefined, name: string): string | undefined {
  return (call?.init?.headers as Record<string, string> | undefined)?.[name];
}

function due(extra: Partial<MaintenanceEntry> = {}): MaintenanceEntry {
  return {
    id: ENTRY,
    name: "Oil the hinge",
    description: "Annual",
    cost: "12.5",
    completedDate: "",
    scheduledDate: "2026-10-01",
    itemID: ITEM,
    itemName: "Front door",
    ...extra,
  };
}

test("localDateOnly uses the calendar day, not a UTC shift", () => {
  const evening = new Date(2026, 9, 8, 23, 30, 0);
  assert.equal(localDateOnly(evening), "2026-10-08");
  assert.equal(isComplete({ completedDate: "" }), false);
  assert.equal(isComplete({ completedDate: "0001-01-01" }), false);
  assert.equal(isComplete({ completedDate: "2026-10-08" }), true);
});

test("listing maintenance sends this collection and returns the server rows unchanged", async () => {
  const calls: Call[] = [];
  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(
      json(200, [
        due(),
        due({ id: OTHER, name: "Not ours", itemName: "Cabin lamp" }),
      ]),
    );
  });

  const result = await loadMaintenance(client, GROUP);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.url ?? "", /\/api\/v1\/maintenance\?status=both$/);
  assert.equal(header(calls[0], "Authorization"), "Bearer session");
  assert.equal(header(calls[0], "X-Tenant"), GROUP);
  assert.equal(calls[0]?.init?.method, "GET");
  // The phone does not drop or add rows. Group scope is the header, not a local log.
  assert.deepEqual(
    result.data.map((entry) => entry.id),
    [ENTRY, OTHER],
  );
  assert.equal(client.currentGroup(), GROUP);
});

test("marking complete sends the website's update and only the refreshed list counts", async () => {
  const calls: Call[] = [];
  const client = new HomeboxClient("http://127.0.0.1:7745", "raw-token", (url, init) => {
    calls.push({ url, init });
    if (init?.method === "PUT") {
      return Promise.resolve(json(200, { id: ENTRY, name: "Oil the hinge", completedDate: "2026-10-08" }));
    }
    return Promise.resolve(json(200, [due({ completedDate: "2026-10-08" })]));
  });

  const result = await completeMaintenance(client, GROUP, due(), "2026-10-08");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(calls.length, 2);
  assert.match(calls[0]?.url ?? "", new RegExp(`/api/v1/maintenance/${ENTRY}$`));
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(header(calls[0], "Authorization"), "Bearer raw-token");
  assert.equal(header(calls[0], "X-Tenant"), GROUP);
  assert.equal(header(calls[0], "Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), completionUpdate(due(), "2026-10-08"));
  assert.equal(typeof JSON.parse(String(calls[0]?.init?.body)).cost, "string");
  assert.match(calls[1]?.url ?? "", /status=both$/);
  assert.equal(result.data[0]?.completedDate, "2026-10-08");
  assert.equal(isComplete(result.data[0] ?? due()), true);
});

test("a failed update does not look complete", async () => {
  const calls: Call[] = [];
  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(json(500, { error: "nope" }));
  });

  const result = await completeMaintenance(client, GROUP, due(), "2026-10-08");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 500);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal("data" in result, false);
});

test("a refresh that does not show the entry as complete is not success", async () => {
  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", (_url, init) => {
    if (init?.method === "PUT") return Promise.resolve(json(200, { id: ENTRY }));
    return Promise.resolve(json(200, [due({ completedDate: "" })]));
  });

  const result = await completeMaintenance(client, GROUP, due(), "2026-10-08");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /did not show this entry as complete/);
});
