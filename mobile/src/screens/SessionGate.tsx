import { useCallback, useEffect, useState } from "react";

import { defaultWebServerUrl } from "../api/client";
import { secureSessionStore } from "../session/secure";
import { restoreSession, signIn, signOut, type Account, type StoredSession } from "../session/session";
import { InventoryApp } from "./InventoryApp";
import { SignInScreen, type SignInForm } from "./SignInScreen";
import { LoadingScreen, OfflineScreen } from "./StatusScreen";

type Phase =
  | { kind: "loading" }
  | { kind: "sign-in"; serverUrl: string; error: string | null; busy: boolean }
  | { kind: "account"; account: Account; session: StoredSession; busy: boolean }
  | { kind: "offline"; serverUrl: string; message: string; busy: boolean };

const store = secureSessionStore;

type Props = {
  requestedPath?: string;
};

export function SessionGate({ requestedPath }: Props = {}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const boot = useCallback(async () => {
    setPhase({ kind: "loading" });
    const result = await restoreSession({ store });
    if (result.status === "signed-in") {
      setPhase({ kind: "account", account: result.account, session: result.session, busy: false });
      return;
    }
    if (result.status === "offline") {
      setPhase({ kind: "offline", serverUrl: result.serverUrl, message: result.message, busy: false });
      return;
    }
    setPhase({
      kind: "sign-in",
      serverUrl: result.serverUrl || defaultWebServerUrl(),
      error: result.message ?? null,
      busy: false,
    });
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  async function submit(form: SignInForm) {
    setPhase((current) => (current.kind === "sign-in" ? { ...current, busy: true, error: null } : current));
    const result = await signIn({ store }, form);
    if (!result.ok) {
      setPhase({ kind: "sign-in", serverUrl: form.serverUrl, error: result.message, busy: false });
      return;
    }
    setPhase({ kind: "account", account: result.account, session: result.session, busy: false });
  }

  async function leave(session: StoredSession | null) {
    setPhase((current) => (current.kind === "account" ? { ...current, busy: true } : current));
    await signOut({ store }, session);
    setPhase({ kind: "sign-in", serverUrl: session?.serverUrl ?? "", error: null, busy: false });
  }

  async function forget(serverUrl: string) {
    setPhase((current) => (current.kind === "offline" ? { ...current, busy: true } : current));
    const session = await store.load();
    await signOut({ store }, session);
    setPhase({ kind: "sign-in", serverUrl, error: null, busy: false });
  }

  if (phase.kind === "loading") return <LoadingScreen />;
  if (phase.kind === "account") {
    return (
      <InventoryApp
        account={phase.account}
        session={phase.session}
        busy={phase.busy}
        requestedPath={requestedPath}
        onSignOut={() => void leave(phase.session)}
        onAccountChange={(account) =>
          setPhase((current) => (current.kind === "account" ? { ...current, account: { ...current.account, ...account } } : current))
        }
      />
    );
  }
  if (phase.kind === "offline") {
    return (
      <OfflineScreen
        serverUrl={phase.serverUrl}
        message={phase.message}
        busy={phase.busy}
        onRetry={() => void boot()}
        onForget={() => void forget(phase.serverUrl)}
      />
    );
  }
  return <SignInScreen initialServerUrl={phase.serverUrl} error={phase.error} busy={phase.busy} onSubmit={(form) => void submit(form)} />;
}
