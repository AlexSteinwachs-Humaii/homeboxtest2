// Vue pages this web client must still reach. A tool is either backed by an
// existing /api/v1 route or named on a page that says it is not in this release.
// Silent omission is the failure this list exists to prevent.

export const NOT_IN_THIS_RELEASE = "is not in this release";

export function notInThisRelease(name: string): string {
  return `${name} ${NOT_IN_THIS_RELEASE}.`;
}

export type ToolId =
  | "labels"
  | "qr"
  | "csv"
  | "collection-transfer"
  | "bill-of-materials"
  | "maintenance-actions"
  | "profile"
  | "collection-settings"
  | "members"
  | "invites"
  | "notifiers"
  | "entity-types"
  | "templates"
  | "tags";

export type ToolDefinition = {
  id: ToolId;
  title: string;
  summary: string;
  implemented: boolean;
  endpoints: string[];
};

export const TOOLS: ToolDefinition[] = [
  {
    id: "labels",
    title: "Labels",
    summary: "Printable labels for an item, a location, or an asset id.",
    implemented: true,
    endpoints: ["/api/v1/labelmaker/entity/", "/api/v1/labelmaker/location/", "/api/v1/labelmaker/asset/"],
  },
  {
    id: "qr",
    title: "QR",
    summary: "A QR code for an address or any text you enter.",
    implemented: true,
    endpoints: ["/api/v1/qrcode"],
  },
  {
    id: "csv",
    title: "CSV import/export",
    summary: "Download this collection as CSV, or import a CSV file.",
    implemented: true,
    endpoints: ["/api/v1/entities/export", "/api/v1/entities/import"],
  },
  {
    id: "collection-transfer",
    title: "Collection import/export",
    summary: "Create a collection export, download it, or restore a zip.",
    implemented: true,
    endpoints: ["/api/v1/group/exports", "/api/v1/group/import"],
  },
  {
    id: "bill-of-materials",
    title: "Bill of materials",
    summary: "Download the bill of materials report.",
    implemented: true,
    endpoints: ["/api/v1/reporting/bill-of-materials"],
  },
  {
    id: "maintenance-actions",
    title: "Maintenance actions",
    summary: "The collection tools that repair ids, photos, dates, and inventory.",
    implemented: true,
    endpoints: [
      "/api/v1/actions/ensure-asset-ids",
      "/api/v1/actions/ensure-import-refs",
      "/api/v1/actions/zero-item-time-fields",
      "/api/v1/actions/set-primary-photos",
      "/api/v1/actions/create-missing-thumbnails",
      "/api/v1/actions/wipe-inventory",
    ],
  },
  {
    id: "profile",
    title: "Profile",
    summary: "Name, email, password, and API keys for this account.",
    implemented: true,
    endpoints: ["/api/v1/users/self", "/api/v1/users/self/change-password", "/api/v1/users/self/api-keys"],
  },
  {
    id: "collection-settings",
    title: "Collection settings",
    summary: "The name and currency of this collection.",
    implemented: true,
    endpoints: ["/api/v1/groups", "/api/v1/currencies"],
  },
  {
    id: "members",
    title: "Members",
    summary: "People in this collection.",
    implemented: true,
    endpoints: ["/api/v1/groups/members"],
  },
  {
    id: "invites",
    title: "Invites",
    summary: "Invitation links for this collection.",
    implemented: true,
    endpoints: ["/api/v1/groups/invitations"],
  },
  {
    id: "notifiers",
    title: "Notifiers",
    summary: "Webhook notifiers for this collection.",
    implemented: true,
    endpoints: ["/api/v1/notifiers"],
  },
  {
    id: "entity-types",
    title: "Entity types",
    summary: "Item and location types in this collection.",
    implemented: true,
    endpoints: ["/api/v1/entity-types"],
  },
  {
    id: "templates",
    title: "Templates",
    summary: "Item templates for this collection.",
    implemented: true,
    endpoints: ["/api/v1/templates"],
  },
  {
    id: "tags",
    title: "Tags",
    summary: "Create and edit tags in this collection.",
    implemented: true,
    endpoints: ["/api/v1/tags"],
  },
];

// Controls that lived on the Vue profile page and are not a server tool.
export const PROFILE_GAPS = ["Language", "Theme"] as const;

export type ResolvedRoute =
  | { kind: "home" }
  | { kind: "items" }
  | { kind: "locations" }
  | { kind: "maintenance" }
  | { kind: "tool"; id: ToolId; focusId?: string }
  | { kind: "hub" }
  | { kind: "gap"; title: string; path: string };

export function toolById(id: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

function normalizePath(input: string): string {
  const raw = input.trim();
  if (!raw) return "/";
  const withoutQuery = raw.split("?")[0]?.split("#")[0] ?? "/";
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    decoded = withoutQuery;
  }
  if (!decoded.startsWith("/")) decoded = `/${decoded}`;
  return decoded.replace(/\/+$/, "") || "/";
}

function titleFromPath(path: string): string {
  const segment = path.split("/").filter(Boolean).pop() ?? path;
  const words = segment.replace(/[-_]+/g, " ").trim();
  if (!words) return "This page";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Maps a Vue address onto a tool, an inventory screen, or a named gap.
// An unknown address is never a blank shell: it names the page.
export function resolveWebPath(input: string): ResolvedRoute {
  const path = normalizePath(input);
  if (path === "/") return { kind: "home" };

  const exact: Record<string, ResolvedRoute> = {
    "/home": { kind: "home" },
    "/items": { kind: "items" },
    "/locations": { kind: "locations" },
    "/maintenance": { kind: "maintenance" },
    "/reports/label-generator": { kind: "tool", id: "labels" },
    "/collection": { kind: "hub" },
    "/collection/tools": { kind: "hub" },
    "/collection/members": { kind: "tool", id: "members" },
    "/collection/invites": { kind: "tool", id: "invites" },
    "/collection/notifiers": { kind: "tool", id: "notifiers" },
    "/collection/settings": { kind: "tool", id: "collection-settings" },
    "/collection/entity-types": { kind: "tool", id: "entity-types" },
    "/profile": { kind: "tool", id: "profile" },
    "/templates": { kind: "tool", id: "templates" },
    "/tags": { kind: "tool", id: "tags" },
  };
  const known = exact[path];
  if (known) return known;

  const template = /^\/template\/([^/]+)$/.exec(path);
  if (template) return { kind: "tool", id: "templates", focusId: template[1] };

  const tag = /^\/tag\/([^/]+)$/.exec(path);
  if (tag) return { kind: "tool", id: "tags", focusId: tag[1] };
  const label = /^\/label\/([^/]+)$/.exec(path);
  if (label) return { kind: "tool", id: "labels", focusId: label[1] };

  const asset = /^\/a\/([^/]+)$/.exec(path);
  if (asset) return { kind: "tool", id: "labels", focusId: asset[1] };

  return { kind: "gap", title: titleFromPath(path), path };
}
