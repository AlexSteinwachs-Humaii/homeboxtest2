import * as SecureStore from "expo-secure-store";

import { isStoredSession, type SessionStore, type StoredSession } from "./session";

// One small JSON value. SecureStore's per-item limit is about 2KB; a session
// token and server address fit. This is not an inventory database.
const KEY = "homebox.session";

export const secureSessionStore: SessionStore = {
  async load(): Promise<StoredSession | null> {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isStoredSession(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },

  async save(session: StoredSession): Promise<void> {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  },

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY);
  },
};
