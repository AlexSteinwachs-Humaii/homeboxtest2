// The website remembers which collection was selected. The id is not inventory.
// The next load still asks the server, and sends this id as X-Tenant.
const KEY = "homebox.collection";

function storage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    if (!candidate || typeof candidate.getItem !== "function") return null;
    return candidate;
  } catch {
    return null;
  }
}

export function readPreferredCollection(): string {
  const value = storage()?.getItem(KEY) ?? "";
  return value.trim();
}

export function writePreferredCollection(id: string): void {
  const box = storage();
  if (!box) return;
  const trimmed = id.trim();
  if (!trimmed) box.removeItem(KEY);
  else box.setItem(KEY, trimmed);
}
