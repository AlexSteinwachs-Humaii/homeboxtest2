// HomeBox /api/v1 client for the phone. Framework-agnostic on purpose: screens
// and a later Expo web build import this module. It does not open a database
// and it does not read attachment files from disk. The server is the inventory.

export class ServerUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerUrlError";
  }
}

export type TokenResponse = {
  token: string;
  attachmentToken: string;
  expiresAt: string;
};

export type RefreshResponse = {
  raw: string;
  attachmentToken: string;
  expiresAt: string;
};

export type UserOut = {
  id: string;
  name: string;
  email: string;
  isSuperuser: boolean;
  oidcIssuer: string;
  oidcSubject: string;
  defaultGroupId: string;
  groupIds: string[];
};

export type ApiSuccess<T> = { ok: true; status: number; data: T };
export type ApiFailure = { ok: false; status: number; error: string };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

const LOGIN_PATH = "/api/v1/users/login";
const SELF_PATH = "/api/v1/users/self";
const REFRESH_PATH = "/api/v1/users/refresh";
const LOGOUT_PATH = "/api/v1/users/logout";
const GROUPS_PATH = "/api/v1/groups/all";
const ENTITY_TYPES_PATH = "/api/v1/entity-types";
const ENTITIES_PATH = "/api/v1/entities";
const TREE_PATH = "/api/v1/entities/tree";
const ASSETS_PATH = "/api/v1/assets";
const BARCODE_PATH = "/api/v1/products/search-from-barcode";
const MAINTENANCE_PATH = "/api/v1/maintenance";

const URL_SUFFIXES = ["/api/v1/users/login", "/api/v1"];

// The production web export sets this so inventory calls stay on the page
// origin (`/api/v1` on the Bun server). The phone build leaves it unset and
// still requires the address the person types. It is not an Expo API route.
export function defaultWebServerUrl(): string {
  if (process.env.EXPO_PUBLIC_HOMEBOX_API_ORIGIN !== "same") return "";
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  if (!origin || origin === "null") return "";
  return origin;
}

export function resolveClientServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    const origin = defaultWebServerUrl();
    if (origin) return origin;
    if (process.env.EXPO_PUBLIC_HOMEBOX_API_ORIGIN === "same") return "";
  }
  return normalizeServerUrl(trimmed);
}

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ServerUrlError("Enter the HomeBox server address.");
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ServerUrlError("That server address is not a valid URL.");
  }

  if (url.username || url.password) {
    throw new ServerUrlError("Put the email and password in the sign-in fields, not in the server address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ServerUrlError("The server address must use http:// or https://.");
  }
  if (!url.hostname) {
    throw new ServerUrlError("That server address is not a valid URL.");
  }

  let path = url.pathname;
  try {
    path = decodeURI(url.pathname);
  } catch {
    path = url.pathname;
  }
  path = path.replace(/\/+$/, "");
  for (const suffix of URL_SUFFIXES) {
    if (path === suffix || path.endsWith(suffix)) {
      path = path.slice(0, -suffix.length);
      break;
    }
  }

  url.pathname = path && path !== "/" ? path : "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function authorizationHeader(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  if (/^bearer\s+/i.test(trimmed)) {
    return `Bearer ${trimmed.replace(/^bearer\s+/i, "")}`;
  }
  return `Bearer ${trimmed}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readUser(data: unknown): UserOut | null {
  if (!isRecord(data) || !isRecord(data.item)) return null;
  const item = data.item;
  if (typeof item.id !== "string" || item.id === "" || typeof item.email !== "string") return null;
  return {
    id: item.id,
    name: typeof item.name === "string" ? item.name : "",
    email: item.email,
    isSuperuser: item.isSuperuser === true,
    oidcIssuer: typeof item.oidcIssuer === "string" ? item.oidcIssuer : "",
    oidcSubject: typeof item.oidcSubject === "string" ? item.oidcSubject : "",
    defaultGroupId: typeof item.defaultGroupId === "string" ? item.defaultGroupId : "",
    groupIds: Array.isArray(item.groupIds) ? item.groupIds.filter((id): id is string => typeof id === "string") : [],
  };
}

function readTokenResponse(data: unknown): TokenResponse | null {
  if (!isRecord(data) || typeof data.token !== "string" || data.token.trim() === "") return null;
  return {
    token: data.token,
    attachmentToken: typeof data.attachmentToken === "string" ? data.attachmentToken : "",
    expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : "",
  };
}

function readRefreshResponse(data: unknown): RefreshResponse | null {
  if (!isRecord(data)) return null;
  const raw = typeof data.raw === "string" && data.raw !== "" ? data.raw : typeof data.token === "string" ? data.token : "";
  if (raw.trim() === "") return null;
  return {
    raw,
    attachmentToken: typeof data.attachmentToken === "string" ? data.attachmentToken : "",
    expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : "",
  };
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as unknown;
    if (Array.isArray(body)) {
      const parts = body
        .map((item) => (isRecord(item) && typeof item.error === "string" ? item.error : ""))
        .filter((item) => item !== "");
      if (parts.length > 0) return parts.join(" ");
    }
    if (isRecord(body) && typeof body.error === "string" && body.error !== "" && body.error !== "unauthorized") {
      return body.error;
    }
  } catch {
    // Non-JSON bodies still fail the call; the status is what the session layer uses.
  }
  return fallback;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GroupSummary = {
  id: string;
  name: string;
};

export type EntityTypeSummary = {
  id: string;
  name: string;
  isLocation: boolean;
};

export type EntitySummary = {
  id: string;
  name: string;
  description: string;
  quantity: number;
  assetId: string;
  parentId: string | null;
  parentName: string | null;
  entityTypeId: string | null;
  entityTypeName: string | null;
  isLocation: boolean;
  itemCount: number;
  insured: boolean;
  purchasePrice: number;
  tags?: Array<{ id: string; name: string }>;
};

export type TagChip = {
  id: string;
  name: string;
  color: string;
  description?: string;
  icon?: string;
};

export type GroupStatistics = {
  totalItems: number;
  totalLocations: number;
  totalTags: number;
  totalItemPrice: number;
};

export type BarcodeProduct = {
  barcode: string;
  name: string;
  source: string;
};

export type MaintenanceStatus = "scheduled" | "completed" | "both";

export type MaintenanceEntry = {
  id: string;
  name: string;
  description: string;
  cost: string;
  completedDate: string;
  scheduledDate: string;
  itemID: string;
  itemName: string;
};

export type MaintenanceUpdate = {
  name: string;
  description: string;
  cost: string;
  completedDate: string;
  scheduledDate: string;
};

export type EntityAttachment = {
  id: string;
  type: string;
  title: string;
  mimeType: string;
  path: string;
  primary: boolean;
  thumbnailId: string | null;
};

export type EntityDetail = EntitySummary & {
  notes: string;
  manufacturer: string;
  modelNumber: string;
  attachments: EntityAttachment[];
  raw: Record<string, unknown>;
};

// A picked photo. `uri` is the temporary camera-roll file React Native can upload.
// `bytes` is the same file for tests and for any caller that already has the contents.
// Neither is an inventory record — the server attachment is.
export type AttachmentUpload = {
  filename: string;
  mimeType: string;
  bytes?: Uint8Array;
  uri?: string;
  primary?: boolean;
};

export type TreeNode = {
  id: string;
  name: string;
  type: string;
  children: TreeNode[];
};

export type EntityCreateInput = {
  name: string;
  description: string;
  quantity: number;
  parentId: string | null;
  entityTypeId: string;
  tagIds?: string[];
};

export type BinaryFile = {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
};

export type ApiKeySummary = {
  id: string;
  name: string;
  expiresAt: string;
};

export type CollectionSettings = {
  id: string;
  name: string;
  currency: string;
};

export type MemberSummary = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type InvitationSummary = {
  id: string;
  expiresAt: string;
  uses: number;
  token: string;
};

export type NotifierSummary = {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
};

export type TemplateSummary = {
  id: string;
  name: string;
  description: string;
};

export type TemplateDetail = TemplateSummary & {
  raw: Record<string, unknown>;
};

export type CollectionExport = {
  id: string;
  status: string;
  progress: number;
  sizeBytes: number;
};

export class HomeboxClient {
  readonly serverUrl: string;
  private token: string;
  private groupId = "";
  private readonly fetchImpl: FetchLike;

  constructor(serverUrl: string, token = "", fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) {
    this.serverUrl = serverUrl;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  setToken(token: string): void {
    this.token = token;
  }

  setGroup(groupId: string): void {
    this.groupId = groupId.trim();
  }

  currentGroup(): string {
    return this.groupId;
  }

  login(username: string, password: string, stayLoggedIn = false): Promise<ApiResult<TokenResponse>> {
    return this.request(LOGIN_PATH, {
      method: "POST",
      auth: false,
      body: { username, password, stayLoggedIn },
      parse: readTokenResponse,
      failure: "Invalid email or password",
      malformed: "The server did not return a session.",
    });
  }

  self(): Promise<ApiResult<{ item: UserOut }>> {
    return this.request(SELF_PATH, {
      method: "GET",
      auth: true,
      parse: (data) => {
        const item = readUser(data);
        return item ? { item } : null;
      },
      failure: "The server did not return this account.",
      malformed: "The server did not return this account.",
    });
  }

  refresh(): Promise<ApiResult<RefreshResponse>> {
    return this.request(REFRESH_PATH, {
      method: "GET",
      auth: true,
      parse: readRefreshResponse,
      failure: "The server did not refresh this session.",
      malformed: "The server did not refresh this session.",
    });
  }

  logout(): Promise<ApiResult<null>> {
    return this.request(LOGOUT_PATH, {
      method: "POST",
      auth: true,
      parse: () => null,
      failure: "Could not sign out on the server.",
      malformed: "Could not sign out on the server.",
      allowEmpty: true,
    });
  }

  // Groups the account belongs to. No X-Tenant here: a stale collection must
  // not hide the list the selector is built from. The server still requires a session.
  listGroups(): Promise<ApiResult<GroupSummary[]>> {
    return this.request(GROUPS_PATH, {
      method: "GET",
      auth: true,
      tenant: false,
      parse: readGroups,
      failure: "The server did not return your collections.",
      malformed: "The server did not return your collections.",
    });
  }

  // Same POST the website's collection selector uses. The new id is not
  // selected until the caller sends it as X-Tenant.
  createGroup(name: string): Promise<ApiResult<GroupSummary>> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve({ ok: false, status: 0, error: "Enter a collection name." });
    return this.request("/api/v1/groups", {
      method: "POST",
      auth: true,
      tenant: false,
      body: { name: trimmed },
      parse: (data) => {
        if (!isRecord(data) || typeof data.id !== "string" || data.id === "") return null;
        return { id: data.id, name: text(data.name) || trimmed };
      },
      failure: "The server did not create this collection.",
      malformed: "The server did not return the new collection.",
    });
  }

  listEntityTypes(): Promise<ApiResult<EntityTypeSummary[]>> {
    return this.request(ENTITY_TYPES_PATH, {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readEntityTypes,
      failure: "The server did not return entity types.",
      malformed: "The server did not return entity types.",
    });
  }

  listEntities(isLocation: boolean): Promise<ApiResult<EntitySummary[]>> {
    const query = isLocation ? "isLocation=true" : "isLocation=false";
    return this.request(`${ENTITIES_PATH}?${query}`, {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readEntityList,
      failure: isLocation ? "The server did not return locations." : "The server did not return items.",
      malformed: isLocation ? "The server did not return locations." : "The server did not return items.",
    });
  }

  // Home "Recently Added" uses the same order the website asks for.
  recentItems(): Promise<ApiResult<EntitySummary[]>> {
    return this.request(`${ENTITIES_PATH}?page=1&pageSize=5&orderBy=createdAt`, {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readEntityList,
      failure: "The server did not return items.",
      malformed: "The server did not return items.",
    });
  }

  groupStatistics(): Promise<ApiResult<GroupStatistics>> {
    return this.request("/api/v1/groups/statistics", {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readGroupStatistics,
      failure: "The server did not return statistics.",
      malformed: "The server did not return statistics.",
    });
  }

  listTags(): Promise<ApiResult<TagChip[]>> {
    return this.request("/api/v1/tags", {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readTagChips,
      failure: "The server did not return tags.",
      malformed: "The server did not return tags.",
    });
  }

  createTag(input: { name: string; description?: string; color?: string; icon?: string }): Promise<ApiResult<TagChip>> {
    return this.request("/api/v1/tags", {
      method: "POST",
      auth: true,
      tenant: true,
      body: input,
      parse: readTagChip,
      failure: "The server did not create this tag.",
      malformed: "The server did not return the new tag.",
    });
  }

  updateTag(id: string, input: { name: string; description?: string; color?: string; icon?: string; parentId?: string | null }): Promise<ApiResult<TagChip>> {
    return this.request(`/api/v1/tags/${encodeURIComponent(id)}`, {
      method: "PUT",
      auth: true,
      tenant: true,
      body: input,
      parse: readTagChip,
      failure: "The server did not save this tag.",
      malformed: "The server did not return the saved tag.",
    });
  }

  deleteTag(id: string): Promise<ApiResult<{ deleted: true }>> {
    return this.request(`/api/v1/tags/${encodeURIComponent(id)}`, {
      method: "DELETE",
      auth: true,
      tenant: true,
      parse: () => ({ deleted: true }),
      allowEmpty: true,
      failure: "The server did not delete this tag.",
      malformed: "The server did not confirm the deletion.",
    });
  }

  // The query is sent as typed. Accent folding is the server's search, not a
  // second pass on the phone. Omitting page returns every match, same as the list.
  searchEntities(query: string): Promise<ApiResult<EntitySummary[]>> {
    const params = new URLSearchParams();
    params.set("q", query);
    return this.request(`${ENTITIES_PATH}?${params.toString()}`, {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readEntityList,
      failure: "The server did not return search results.",
      malformed: "The server did not return search results.",
    });
  }

  // Asset labels are /a/{assetId}. The server only returns this collection's rows.
  listByAssetId(assetId: string): Promise<ApiResult<EntitySummary[]>> {
    return this.request(`${ASSETS_PATH}/${encodeURIComponent(assetId)}`, {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readEntityList,
      failure: "The server did not return this label.",
      malformed: "The server did not return this label.",
    });
  }

  // Product barcodes are a catalog lookup, not an inventory create.
  searchFromBarcode(productEAN: string): Promise<ApiResult<BarcodeProduct[]>> {
    const params = new URLSearchParams();
    params.set("productEAN", productEAN);
    return this.request(`${BARCODE_PATH}?${params.toString()}`, {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readBarcodeProducts,
      failure: "The server did not look up this barcode.",
      malformed: "The server did not look up this barcode.",
    });
  }

  // Status is required by the Go handler. "both" is the website's unfiltered list.
  listMaintenance(status: MaintenanceStatus = "both"): Promise<ApiResult<MaintenanceEntry[]>> {
    const params = new URLSearchParams();
    params.set("status", status);
    return this.request(`${MAINTENANCE_PATH}?${params.toString()}`, {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readMaintenanceList,
      failure: "The server did not return maintenance.",
      malformed: "The server did not return maintenance.",
    });
  }

  // The website schedules maintenance on the item, then marks it complete.
  createMaintenance(entityId: string, name: string): Promise<ApiResult<{ id: string }>> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve({ ok: false, status: 0, error: "Enter a name for this maintenance." });
    return this.request(`${ENTITIES_PATH}/${encodeURIComponent(entityId)}/maintenance`, {
      method: "POST",
      auth: true,
      tenant: true,
      body: { name: trimmed },
      parse: (data) => {
        if (!isRecord(data) || typeof data.id !== "string" || data.id === "") return null;
        return { id: data.id };
      },
      failure: "The server did not schedule this maintenance.",
      malformed: "The server did not confirm this maintenance entry.",
    });
  }

  // Same body the website sends. Completion is a completedDate, not a new status.
  updateMaintenance(id: string, body: MaintenanceUpdate): Promise<ApiResult<{ id: string }>> {
    return this.request(`${MAINTENANCE_PATH}/${encodeURIComponent(id)}`, {
      method: "PUT",
      auth: true,
      tenant: true,
      body,
      parse: (data) => {
        if (!isRecord(data)) return null;
        const returned = typeof data.id === "string" && data.id !== "" ? data.id : id;
        return returned ? { id: returned } : null;
      },
      failure: "The server did not update this maintenance entry.",
      malformed: "The server did not confirm this maintenance entry.",
    });
  }

  listLocationTree(): Promise<ApiResult<TreeNode[]>> {
    return this.request(`${TREE_PATH}?withItems=false`, {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readTree,
      failure: "The server did not return the location tree.",
      malformed: "The server did not return the location tree.",
    });
  }

  getEntity(id: string): Promise<ApiResult<EntityDetail>> {
    return this.request(`${ENTITIES_PATH}/${encodeURIComponent(id)}`, {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readEntityDetail,
      failure: "The server did not return this item.",
      malformed: "The server did not return this item.",
    });
  }

  createEntity(input: EntityCreateInput): Promise<ApiResult<EntityDetail>> {
    return this.request(ENTITIES_PATH, {
      method: "POST",
      auth: true,
      tenant: true,
      body: {
        name: input.name,
        description: input.description,
        quantity: input.quantity,
        parentId: input.parentId,
        entityTypeId: input.entityTypeId,
        tagIds: input.tagIds ?? [],
      },
      parse: readEntityDetail,
      failure: "The server did not create this item.",
      malformed: "The server did not return the new item.",
    });
  }

  updateEntity(id: string, body: Record<string, unknown>): Promise<ApiResult<EntityDetail>> {
    return this.request(`${ENTITIES_PATH}/${encodeURIComponent(id)}`, {
      method: "PUT",
      auth: true,
      tenant: true,
      body,
      parse: readEntityDetail,
      failure: "The server did not save this item.",
      malformed: "The server did not return the saved item.",
    });
  }

  // Same multipart fields as the website: file, name, type, primary.
  // Content-Type is left unset so the boundary is generated with the body.
  async addAttachment(entityId: string, file: AttachmentUpload): Promise<ApiResult<EntityAttachment[]>> {
    if (!file.uri && (!file.bytes || file.bytes.byteLength === 0)) {
      return { ok: false, status: 0, error: "Choose a photo before uploading." };
    }
    const filename = file.filename.trim();
    if (!filename) {
      return { ok: false, status: 0, error: "The photo needs a file name before it can be stored." };
    }
    const authorization = authorizationHeader(this.token);
    if (!authorization) {
      return { ok: false, status: 401, error: "Sign in before continuing." };
    }
    if (!this.groupId) {
      return { ok: false, status: 0, error: "Choose a collection before loading inventory." };
    }

    const form = new FormData();
    const mimeType = file.mimeType || "application/octet-stream";
    if (file.bytes && file.bytes.byteLength > 0) {
      // Web file inputs and tests already have the bytes. Prefer them over a
      // React Native uri object, which the browser would upload as plain JSON.
      form.append("file", new File([file.bytes as BlobPart], filename, { type: mimeType }));
    } else if (file.uri) {
      // React Native reads this shape as a file part and uploads the bytes the
      // camera or library produced. Do not re-encode them here.
      form.append("file", { uri: file.uri, name: filename, type: mimeType } as unknown as Blob);
    } else {
      return { ok: false, status: 0, error: "Choose a photo before uploading." };
    }
    form.append("name", filename);
    form.append("type", "photo");
    form.append("primary", file.primary === false ? "false" : "true");

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: authorization,
      "X-Tenant": this.groupId,
    };
    const init: RequestInit = {
      method: "POST",
      headers,
      body: form,
      credentials: "omit",
    };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      init.signal = AbortSignal.timeout(60_000);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.serverUrl}${ENTITIES_PATH}/${encodeURIComponent(entityId)}/attachments`, init);
    } catch {
      return { ok: false, status: 0, error: "Could not reach the server. The photo was not saved." };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: await errorMessage(response, "The server did not store this photo.") };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false, status: response.status, error: "The server did not confirm the photo. It is not shown as saved." };
    }
    return { ok: true, status: response.status, data: readAttachments(data) };
  }

  updateProfile(name: string, email: string): Promise<ApiResult<{ name: string; email: string }>> {
    return this.request("/api/v1/users/self", {
      method: "PUT",
      auth: true,
      body: { name: name.trim(), email: email.trim() },
      parse: (data) => {
        if (!isRecord(data) || !isRecord(data.item)) return null;
        return { name: text(data.item.name), email: text(data.item.email) };
      },
      failure: "The server did not save this profile.",
      malformed: "The server did not confirm this profile.",
    });
  }

  changePassword(current: string, next: string): Promise<ApiResult<{ changed: true }>> {
    return this.request("/api/v1/users/self/change-password", {
      method: "PUT",
      auth: true,
      body: { current, new: next },
      parse: () => ({ changed: true }),
      allowEmpty: true,
      failure: "The server did not change this password.",
      malformed: "The server did not confirm the password change.",
    });
  }

  deleteProfile(): Promise<ApiResult<{ deleted: true }>> {
    return this.request("/api/v1/users/self", {
      method: "DELETE",
      auth: true,
      parse: () => ({ deleted: true }),
      allowEmpty: true,
      failure: "The server did not delete this account.",
      malformed: "The server did not confirm the deletion.",
    });
  }

  listApiKeys(): Promise<ApiResult<ApiKeySummary[]>> {
    return this.request("/api/v1/users/self/api-keys", {
      method: "GET",
      auth: true,
      parse: readApiKeys,
      failure: "The server did not return API keys.",
      malformed: "The server did not return API keys.",
    });
  }

  createApiKey(name: string): Promise<ApiResult<ApiKeySummary & { token: string }>> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve({ ok: false, status: 0, error: "Enter a name for this API key." });
    return this.request("/api/v1/users/self/api-keys", {
      method: "POST",
      auth: true,
      body: { name: trimmed },
      parse: (data) => {
        const key = readApiKey(data);
        if (!key || !isRecord(data) || typeof data.token !== "string") return null;
        return { ...key, token: data.token };
      },
      failure: "The server did not create this API key.",
      malformed: "The server did not return the new API key.",
    });
  }

  deleteApiKey(id: string): Promise<ApiResult<{ deleted: true }>> {
    return this.request(`/api/v1/users/self/api-keys/${encodeURIComponent(id)}`, {
      method: "DELETE",
      auth: true,
      parse: () => ({ deleted: true }),
      allowEmpty: true,
      failure: "The server did not delete this API key.",
      malformed: "The server did not confirm the deletion.",
    });
  }

  getCollection(): Promise<ApiResult<CollectionSettings>> {
    return this.request("/api/v1/groups", {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readCollection,
      failure: "The server did not return this collection.",
      malformed: "The server did not return this collection.",
    });
  }

  updateCollection(name: string, currency: string): Promise<ApiResult<CollectionSettings>> {
    return this.request("/api/v1/groups", {
      method: "PUT",
      auth: true,
      tenant: true,
      body: { name: name.trim(), currency: currency.trim() },
      parse: readCollection,
      failure: "The server did not save this collection.",
      malformed: "The server did not confirm this collection.",
    });
  }

  listCurrencies(): Promise<ApiResult<string[]>> {
    return this.request("/api/v1/currencies", {
      method: "GET",
      auth: false,
      parse: (data) => {
        if (!Array.isArray(data)) return null;
        return data.map((row) => (isRecord(row) ? text(row.code) : "")).filter((code) => code !== "");
      },
      failure: "The server did not return currencies.",
      malformed: "The server did not return currencies.",
    });
  }

  listMembers(): Promise<ApiResult<MemberSummary[]>> {
    return this.request("/api/v1/groups/members", {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readMembers,
      failure: "The server did not return members.",
      malformed: "The server did not return members.",
    });
  }

  removeMember(userId: string): Promise<ApiResult<{ removed: true }>> {
    return this.request(`/api/v1/groups/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      auth: true,
      tenant: true,
      parse: () => ({ removed: true }),
      allowEmpty: true,
      failure: "The server did not remove this member.",
      malformed: "The server did not confirm the removal.",
    });
  }

  listInvitations(): Promise<ApiResult<InvitationSummary[]>> {
    return this.request("/api/v1/groups/invitations", {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readInvitations,
      failure: "The server did not return invites.",
      malformed: "The server did not return invites.",
    });
  }

  createInvitation(uses = 1): Promise<ApiResult<InvitationSummary>> {
    return this.request("/api/v1/groups/invitations", {
      method: "POST",
      auth: true,
      tenant: true,
      body: { uses },
      parse: readInvitation,
      failure: "The server did not create this invite.",
      malformed: "The server did not return the invite.",
    });
  }

  deleteInvitation(id: string): Promise<ApiResult<{ deleted: true }>> {
    return this.request(`/api/v1/groups/invitations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      auth: true,
      tenant: true,
      parse: () => ({ deleted: true }),
      allowEmpty: true,
      failure: "The server did not revoke this invite.",
      malformed: "The server did not confirm the revocation.",
    });
  }

  listNotifiers(): Promise<ApiResult<NotifierSummary[]>> {
    return this.request("/api/v1/notifiers", {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readNotifiers,
      failure: "The server did not return notifiers.",
      malformed: "The server did not return notifiers.",
    });
  }

  createNotifier(name: string, url: string): Promise<ApiResult<NotifierSummary>> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve({ ok: false, status: 0, error: "Enter a name for this notifier." });
    if (!url.trim()) return Promise.resolve({ ok: false, status: 0, error: "Enter a URL for this notifier." });
    return this.request("/api/v1/notifiers", {
      method: "POST",
      auth: true,
      tenant: true,
      body: { name: trimmed, url: url.trim(), isActive: true },
      parse: readNotifier,
      failure: "The server did not create this notifier.",
      malformed: "The server did not return the notifier.",
    });
  }

  deleteNotifier(id: string): Promise<ApiResult<{ deleted: true }>> {
    return this.request(`/api/v1/notifiers/${encodeURIComponent(id)}`, {
      method: "DELETE",
      auth: true,
      tenant: true,
      parse: () => ({ deleted: true }),
      allowEmpty: true,
      failure: "The server did not delete this notifier.",
      malformed: "The server did not confirm the deletion.",
    });
  }

  createEntityType(name: string, isLocation: boolean): Promise<ApiResult<EntityTypeSummary>> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve({ ok: false, status: 0, error: "Enter a name for this type." });
    return this.request("/api/v1/entity-types", {
      method: "POST",
      auth: true,
      tenant: true,
      body: { name: trimmed, isLocation },
      parse: (data) => {
        if (!isRecord(data) || typeof data.id !== "string" || data.id === "") return null;
        return { id: data.id, name: text(data.name) || trimmed, isLocation: data.isLocation === true };
      },
      failure: "The server did not create this entity type.",
      malformed: "The server did not return the entity type.",
    });
  }

  listTemplates(): Promise<ApiResult<TemplateSummary[]>> {
    return this.request("/api/v1/templates", {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readTemplates,
      failure: "The server did not return templates.",
      malformed: "The server did not return templates.",
    });
  }

  getTemplate(id: string): Promise<ApiResult<TemplateDetail>> {
    return this.request(`/api/v1/templates/${encodeURIComponent(id)}`, {
      method: "GET",
      auth: true,
      tenant: true,
      parse: readTemplateDetail,
      failure: "The server did not return this template.",
      malformed: "The server did not return this template.",
    });
  }

  createTemplate(name: string): Promise<ApiResult<{ id: string }>> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve({ ok: false, status: 0, error: "Enter a name for this template." });
    return this.request("/api/v1/templates", {
      method: "POST",
      auth: true,
      tenant: true,
      body: { name: trimmed },
      parse: (data) => {
        if (!isRecord(data) || typeof data.id !== "string" || data.id === "") return null;
        return { id: data.id };
      },
      failure: "The server did not create this template.",
      malformed: "The server did not return the template.",
    });
  }

  saveTemplate(id: string, body: Record<string, unknown>): Promise<ApiResult<TemplateDetail>> {
    return this.request(`/api/v1/templates/${encodeURIComponent(id)}`, {
      method: "PUT",
      auth: true,
      tenant: true,
      body,
      parse: readTemplateDetail,
      failure: "The server did not save this template.",
      malformed: "The server did not confirm this template.",
    });
  }

  listCollectionExports(): Promise<ApiResult<CollectionExport[]>> {
    return this.request("/api/v1/group/exports", {
      method: "GET",
      auth: true,
      tenant: true,
      parse: (data) => {
        if (!isRecord(data) || !Array.isArray(data.items)) return null;
        return data.items.map(readExport).filter((row): row is CollectionExport => row !== null);
      },
      failure: "The server did not return collection exports.",
      malformed: "The server did not return collection exports.",
    });
  }

  startCollectionExport(): Promise<ApiResult<CollectionExport>> {
    return this.request("/api/v1/group/exports", {
      method: "POST",
      auth: true,
      tenant: true,
      parse: readExport,
      failure: "The server did not start this export.",
      malformed: "The server did not return the export.",
    });
  }

  deleteCollectionExport(id: string): Promise<ApiResult<{ deleted: true }>> {
    return this.request(`/api/v1/group/exports/${encodeURIComponent(id)}`, {
      method: "DELETE",
      auth: true,
      tenant: true,
      parse: () => ({ deleted: true }),
      allowEmpty: true,
      failure: "The server did not delete this export.",
      malformed: "The server did not confirm the deletion.",
    });
  }

  runMaintenanceAction(path: string, body?: Record<string, unknown>): Promise<ApiResult<{ completed: number }>> {
    return this.request(path, {
      method: "POST",
      auth: true,
      tenant: true,
      body: body ?? {},
      parse: (data) => {
        if (!isRecord(data) || typeof data.completed !== "number") return null;
        return { completed: data.completed };
      },
      failure: "The server did not run this action.",
      malformed: "The server did not confirm this action.",
    });
  }

  labelImage(kind: "entity" | "location" | "asset", id: string): Promise<ApiResult<BinaryFile>> {
    return this.getBytes(`/api/v1/labelmaker/${kind}/${encodeURIComponent(id)}`, "label.png");
  }

  // The server decodes the query once more than the URL parser, matching the Vue client.
  qrImage(data: string): Promise<ApiResult<BinaryFile>> {
    const params = new URLSearchParams();
    params.set("data", encodeURIComponent(data));
    return this.getBytes(`/api/v1/qrcode?${params.toString()}`, "qrcode.jpg");
  }

  exportEntitiesCsv(): Promise<ApiResult<BinaryFile>> {
    return this.getBytes("/api/v1/entities/export", "homebox-entities.csv");
  }

  billOfMaterials(): Promise<ApiResult<BinaryFile>> {
    return this.getBytes("/api/v1/reporting/bill-of-materials", "bill-of-materials.csv");
  }

  downloadCollectionExport(id: string): Promise<ApiResult<BinaryFile>> {
    return this.getBytes(`/api/v1/group/exports/${encodeURIComponent(id)}/download`, `homebox-export-${id}.zip`);
  }

  importEntitiesCsv(filename: string, bytes: Uint8Array): Promise<ApiResult<{ imported: true }>> {
    return this.postFile("/api/v1/entities/import", "csv", filename || "import.csv", "text/csv", bytes, "The server did not import this CSV.");
  }

  importCollectionZip(filename: string, bytes: Uint8Array): Promise<ApiResult<{ imported: true }>> {
    return this.postFile("/api/v1/group/import", "file", filename || "homebox-export.zip", "application/zip", bytes, "The server did not import this collection.");
  }

  // Image views cannot set Authorization. The login attachment token is the
  // access_token query the server already accepts for this route.
  attachmentUrl(entityId: string, attachmentId: string, attachmentToken: string): string {
    const url = new URL(
      `${this.serverUrl}/api/v1/entities/${encodeURIComponent(entityId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    if (attachmentToken) url.searchParams.set("access_token", attachmentToken);
    if (this.groupId) url.searchParams.set("tenant", this.groupId);
    return url.toString();
  }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      auth: boolean;
      tenant?: boolean;
      body?: unknown;
      parse: (data: unknown) => T | null;
      failure: string;
      malformed: string;
      allowEmpty?: boolean;
    },
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.auth) {
      const authorization = authorizationHeader(this.token);
      if (!authorization) {
        return { ok: false, status: 401, error: "Sign in before continuing." };
      }
      headers.Authorization = authorization;
    }
    if (options.tenant) {
      if (!this.groupId) {
        return { ok: false, status: 0, error: "Choose a collection before loading inventory." };
      }
      headers["X-Tenant"] = this.groupId;
    }

    const init: RequestInit = {
      method: options.method,
      headers,
      credentials: "omit",
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      init.signal = AbortSignal.timeout(15000);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.serverUrl}${path}`, init);
    } catch {
      return { ok: false, status: 0, error: "Could not reach the server. Check the address and that HomeBox is running." };
    }

    if (!response.ok) {
      return { ok: false, status: response.status, error: await errorMessage(response, options.failure) };
    }

    if (response.status === 204 || options.allowEmpty) {
      return { ok: true, status: response.status, data: options.parse(null) as T };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false, status: response.status, error: options.malformed };
    }

    const parsed = options.parse(data);
    if (parsed === null) {
      return { ok: false, status: response.status, error: options.malformed };
    }
    return { ok: true, status: response.status, data: parsed };
  }

  private async getBytes(path: string, fallbackName: string): Promise<ApiResult<BinaryFile>> {
    const headers = this.sessionHeaders(true);
    if (!headers) return headersMissing();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.serverUrl}${path}`, {
        method: "GET",
        headers,
        credentials: "omit",
      });
    } catch {
      return { ok: false, status: 0, error: "Could not reach the server. Check the address and that HomeBox is running." };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: await errorMessage(response, "The server did not return this file.") };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    return {
      ok: true,
      status: response.status,
      data: {
        bytes,
        contentType,
        filename: filenameFromHeader(response.headers.get("content-disposition"), fallbackName),
      },
    };
  }

  private async postFile(
    path: string,
    field: string,
    filename: string,
    mimeType: string,
    bytes: Uint8Array,
    failure: string,
  ): Promise<ApiResult<{ imported: true }>> {
    if (typeof File === "undefined") {
      return { ok: false, status: 0, error: "This import uses the browser file control. Open the tool on the web client." };
    }
    const headers = this.sessionHeaders(true);
    if (!headers) return headersMissing();
    const form = new FormData();
    form.append(field, new File([bytes as BlobPart], filename, { type: mimeType }));
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.serverUrl}${path}`, {
        method: "POST",
        headers,
        body: form,
        credentials: "omit",
      });
    } catch {
      return { ok: false, status: 0, error: "Could not reach the server. Check the address and that HomeBox is running." };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: await errorMessage(response, failure) };
    }
    return { ok: true, status: response.status, data: { imported: true } };
  }

  private sessionHeaders(tenant: boolean): Record<string, string> | null {
    const authorization = authorizationHeader(this.token);
    if (!authorization) return null;
    const headers: Record<string, string> = { Accept: "*/*", Authorization: authorization };
    if (tenant) {
      if (!this.groupId) return null;
      headers["X-Tenant"] = this.groupId;
    }
    return headers;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function headersMissing(): ApiFailure {
  return { ok: false, status: 401, error: "Sign in and choose a collection before continuing." };
}

function filenameFromHeader(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

function readApiKey(data: unknown): ApiKeySummary | null {
  if (!isRecord(data) || typeof data.id !== "string" || data.id === "") return null;
  return { id: data.id, name: text(data.name) || "API key", expiresAt: text(data.expiresAt) };
}

function readApiKeys(data: unknown): ApiKeySummary[] | null {
  if (!Array.isArray(data)) return null;
  return data.map(readApiKey).filter((row): row is ApiKeySummary => row !== null);
}

function readCollection(data: unknown): CollectionSettings | null {
  if (!isRecord(data) || typeof data.id !== "string" || data.id === "") return null;
  return { id: data.id, name: text(data.name) || "Collection", currency: text(data.currency) || "USD" };
}

function readMembers(data: unknown): MemberSummary[] | null {
  if (!Array.isArray(data)) return null;
  const members: MemberSummary[] = [];
  for (const row of data) {
    if (!isRecord(row) || typeof row.id !== "string" || row.id === "") continue;
    members.push({ id: row.id, name: text(row.name), email: text(row.email), role: text(row.role) || "member" });
  }
  return members;
}

function readInvitation(data: unknown): InvitationSummary | null {
  if (!isRecord(data) || typeof data.id !== "string" || data.id === "") return null;
  return { id: data.id, expiresAt: text(data.expiresAt), uses: typeof data.uses === "number" ? data.uses : 0, token: text(data.token) };
}

function readInvitations(data: unknown): InvitationSummary[] | null {
  if (!Array.isArray(data)) return null;
  return data.map(readInvitation).filter((row): row is InvitationSummary => row !== null);
}

function readNotifier(data: unknown): NotifierSummary | null {
  if (!isRecord(data) || typeof data.id !== "string" || data.id === "") return null;
  return { id: data.id, name: text(data.name) || "Notifier", url: text(data.url), isActive: data.isActive !== false };
}

function readNotifiers(data: unknown): NotifierSummary[] | null {
  if (!Array.isArray(data)) return null;
  return data.map(readNotifier).filter((row): row is NotifierSummary => row !== null);
}

function readTemplates(data: unknown): TemplateSummary[] | null {
  if (!Array.isArray(data)) return null;
  const templates: TemplateSummary[] = [];
  for (const row of data) {
    if (!isRecord(row) || typeof row.id !== "string" || row.id === "") continue;
    templates.push({ id: row.id, name: text(row.name) || "Template", description: text(row.description) });
  }
  return templates;
}

function readTemplateDetail(data: unknown): TemplateDetail | null {
  if (!isRecord(data) || typeof data.id !== "string" || data.id === "") return null;
  return { id: data.id, name: text(data.name) || "Template", description: text(data.description), raw: data };
}

function readExport(data: unknown): CollectionExport | null {
  if (!isRecord(data) || typeof data.id !== "string" || data.id === "") return null;
  return {
    id: data.id,
    status: text(data.status) || "unknown",
    progress: typeof data.progress === "number" ? data.progress : 0,
    sizeBytes: typeof data.sizeBytes === "number" ? data.sizeBytes : 0,
  };
}

function readGroups(data: unknown): GroupSummary[] | null {
  if (!Array.isArray(data)) return null;
  const groups: GroupSummary[] = [];
  for (const row of data) {
    if (!isRecord(row) || typeof row.id !== "string" || row.id === "") continue;
    groups.push({ id: row.id, name: text(row.name) || "Collection" });
  }
  return groups;
}

function readEntityTypes(data: unknown): EntityTypeSummary[] | null {
  if (!Array.isArray(data)) return null;
  const types: EntityTypeSummary[] = [];
  for (const row of data) {
    if (!isRecord(row) || typeof row.id !== "string" || row.id === "") continue;
    types.push({
      id: row.id,
      name: text(row.name) || "Type",
      isLocation: row.isLocation === true,
    });
  }
  return types;
}

function readEntityList(data: unknown): EntitySummary[] | null {
  if (!isRecord(data) || !Array.isArray(data.items)) return null;
  return data.items.map(readSummary).filter((item): item is EntitySummary => item !== null);
}

function readBarcodeProducts(data: unknown): BarcodeProduct[] | null {
  if (!Array.isArray(data)) return null;
  const products: BarcodeProduct[] = [];
  for (const row of data) {
    if (!isRecord(row)) continue;
    const item = isRecord(row.item) ? row.item : null;
    products.push({
      barcode: text(row.barcode),
      name: item && typeof item.name === "string" ? item.name : "",
      source: text(row.search_engine_name),
    });
  }
  return products;
}

function readSummary(data: unknown): EntitySummary | null {
  if (!isRecord(data) || typeof data.id !== "string" || data.id === "" || typeof data.name !== "string") return null;
  const parent = isRecord(data.parent) ? data.parent : null;
  const entityType = isRecord(data.entityType) ? data.entityType : null;
  const quantity = typeof data.quantity === "number" && Number.isFinite(data.quantity) ? data.quantity : 1;
  return {
    id: data.id,
    name: data.name,
    description: text(data.description),
    quantity,
    assetId: text(data.assetId),
    parentId: parent && typeof parent.id === "string" ? parent.id : null,
    parentName: parent && typeof parent.name === "string" ? parent.name : null,
    entityTypeId: entityType && typeof entityType.id === "string" ? entityType.id : null,
    entityTypeName: entityType && typeof entityType.name === "string" ? entityType.name : null,
    isLocation: entityType?.isLocation === true,
    itemCount: typeof data.itemCount === "number" ? data.itemCount : 0,
    insured: data.insured === true,
    purchasePrice: typeof data.purchasePrice === "number" && Number.isFinite(data.purchasePrice) ? data.purchasePrice : 0,
    tags: Array.isArray(data.tags)
      ? data.tags
          .filter((tag): tag is Record<string, unknown> => isRecord(tag) && typeof tag.id === "string")
          .map((tag) => ({ id: tag.id as string, name: typeof tag.name === "string" ? tag.name : "" }))
      : [],
  };
}

function readGroupStatistics(data: unknown): GroupStatistics | null {
  if (!isRecord(data)) return null;
  const numberOr = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return {
    totalItems: numberOr(data.totalItems),
    totalLocations: numberOr(data.totalLocations),
    totalTags: numberOr(data.totalTags),
    totalItemPrice: numberOr(data.totalItemPrice),
  };
}

function readTagChip(data: unknown): TagChip | null {
  if (!isRecord(data) || typeof data.id !== "string" || typeof data.name !== "string") return null;
  return {
    id: data.id,
    name: data.name,
    color: typeof data.color === "string" ? data.color : "",
    description: typeof data.description === "string" ? data.description : "",
    icon: typeof data.icon === "string" ? data.icon : "",
  };
}

function readTagChips(data: unknown): TagChip[] | null {
  if (!Array.isArray(data)) return null;
  const tags: TagChip[] = [];
  for (const row of data) {
    const tag = readTagChip(row);
    if (tag) tags.push(tag);
  }
  return tags;
}

function readEntityDetail(data: unknown): EntityDetail | null {
  const summary = readSummary(data);
  if (!summary || !isRecord(data)) return null;
  return {
    ...summary,
    notes: text(data.notes),
    manufacturer: text(data.manufacturer),
    modelNumber: text(data.modelNumber),
    attachments: readAttachments(data),
    raw: data,
  };
}

export function readAttachments(data: unknown): EntityAttachment[] {
  if (!isRecord(data) || !Array.isArray(data.attachments)) return [];
  const attachments: EntityAttachment[] = [];
  for (const row of data.attachments) {
    const parsed = readAttachment(row);
    if (parsed && parsed.type !== "thumbnail") attachments.push(parsed);
  }
  return attachments;
}

function readAttachment(data: unknown): EntityAttachment | null {
  if (!isRecord(data) || typeof data.id !== "string" || data.id === "") return null;
  const thumbnail = isRecord(data.thumbnail) && typeof data.thumbnail.id === "string" ? data.thumbnail.id : null;
  return {
    id: data.id,
    type: text(data.type) || "attachment",
    title: text(data.title),
    mimeType: text(data.mimeType),
    path: text(data.path),
    primary: data.primary === true,
    thumbnailId: thumbnail,
  };
}

function readMaintenanceList(data: unknown): MaintenanceEntry[] | null {
  if (!Array.isArray(data)) return null;
  const entries: MaintenanceEntry[] = [];
  for (const row of data) {
    const parsed = readMaintenanceEntry(row);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

function readMaintenanceEntry(data: unknown): MaintenanceEntry | null {
  if (!isRecord(data) || typeof data.id !== "string" || data.id === "" || typeof data.name !== "string") return null;
  return {
    id: data.id,
    name: data.name,
    description: text(data.description),
    cost: readCost(data.cost),
    completedDate: readDate(data.completedDate),
    scheduledDate: readDate(data.scheduledDate),
    itemID: text(data.itemID),
    itemName: text(data.itemName),
  };
}

function readCost(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "0";
}

function readDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.startsWith("0001-")) return "";
  return trimmed;
}

function readTree(data: unknown): TreeNode[] | null {
  if (!Array.isArray(data)) return null;
  return data.map(readTreeNode).filter((node): node is TreeNode => node !== null);
}

function readTreeNode(data: unknown): TreeNode | null {
  if (!isRecord(data) || typeof data.id !== "string" || data.id === "" || typeof data.name !== "string") return null;
  const children = Array.isArray(data.children) ? data.children.map(readTreeNode).filter((node): node is TreeNode => node !== null) : [];
  return {
    id: data.id,
    name: data.name,
    type: text(data.type) || "location",
    children,
  };
}
