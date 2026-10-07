import { describe, expect, it } from "vitest";
import { labelLookupTarget } from "./scanner";

describe("label lookup", () => {
  it("uses the existing asset ID search for typed and scanned codes", () => {
    for (const code of ["001-024", " 001-024 ", "#001-024"]) {
      expect(labelLookupTarget(code)).toEqual({ path: "/items", query: { q: "#001-024" } });
    }
  });
  it("ignores blank input", () => {
    expect(labelLookupTarget("  ")).toBeNull();
  });
  it("opens existing item details for HomeBox QR labels", () => {
    const path = "/item/12345678-1234-1234-1234-123456789012";
    expect(labelLookupTarget(`https://homebox.example${path}?unused=1`)).toBe(path);
  });
  it("does not follow arbitrary links or application routes", () => {
    for (const code of ["https://example.com", "https://example.com/settings", "javascript:alert(1)"]) {
      expect(labelLookupTarget(code)).toEqual({ path: "/items", query: { q: `#${code}` } });
    }
  });
});
