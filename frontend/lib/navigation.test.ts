import { describe, expect, test } from "vitest";
import { isNavigationActive, primaryNavigation, settingsNavigation, toolsNavigation } from "./navigation";
import en from "../locales/en.json";

const label = (key: string) => {
  let value: unknown = en;
  for (const part of key.split(".")) value = (value as Record<string, unknown>)[part];
  return value;
};

describe("collection sidebar navigation", () => {
  test("keeps the four labeled primary destinations in order", () => {
    expect(primaryNavigation.map(entry => label(entry.key))).toEqual(["Overview", "Items", "Locations", "Maintenance"]);
    expect(primaryNavigation.map(entry => entry.to)).toEqual(["/home", "/items", "/locations", "/maintenance"]);
  });

  test("keeps tags, templates, and collection tools secondary", () => {
    expect(toolsNavigation.map(entry => entry.to)).toEqual(["/tags", "/templates", "/collection/tools"]);
  });

  test("preserves profile and every existing collection administration destination", () => {
    expect(settingsNavigation.map(entry => entry.to)).toEqual([
      "/profile",
      "/collection/members",
      "/collection/invites",
      "/collection/notifiers",
      "/collection/settings",
      "/collection/entity-types",
    ]);
    expect(label(settingsNavigation.find(entry => entry.id === "notifiers")!.key)).toBe("Notifiers");
    for (const entry of [...primaryNavigation, ...toolsNavigation, ...settingsNavigation]) {
      expect(label(entry.key)).toBeTruthy();
    }
  });

  test("highlights destinations and descendants without matching unrelated prefixes", () => {
    expect(isNavigationActive("/items", "/items")).toBe(true);
    expect(isNavigationActive("/locations/example", "/locations")).toBe(true);
    expect(isNavigationActive("/collection/tools", "/collection/settings")).toBe(false);
    expect(isNavigationActive("/items-other", "/items")).toBe(false);
  });
});
