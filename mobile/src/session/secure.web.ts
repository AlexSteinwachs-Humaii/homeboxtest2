import { isStoredSession, type SessionStore, type StoredSession } from "./session";

// Web stand-in for expo-secure-store. The phone keeps using secure.ts.
// This holds the session token only — not inventory.
const KEY = "homebox.session";

function browserStorage(): Storage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

export const secureSessionStore: SessionStore = {
  async load(): Promise<StoredSession | null> {
    const raw = browserStorage()?.getItem(KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isStoredSession(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },

  async save(session: StoredSession): Promise<void> {
    browserStorage()?.setItem(KEY, JSON.stringify(session));
  },

  async clear(): Promise<void> {
    browserStorage()?.removeItem(KEY);
  },
};
