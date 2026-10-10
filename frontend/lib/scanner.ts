// Printed HomeBox labels are item, location, or asset URLs. A typed asset ID uses
// the Items search. Never navigate to an arbitrary URL supplied by a label.
const ITEM_OR_LOCATION = /^\/(?:item|location)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;
const ASSET = /^\/(?:a|assets)\/\d+(?:-\d+)?\/?$/;

function localLabelPath(value: string): string | null {
  let pathname: string | null = null;
  try {
    pathname = new URL(value).pathname;
  } catch {
    if (value.startsWith("/")) pathname = value.split(/[?#]/)[0] ?? null;
  }
  if (!pathname || (!ITEM_OR_LOCATION.test(pathname) && !ASSET.test(pathname))) return null;
  return pathname.replace(/\/$/, "");
}

export function labelLookupTarget(value: string): string | { path: string; query: { q: string } } | null {
  const code = value.trim();
  if (!code) return null;
  return localLabelPath(code) ?? { path: "/items", query: { q: `#${code.replace(/^#/, "")}` } };
}
