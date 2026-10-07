// Existing HomeBox routes, grouped for the collection sidebar and quick menu.
export const primaryNavigation = [
  { id: "overview", key: "menu.overview", to: "/home" },
  { id: "items", key: "menu.items", to: "/items" },
  { id: "locations", key: "menu.locations", to: "/locations" },
  { id: "maintenance", key: "menu.maintenance", to: "/maintenance" },
] as const;

export const toolsNavigation = [
  { id: "tags", key: "global.tags", to: "/tags" },
  { id: "templates", key: "menu.templates", to: "/templates" },
  { id: "collection-tools", key: "collection.tabs.tools", to: "/collection/tools" },
] as const;

export const settingsNavigation = [
  { id: "profile", key: "menu.profile", to: "/profile" },
  { id: "members", key: "collection.tabs.members", to: "/collection/members" },
  { id: "invites", key: "collection.tabs.invites", to: "/collection/invites" },
  { id: "notifiers", key: "collection.tabs.notifiers", to: "/collection/notifiers" },
  { id: "collection-settings", key: "collection.tabs.settings", to: "/collection/settings" },
  { id: "entity-types", key: "collection.tabs.entity_types", to: "/collection/entity-types" },
] as const;

export function isNavigationActive(path: string, destination: string): boolean {
  return path === destination || path.startsWith(`${destination}/`);
}
