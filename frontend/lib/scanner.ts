// HomeBox QR labels contain an item URL; printed asset IDs use the Items search.
// Never navigate to an arbitrary URL supplied by a scanned label.
export function labelLookupTarget(value: string): string | { path: string; query: { q: string } } | null {
  const code = value.trim();
  if (!code) return null;
  try {
    const url = new URL(code);
    if (/^\/item\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(url.pathname)) {
      return url.pathname;
    }
  } catch {
    // A plain barcode or manually entered asset ID is not a URL.
  }
  return { path: "/items", query: { q: `#${code.replace(/^#/, "")}` } };
}
