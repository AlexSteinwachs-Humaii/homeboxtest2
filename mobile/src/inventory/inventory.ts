import {
  HomeboxClient,
  type EntityDetail,
  type EntitySummary,
  type EntityTypeSummary,
  type GroupSummary,
  type TreeNode,
} from "../api/client";

// Inventory lives on the server. This module does not keep a catalog: every
// load asks again, and a failed load is an empty result rather than the last
// reply. Group scope is the server's job. The phone sends X-Tenant the way the
// website's collection selector does, and it shows whatever that request returns.

export type ItemDraft = {
  name: string;
  description: string;
  quantity: number;
  parentId: string | null;
  entityTypeId: string;
};

export type ItemEdits = {
  name: string;
  description: string;
  quantity: number;
  parentId: string | null;
};

export type InventorySnapshot = {
  groupId: string;
  groups: GroupSummary[];
  items: EntitySummary[];
  locations: EntitySummary[];
  tree: TreeNode[];
  itemTypeId: string | null;
  locationTypeId: string | null;
};

export type InventoryFailure = { ok: false; status: number; message: string };
export type InventorySuccess<T> = { ok: true; data: T };
export type InventoryResult<T> = InventorySuccess<T> | InventoryFailure;

const NAME_MAX = 255;
const DESCRIPTION_MAX = 1000;

export function chooseGroup(groups: GroupSummary[], preferred: string, fallback: string): string {
  const known = new Set(groups.map((group) => group.id));
  if (preferred && known.has(preferred)) return preferred;
  if (fallback && known.has(fallback)) return fallback;
  if (groups[0]) return groups[0].id;
  return preferred || fallback;
}

export function itemTypeId(types: EntityTypeSummary[]): string | null {
  return types.find((type) => !type.isLocation)?.id ?? null;
}

export function locationTypeId(types: EntityTypeSummary[]): string | null {
  return types.find((type) => type.isLocation)?.id ?? null;
}

export function validateDraft(draft: { name: string; description: string; quantity: number }): string | null {
  const name = draft.name.trim();
  if (!name) return "Enter a name.";
  if (name.length > NAME_MAX) return "Name must be 255 characters or fewer.";
  if (draft.description.length > DESCRIPTION_MAX) return "Description must be 1000 characters or fewer.";
  if (!Number.isFinite(draft.quantity) || draft.quantity < 0) return "Quantity must be zero or more.";
  return null;
}

export function buildEntityUpdate(detail: EntityDetail, edits: ItemEdits): Record<string, unknown> {
  const raw = detail.raw;
  return {
    id: detail.id,
    name: edits.name.trim(),
    description: edits.description,
    quantity: edits.quantity,
    parentId: edits.parentId,
    entityTypeId: detail.entityTypeId ?? "",
    tagIds: tagIds(raw),
    fields: Array.isArray(raw.fields) ? raw.fields : [],
    assetId: typeof raw.assetId === "string" ? raw.assetId : "",
    notes: text(raw.notes),
    manufacturer: text(raw.manufacturer),
    modelNumber: text(raw.modelNumber),
    serialNumber: text(raw.serialNumber),
    warrantyDetails: text(raw.warrantyDetails),
    purchaseFrom: text(raw.purchaseFrom),
    soldTo: text(raw.soldTo),
    soldNotes: text(raw.soldNotes),
    purchasePrice: number(raw.purchasePrice),
    soldPrice: number(raw.soldPrice),
    insured: raw.insured === true,
    archived: raw.archived === true,
    lifetimeWarranty: raw.lifetimeWarranty === true,
    syncChildEntityLocations: raw.syncChildEntityLocations === true,
    purchaseDate: dateField(raw.purchaseDate),
    soldDate: dateField(raw.soldDate),
    warrantyExpires: dateField(raw.warrantyExpires),
  };
}

export function sameItem(detail: EntityDetail, edits: ItemEdits): boolean {
  return (
    detail.name === edits.name.trim() &&
    detail.description === edits.description &&
    detail.quantity === edits.quantity &&
    (detail.parentId ?? null) === (edits.parentId ?? null)
  );
}

export async function loadInventory(
  client: HomeboxClient,
  preferredGroupId: string,
  fallbackGroupId: string,
): Promise<InventoryResult<InventorySnapshot>> {
  const groups = await client.listGroups();
  if (!groups.ok) return fail(groups.status, groups.error);

  const groupId = chooseGroup(groups.data, preferredGroupId, fallbackGroupId);
  if (!groupId) {
    return fail(0, "This account is not in a collection, so there is no inventory to show.");
  }

  client.setGroup(groupId);
  const [types, items, locations, tree] = await Promise.all([
    client.listEntityTypes(),
    client.listEntities(false),
    client.listEntities(true),
    client.listLocationTree(),
  ]);
  if (!types.ok) return fail(types.status, types.error);
  if (!items.ok) return fail(items.status, items.error);
  if (!locations.ok) return fail(locations.status, locations.error);

  return {
    ok: true,
    data: {
      groupId,
      groups: groups.data,
      items: items.data,
      locations: locations.data,
      tree: tree.ok ? tree.data : [],
      itemTypeId: itemTypeId(types.data),
      locationTypeId: locationTypeId(types.data),
    },
  };
}

export async function createItem(client: HomeboxClient, groupId: string, draft: ItemDraft): Promise<InventoryResult<EntityDetail>> {
  const invalid = validateDraft(draft);
  if (invalid) return fail(0, invalid);
  if (!draft.entityTypeId) return fail(0, "This collection has no item type on the server, so a new item cannot be filed.");

  client.setGroup(groupId);
  const created = await client.createEntity({
    name: draft.name.trim(),
    description: draft.description,
    quantity: draft.quantity,
    parentId: draft.parentId,
    entityTypeId: draft.entityTypeId,
    tagIds: [],
  });
  if (!created.ok) return fail(created.status, created.error);

  // Some servers store only the name on create. A follow-up update writes the
  // rest, then a refetch is what the phone shows — not the form that was just submitted.
  return reconcile(client, created.data, {
    name: draft.name,
    description: draft.description,
    quantity: draft.quantity,
    parentId: draft.parentId,
  });
}

export async function createLocation(
  client: HomeboxClient,
  groupId: string,
  draft: { name: string; parentId: string | null; entityTypeId: string },
): Promise<InventoryResult<EntityDetail>> {
  const invalid = validateDraft({ name: draft.name, description: "", quantity: 1 });
  if (invalid) return fail(0, invalid);
  if (!draft.entityTypeId) return fail(0, "This collection has no location type on the server.");

  client.setGroup(groupId);
  const created = await client.createEntity({
    name: draft.name.trim(),
    description: "",
    quantity: 1,
    parentId: draft.parentId,
    entityTypeId: draft.entityTypeId,
    tagIds: [],
  });
  if (!created.ok) return fail(created.status, created.error);
  const fetched = await client.getEntity(created.data.id);
  if (!fetched.ok) {
    return fail(fetched.status, "Saved, but the server did not return the new location. Refresh to see whether it was stored.");
  }
  if (fetched.data.id !== created.data.id) {
    return fail(fetched.status, "The server returned a different location than the one it just created.");
  }
  return { ok: true, data: fetched.data };
}

export async function updateItem(
  client: HomeboxClient,
  groupId: string,
  current: EntityDetail,
  edits: ItemEdits,
): Promise<InventoryResult<EntityDetail>> {
  const invalid = validateDraft(edits);
  if (invalid) return fail(0, invalid);
  if (!current.entityTypeId) return fail(0, "This item has no type on the server, so it cannot be saved.");

  client.setGroup(groupId);
  const saved = await client.updateEntity(current.id, buildEntityUpdate(current, edits));
  if (!saved.ok) return fail(saved.status, saved.error);
  return confirmSaved(client, current.id, edits);
}

async function reconcile(client: HomeboxClient, created: EntityDetail, edits: ItemEdits): Promise<InventoryResult<EntityDetail>> {
  const fetched = await client.getEntity(created.id);
  if (!fetched.ok) {
    return fail(fetched.status, "Saved, but the server did not return the new item. Refresh to see whether it was stored.");
  }
  if (fetched.data.id !== created.id) {
    return fail(fetched.status, "The server returned a different item than the one it just created.");
  }
  if (sameItem(fetched.data, edits)) return { ok: true, data: fetched.data };

  const saved = await client.updateEntity(fetched.data.id, buildEntityUpdate(fetched.data, edits));
  if (!saved.ok) return fail(saved.status, saved.error);
  return confirmSaved(client, fetched.data.id, edits);
}

async function confirmSaved(client: HomeboxClient, id: string, edits: ItemEdits): Promise<InventoryResult<EntityDetail>> {
  const fetched = await client.getEntity(id);
  if (!fetched.ok) {
    return fail(fetched.status, "Saved, but the server did not return the item. Refresh to see whether the change was stored.");
  }
  if (fetched.data.id !== id || !sameItem(fetched.data, edits)) {
    return fail(fetched.status, "The server did not keep this change. Refresh and try again.");
  }
  return { ok: true, data: fetched.data };
}

function fail(status: number, message: string): InventoryFailure {
  return { ok: false, status, message };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dateField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function tagIds(raw: Record<string, unknown>): string[] {
  if (!Array.isArray(raw.tags)) return [];
  const ids: string[] = [];
  for (const tag of raw.tags) {
    if (typeof tag === "object" && tag !== null && typeof (tag as { id?: unknown }).id === "string") {
      ids.push((tag as { id: string }).id);
    }
  }
  return ids;
}
