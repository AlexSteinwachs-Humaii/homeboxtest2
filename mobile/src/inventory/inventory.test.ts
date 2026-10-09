import assert from "node:assert/strict";
import test from "node:test";

import { HomeboxClient, type EntityDetail } from "../api/client";
import { buildEntityUpdate, chooseGroup, createItem, loadInventory, sameItem, updateItem, validateDraft } from "./inventory";

const GROUP_A = "11111111-1111-4111-8111-111111111111";
const GROUP_B = "22222222-2222-4222-8222-222222222222";
const ITEM_TYPE = "33333333-3333-4333-8333-333333333333";
const LOCATION_TYPE = "44444444-4444-4444-8444-444444444444";
const KITCHEN = "55555555-5555-4555-8555-555555555555";
const LAMP = "66666666-6666-4666-8666-666666666666";
const SECRET = "77777777-7777-4777-8777-777777777777";

type Call = { url: string; init?: RequestInit };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function entity(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    description: "",
    quantity: 1,
    assetId: "000-001",
    itemCount: 0,
    notes: "",
    manufacturer: "",
    modelNumber: "",
    serialNumber: "",
    purchasePrice: 0,
    soldPrice: 0,
    insured: false,
    archived: false,
    lifetimeWarranty: false,
    syncChildEntityLocations: false,
    purchaseDate: "",
    soldDate: "",
    warrantyExpires: "",
    warrantyDetails: "",
    purchaseFrom: "",
    soldTo: "",
    soldNotes: "",
    tags: [{ id: "tag-1", name: "Tools" }],
    fields: [],
    parent: null,
    entityType: { id: ITEM_TYPE, name: "Item", isLocation: false },
    ...extra,
  };
}

function location(id: string, name: string) {
  return entity(id, name, {
    description: "",
    entityType: { id: LOCATION_TYPE, name: "Location", isLocation: true },
    itemCount: 2,
  });
}

function header(call: Call | undefined, name: string): string | undefined {
  return (call?.init?.headers as Record<string, string> | undefined)?.[name];
}

function tenantOf(call: Call | undefined): string | undefined {
  return header(call, "X-Tenant");
}

test("chooseGroup prefers a known collection and does not invent one", () => {
  const groups = [
    { id: GROUP_A, name: "Home" },
    { id: GROUP_B, name: "Cabin" },
  ];
  assert.equal(chooseGroup(groups, GROUP_B, GROUP_A), GROUP_B);
  assert.equal(chooseGroup(groups, "missing", GROUP_A), GROUP_A);
  assert.equal(chooseGroup(groups, "", ""), GROUP_A);
  assert.equal(chooseGroup([], "", ""), "");
});

test("validateDraft rejects an empty name and a negative quantity", () => {
  assert.equal(validateDraft({ name: "  ", description: "", quantity: 1 }), "Enter a name.");
  assert.equal(validateDraft({ name: "Lamp", description: "", quantity: -1 }), "Quantity must be zero or more.");
  assert.equal(validateDraft({ name: "Lamp", description: "", quantity: 2 }), null);
});

test("buildEntityUpdate round-trips server fields and does not invent a local id", () => {
  const detail = {
    id: LAMP,
    name: "Lamp",
    description: "old",
    quantity: 1,
    assetId: "000-004",
    parentId: KITCHEN,
    parentName: "Kitchen",
    entityTypeId: ITEM_TYPE,
    entityTypeName: "Item",
    isLocation: false,
    itemCount: 0,
    notes: "keep",
    manufacturer: "Acme",
    modelNumber: "L-1",
    raw: entity(LAMP, "Lamp", { notes: "keep", manufacturer: "Acme", modelNumber: "L-1", parent: { id: KITCHEN, name: "Kitchen" } }),
  } satisfies EntityDetail;

  const body = buildEntityUpdate(detail, { name: "Desk lamp", description: "brass", quantity: 2, parentId: KITCHEN });
  assert.equal(body.id, LAMP);
  assert.equal(body.name, "Desk lamp");
  assert.equal(body.description, "brass");
  assert.equal(body.quantity, 2);
  assert.equal(body.parentId, KITCHEN);
  assert.equal(body.entityTypeId, ITEM_TYPE);
  assert.deepEqual(body.tagIds, ["tag-1"]);
  assert.equal(body.notes, "keep");
  assert.equal(body.manufacturer, "Acme");
  assert.equal(body.assetId, "000-001");
  assert.equal(sameItem(detail, { name: "Lamp", description: "old", quantity: 1, parentId: KITCHEN }), true);
});

test("loading inventory sends X-Tenant and shows only what that request returns", async () => {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const tenant = (init?.headers as Record<string, string>)["X-Tenant"];
    if (url.endsWith("/api/v1/groups/all")) {
      assert.equal(tenant, undefined);
      return json(200, [
        { id: GROUP_A, name: "Home" },
        { id: GROUP_B, name: "Cabin" },
      ]);
    }
    if (url.endsWith("/api/v1/entity-types")) {
      return json(200, [
        { id: ITEM_TYPE, name: "Item", isLocation: false },
        { id: LOCATION_TYPE, name: "Location", isLocation: true },
      ]);
    }
    if (url.includes("/api/v1/entities/tree")) {
      const name = tenant === GROUP_A ? "Kitchen" : "Shed";
      return json(200, [{ id: tenant === GROUP_A ? KITCHEN : "shed", name, type: "location", children: [] }]);
    }
    if (url.includes("isLocation=true")) {
      return json(200, {
        items: [location(tenant === GROUP_A ? KITCHEN : "shed", tenant === GROUP_A ? "Kitchen" : "Shed")],
        page: -1,
        pageSize: -1,
        total: 1,
        totalPrice: 0,
      });
    }
    if (url.includes("isLocation=false")) {
      const row = tenant === GROUP_A ? entity(LAMP, "Lamp", { parent: { id: KITCHEN, name: "Kitchen" } }) : entity(SECRET, "Secret");
      return json(200, { items: [row], page: -1, pageSize: -1, total: 1, totalPrice: 0 });
    }
    return json(404, { error: "missing" });
  };

  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", fetchImpl);
  const home = await loadInventory(client, GROUP_A, GROUP_A);
  assert.equal(home.ok, true);
  if (!home.ok) return;
  assert.equal(home.data.groupId, GROUP_A);
  assert.deepEqual(
    home.data.items.map((item) => item.name),
    ["Lamp"],
  );
  assert.equal(
    home.data.items.some((item) => item.name === "Secret"),
    false,
  );
  assert.equal(home.data.locations[0]?.name, "Kitchen");
  assert.equal(home.data.itemTypeId, ITEM_TYPE);
  assert.equal(home.data.locationTypeId, LOCATION_TYPE);

  const inventoryCalls = calls.filter((call) => call.url.includes("/api/v1/entities"));
  assert.ok(inventoryCalls.length >= 2);
  for (const call of inventoryCalls) {
    assert.equal(tenantOf(call), GROUP_A);
    assert.equal(header(call, "Authorization"), "Bearer session");
  }

  const cabin = await loadInventory(client, GROUP_B, GROUP_A);
  assert.equal(cabin.ok, true);
  if (!cabin.ok) return;
  assert.deepEqual(
    cabin.data.items.map((item) => item.name),
    ["Secret"],
  );
  assert.equal(
    cabin.data.items.some((item) => item.id === LAMP),
    false,
  );
  const lastItems = calls.filter((call) => call.url.includes("isLocation=false")).at(-1);
  assert.equal(tenantOf(lastItems), GROUP_B);
});

test("a failed reload is an error, not a stored catalog", async () => {
  let attempts = 0;
  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", async (url) => {
    attempts += 1;
    if (url.endsWith("/api/v1/groups/all")) {
      return json(200, [{ id: GROUP_A, name: "Home" }]);
    }
    return json(503, { error: "unavailable" });
  });

  const first = await loadInventory(client, GROUP_A, GROUP_A);
  const second = await loadInventory(client, GROUP_A, GROUP_A);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  if (first.ok || second.ok) return;
  assert.equal(first.message, "unavailable");
  assert.ok(attempts >= 4, "each load asks the server again");
});

test("creating an item posts to the server, then refetches that id", async () => {
  const calls: Call[] = [];
  let wrote = false;
  const incomplete = entity(LAMP, "Drill", { description: "", quantity: 1, parent: { id: KITCHEN, name: "Kitchen" } });
  const stored = entity(LAMP, "Drill", {
    description: "cordless",
    quantity: 2,
    parent: { id: KITCHEN, name: "Kitchen" },
  });
  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", async (url, init) => {
    calls.push({ url, init });
    if (init?.method === "POST") return json(201, incomplete);
    if (init?.method === "PUT") {
      wrote = true;
      return json(200, stored);
    }
    if (url.endsWith(`/api/v1/entities/${LAMP}`)) return json(200, wrote ? stored : incomplete);
    return json(404, { error: "missing" });
  });

  const result = await createItem(client, GROUP_A, {
    name: " Drill ",
    description: "cordless",
    quantity: 2,
    parentId: KITCHEN,
    entityTypeId: ITEM_TYPE,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.id, LAMP);
  assert.equal(result.data.name, "Drill");
  assert.equal(result.data.description, "cordless");
  assert.equal(result.data.quantity, 2);
  assert.equal(result.data.parentId, KITCHEN);

  const post = calls.find((call) => call.init?.method === "POST");
  assert.equal(post?.url, "http://127.0.0.1:7745/api/v1/entities");
  assert.equal(tenantOf(post), GROUP_A);
  assert.equal(
    post?.init?.body,
    JSON.stringify({
      name: "Drill",
      description: "cordless",
      quantity: 2,
      parentId: KITCHEN,
      entityTypeId: ITEM_TYPE,
      tagIds: [],
    }),
  );

  const put = calls.find((call) => call.init?.method === "PUT");
  assert.ok(put, "description was not stored on create, so the client writes it with PUT");
  assert.equal(put?.url, `http://127.0.0.1:7745/api/v1/entities/${LAMP}`);
  const putBody = JSON.parse(String(put?.init?.body)) as { name: string; parentId: string; entityTypeId: string };
  assert.equal(putBody.name, "Drill");
  assert.equal(putBody.parentId, KITCHEN);
  assert.equal(putBody.entityTypeId, ITEM_TYPE);

  const gets = calls.filter((call) => call.init?.method === "GET" && call.url.endsWith(`/${LAMP}`));
  assert.ok(gets.length >= 2, "the phone shows the refetched row, not the form");
  for (const call of calls) assert.equal(tenantOf(call), GROUP_A);
});

test("editing persists through PUT and the following GET, and a mismatch is not success", async () => {
  const calls: Call[] = [];
  let savedName = "Lamp";
  const client = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", async (url, init) => {
    calls.push({ url, init });
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { name: string };
      savedName = body.name;
      return json(200, entity(LAMP, savedName, { description: "new", quantity: 3, parent: { id: KITCHEN, name: "Kitchen" } }));
    }
    return json(200, entity(LAMP, savedName, { description: "new", quantity: 3, parent: { id: KITCHEN, name: "Kitchen" } }));
  });

  const current = {
    ...entity(LAMP, "Lamp"),
    parentId: null,
    parentName: null,
    entityTypeId: ITEM_TYPE,
    entityTypeName: "Item",
    isLocation: false,
    raw: entity(LAMP, "Lamp"),
  } satisfies EntityDetail;

  const saved = await updateItem(client, GROUP_A, current, {
    name: "Desk lamp",
    description: "new",
    quantity: 3,
    parentId: KITCHEN,
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.data.id, LAMP);
  assert.equal(saved.data.name, "Desk lamp");
  assert.equal(calls.filter((call) => call.url.endsWith(`/${LAMP}`) && call.init?.method === "GET").length, 1);
  assert.equal(tenantOf(calls[0]), GROUP_A);

  const stubborn = new HomeboxClient("http://127.0.0.1:7745", "Bearer session", async (_url, init) => {
    if (init?.method === "PUT") return json(200, entity(LAMP, "Desk lamp"));
    return json(200, entity(LAMP, "Lamp"));
  });
  const rejected = await updateItem(stubborn, GROUP_A, current, {
    name: "Desk lamp",
    description: "new",
    quantity: 3,
    parentId: KITCHEN,
  });
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.match(rejected.message, /did not keep/);
});
