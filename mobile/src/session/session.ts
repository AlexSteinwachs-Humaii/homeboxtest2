import {
  authorizationHeader,
  HomeboxClient,
  normalizeServerUrl,
  ServerUrlError,
  type FetchLike,
  type UserOut,
} from "../api/client";

// A stored session is only enough to talk to the server again. It deliberately
// has no account profile and no inventory, so reopening the app cannot show
// who you are until /api/v1/users/self answers.

export type StoredSession = {
  serverUrl: string;
  token: string;
  attachmentToken: string;
  expiresAt: string;
};

export type Account = UserOut & { serverUrl: string };

export interface SessionStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export class MemorySessionStore implements SessionStore {
  value: StoredSession | null = null;
  saves = 0;
  clears = 0;

  async load(): Promise<StoredSession | null> {
    return this.value ? { ...this.value } : null;
  }

  async save(session: StoredSession): Promise<void> {
    this.saves += 1;
    this.value = { ...session };
  }

  async clear(): Promise<void> {
    this.clears += 1;
    this.value = null;
  }
}

export function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session.serverUrl === "string" &&
    session.serverUrl !== "" &&
    typeof session.token === "string" &&
    session.token !== "" &&
    typeof session.attachmentToken === "string" &&
    typeof session.expiresAt === "string"
  );
}

export type SessionDeps = {
  store: SessionStore;
  fetch?: FetchLike;
};

export type SignInInput = {
  serverUrl: string;
  username: string;
  password: string;
  stayLoggedIn?: boolean;
};

export type SignInResult = { ok: true; account: Account; session: StoredSession } | { ok: false; message: string };

export type RestoreResult =
  | { status: "signed-in"; account: Account; session: StoredSession }
  | { status: "signed-out"; serverUrl?: string; message?: string }
  | { status: "offline"; serverUrl: string; message: string };

const OFFLINE = "Could not reach the server. HomeBox keeps the inventory there, so this phone cannot show your account until the server answers.";
const EXPIRED = "Your session expired. Sign in again.";

function accountFrom(user: UserOut, serverUrl: string): Account {
  return { ...user, serverUrl };
}

function sessionFrom(serverUrl: string, token: string, attachmentToken: string, expiresAt: string): StoredSession {
  return {
    serverUrl,
    token: authorizationHeader(token),
    attachmentToken,
    expiresAt,
  };
}

export async function signIn(deps: SessionDeps, input: SignInInput): Promise<SignInResult> {
  const username = input.username.trim();
  const password = input.password;
  if (!username || !password) {
    return { ok: false, message: "Enter the email and password for an existing HomeBox account." };
  }

  let serverUrl: string;
  try {
    serverUrl = normalizeServerUrl(input.serverUrl);
  } catch (err) {
    if (err instanceof ServerUrlError) return { ok: false, message: err.message };
    return { ok: false, message: "That server address is not a valid URL." };
  }

  const client = new HomeboxClient(serverUrl, "", deps.fetch);
  const login = await client.login(username, password, input.stayLoggedIn === true);
  if (!login.ok) {
    return { ok: false, message: login.status === 401 ? "Invalid email or password" : login.error };
  }

  const session = sessionFrom(serverUrl, login.data.token, login.data.attachmentToken, login.data.expiresAt);
  client.setToken(session.token);
  const self = await client.self();
  if (!self.ok) {
    return {
      ok: false,
      message: self.status === 0 ? self.error : "Signed in, but the server did not return this account.",
    };
  }

  await deps.store.save(session);
  return { ok: true, account: accountFrom(self.data.item, serverUrl), session };
}

export async function restoreSession(deps: SessionDeps): Promise<RestoreResult> {
  const stored = await deps.store.load();
  if (!stored || !isStoredSession(stored)) {
    return { status: "signed-out" };
  }

  const client = new HomeboxClient(stored.serverUrl, stored.token, deps.fetch);
  let session = stored;
  let self = await client.self();

  if (!self.ok && self.status === 401) {
    const refreshed = await client.refresh();
    if (!refreshed.ok) {
      if (refreshed.status === 401 || refreshed.status === 403) {
        await deps.store.clear();
        return { status: "signed-out", serverUrl: stored.serverUrl, message: EXPIRED };
      }
      return { status: "offline", serverUrl: stored.serverUrl, message: OFFLINE };
    }
    // Refresh rotates the server token. Persist the new one before asking who
    // we are, or a failed follow-up call would leave the phone holding a dead token.
    session = sessionFrom(stored.serverUrl, refreshed.data.raw, refreshed.data.attachmentToken || stored.attachmentToken, refreshed.data.expiresAt || stored.expiresAt);
    await deps.store.save(session);
    client.setToken(session.token);
    self = await client.self();
  }

  if (!self.ok) {
    if (self.status === 0 || self.status >= 500) {
      return { status: "offline", serverUrl: stored.serverUrl, message: OFFLINE };
    }
    await deps.store.clear();
    return { status: "signed-out", serverUrl: stored.serverUrl, message: EXPIRED };
  }

  return { status: "signed-in", account: accountFrom(self.data.item, stored.serverUrl), session };
}

export async function signOut(deps: SessionDeps, session: StoredSession | null): Promise<void> {
  if (session) {
    const client = new HomeboxClient(session.serverUrl, session.token, deps.fetch);
    try {
      await client.logout();
    } catch {
      // The phone still forgets the token. The server session expires on its own if this call never landed.
    }
  }
  await deps.store.clear();
}
