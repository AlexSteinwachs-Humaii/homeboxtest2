import type { Server } from "bun";
import type { Database } from "bun:sqlite";
import { resolve } from "node:path";

import { setApiKeyPepper, assertApiKeyPepper } from "./auth/token.ts";
import { initOidc, type OidcRuntime } from "./auth/oidc.ts";
import { createApp } from "./app.ts";
import { loadConfig, type ServerConfig } from "./config.ts";
import { applyConnectionPragmas, openDatabase, type ConnectionPragmas } from "./db.ts";
import { readGooseRows, resolveMigrationsDir, runMigrations, type GooseRow } from "./migrate.ts";
import { attachDatabase, type UuidObservation } from "./uuid-check.ts";

export type PreparedDatabase = {
  config: ServerConfig;
  db: Database;
  pragmas: ConnectionPragmas;
  applied: number[];
  gooseRows: GooseRow[];
  observations: UuidObservation[];
};

export function prepareDatabase(
  env: Record<string, string | undefined>,
  args: string[] = [],
): PreparedDatabase {
  const migrationsDir = resolveMigrationsDir(env.HBOX_MIGRATIONS_DIR);
  const config = loadConfig(env, args, migrationsDir, env.HBOX_STATIC_DIR ? resolve(env.HBOX_STATIC_DIR) : undefined);
  if (!env.HBOX_STATIC_DIR) {
    config.staticDir = resolve(config.staticDir);
  }
  console.log(`[homebox] opening sqlite ${config.sqlitePath}`);
  const db = openDatabase(config.sqlitePath);
  try {
    const applied = runMigrations(db, config.migrationsDir);
    // Migrations may toggle foreign_keys. Re-apply the connection pragmas in code.
    const pragmas = applyConnectionPragmas(db);
    console.log(
      `[homebox] pragmas journal_mode=${pragmas.journalMode} foreign_keys=${pragmas.foreignKeys} busy_timeout=${pragmas.busyTimeout}`,
    );
    const { observations } = attachDatabase(db);
    return { config, db, pragmas, applied, gooseRows: readGooseRows(db), observations };
  } catch (err) {
    db.close();
    throw err;
  }
}

export type RunningServer = PreparedDatabase & {
  server: Server<undefined>;
  stop: () => void;
};

export async function startServer(
  env: Record<string, string | undefined>,
  args: string[] = [],
): Promise<RunningServer> {
  const migrationsDir = resolveMigrationsDir(env.HBOX_MIGRATIONS_DIR);
  const preview = loadConfig(env, args, migrationsDir, env.HBOX_STATIC_DIR ? resolve(env.HBOX_STATIC_DIR) : undefined);
  assertApiKeyPepper(preview.apiKeyPepper);
  setApiKeyPepper(preview.apiKeyPepper);
  let oidc: OidcRuntime | null = null;
  if (preview.oidc.enabled) {
    oidc = await initOidc(preview);
  }
  const prepared = prepareDatabase(env, args);
  const app = createApp(prepared.config, env, { db: prepared.db, oidc });
  const server = Bun.serve({
    hostname: prepared.config.host,
    port: prepared.config.port,
    fetch: app.fetch,
  });
  console.log(`[homebox] listening on ${prepared.config.host}:${server.port}`);
  return {
    ...prepared,
    server,
    stop: () => {
      server.stop(true);
      prepared.db.close();
    },
  };
}
