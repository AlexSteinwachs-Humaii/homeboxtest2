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

const URL_SUFFIXES = ["/api/v1/users/login", "/api/v1"];

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
};

export type BarcodeProduct = {
  barcode: string;
  name: string;
  source: string;
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

export class HomeboxClient {
  readonly serverUrl: string;
  private token: string;
  private groupId = "";
  private readonly fetchImpl: FetchLike;

  constructor(serverUrl: string, token = "", fetchImpl: FetchLike = fetch) {
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
    if (file.uri) {
      // React Native reads this shape as a file part and uploads the bytes the
      // camera or library produced. Do not re-encode them here.
      form.append("file", { uri: file.uri, name: filename, type: mimeType } as unknown as Blob);
    } else {
      form.append("file", new File([file.bytes as BlobPart], filename, { type: mimeType }));
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
      method: "GET" | "POST" | "PUT" | "PATCH";
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
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
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
  };
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
