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
    if (isRecord(body) && typeof body.error === "string" && body.error !== "" && body.error !== "unauthorized") {
      return body.error;
    }
  } catch {
    // Non-JSON bodies still fail the call; the status is what the session layer uses.
  }
  return fallback;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HomeboxClient {
  readonly serverUrl: string;
  private token: string;
  private readonly fetchImpl: FetchLike;

  constructor(serverUrl: string, token = "", fetchImpl: FetchLike = fetch) {
    this.serverUrl = serverUrl;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  setToken(token: string): void {
    this.token = token;
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

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST";
      auth: boolean;
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
