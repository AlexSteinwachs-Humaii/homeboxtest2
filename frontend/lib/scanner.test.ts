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
  it("opens existing routes for printed HomeBox labels", () => {
    const item = "/item/12345678-1234-1234-1234-123456789012";
    const location = "/location/12345678-1234-1234-1234-123456789012";
    expect(labelLookupTarget(`https://homebox.example${item}?unused=1`)).toBe(item);
    expect(labelLookupTarget(`https://labels.example${location}#print`)).toBe(location);
    expect(labelLookupTarget("https://labels.example/a/001-024")).toBe("/a/001-024");
    expect(labelLookupTarget("/assets/001-024/")).toBe("/assets/001-024");
  });
  it("does not follow arbitrary links or application routes", () => {
    for (const code of [
      "https://example.com",
      "https://example.com/settings",
      "javascript:alert(1)",
      "https://example.com/a/001-024/admin",
      "https://example.com/location/not-a-uuid",
      "/settings",
    ]) {
      expect(labelLookupTarget(code)).toEqual({ path: "/items", query: { q: `#${code}` } });
    }
  });
});
