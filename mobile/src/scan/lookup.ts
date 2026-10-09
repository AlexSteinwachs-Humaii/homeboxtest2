import { HomeboxClient, type EntitySummary } from "../api/client";

// Label and barcode lookup. The phone does not fold accents and does not keep
// a code index. Search and asset routes are the server's, scoped with X-Tenant.
// A product barcode that is not already an item is a no-match. Nothing is created.

export type LabelRef = {
  kind: "item" | "location" | "asset";
  id: string;
};

export type ScanMatch = {
  kind: "item" | "location";
  id: string;
  name: string;
};

export type ScanResolution =
  | { status: "match"; matches: ScanMatch[] }
  | { status: "none"; code: string; productName?: string }
  | { status: "error"; message: string };

export type SearchOutcome = { ok: true; items: EntitySummary[] } | { ok: false; message: string };

export function parseLabel(raw: string): LabelRef | null {
  const pathname = labelPath(raw);
  if (!pathname) return null;
  const sanitized = pathname.replace(/[^a-zA-Z0-9-_/]/g, "");
  const asset = sanitized.match(/^\/(?:a|assets)\/([a-zA-Z0-9-_]+)/);
  if (asset?.[1]) return { kind: "asset", id: asset[1] };
  const item = sanitized.match(/^\/item\/([a-zA-Z0-9-_]+)/);
  if (item?.[1]) return { kind: "item", id: item[1] };
  const location = sanitized.match(/^\/location\/([a-zA-Z0-9-_]+)/);
  if (location?.[1]) return { kind: "location", id: location[1] };
  return null;
}

export function isProductBarcode(raw: string): boolean {
  return /^[0-9]{8,14}$/.test(raw.trim());
}

export function noMatchCopy(code: string, productName?: string): string {
  const shown = code.trim() || "that code";
  if (productName && productName.trim() !== "") {
    return `No item in this collection matches ${shown}. A product catalog lists it as "${productName.trim()}", but it was not added.`;
  }
  return `No item in this collection matches ${shown}.`;
}

export async function searchItems(client: HomeboxClient, groupId: string, query: string): Promise<SearchOutcome> {
  const scoped = scope(client, groupId);
  if (!scoped.ok) return scoped;
  const result = await client.searchEntities(query);
  if (!result.ok) return { ok: false, message: result.error };
  return { ok: true, items: result.data };
}

export async function resolveCode(client: HomeboxClient, groupId: string, raw: string): Promise<ScanResolution> {
  const code = raw.trim();
  if (!code) return { status: "none", code: "" };
  const scoped = scope(client, groupId);
  if (!scoped.ok) return { status: "error", message: scoped.message };

  const label = parseLabel(code);
  if (label?.kind === "asset") return fromAsset(client, label.id, code);
  if (label) return fromEntity(client, label.id, code);

  const found = await client.searchEntities(code);
  if (!found.ok) return { status: "error", message: found.error };
  if (found.data.length > 0) return { status: "match", matches: found.data.map(toMatch) };

  const assetId = shortAssetCode(code);
  if (assetId) {
    const asset = await fromAsset(client, assetId, code);
    if (asset.status !== "none") return asset;
  }

  if (!isProductBarcode(code)) return { status: "none", code };

  const catalog = await client.searchFromBarcode(code);
  if (!catalog.ok) return { status: "none", code };
  const named = catalog.data.find((product) => product.name.trim() !== "");
  return { status: "none", code, productName: named?.name };
}

function scope(client: HomeboxClient, groupId: string): { ok: true } | { ok: false; message: string } {
  if (!groupId.trim()) return { ok: false, message: "Choose a collection before searching." };
  client.setGroup(groupId);
  return { ok: true };
}

async function fromEntity(client: HomeboxClient, id: string, code: string): Promise<ScanResolution> {
  const result = await client.getEntity(id);
  if (!result.ok) {
    if (result.status === 404 || result.status === 400) return { status: "none", code };
    return { status: "error", message: result.error };
  }
  if (result.data.id !== id) return { status: "none", code };
  return { status: "match", matches: [toMatch(result.data)] };
}

async function fromAsset(client: HomeboxClient, assetId: string, code: string): Promise<ScanResolution> {
  const result = await client.listByAssetId(assetId);
  if (!result.ok) {
    if (result.status === 404 || result.status === 400) return { status: "none", code };
    return { status: "error", message: result.error };
  }
  if (result.data.length === 0) return { status: "none", code };
  return { status: "match", matches: result.data.map(toMatch) };
}

function toMatch(entity: EntitySummary): ScanMatch {
  return {
    kind: entity.isLocation ? "location" : "item",
    id: entity.id,
    name: entity.name,
  };
}

function labelPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) return trimmed.split(/[?#]/)[0] ?? trimmed;
  if (/^(item|location|a|assets)\//i.test(trimmed)) return `/${trimmed.split(/[?#]/)[0]}`;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function shortAssetCode(code: string): string | null {
  if (/^\d{3}-\d{3}$/.test(code)) return code;
  if (/^\d{1,6}$/.test(code)) return code;
  return null;
}
