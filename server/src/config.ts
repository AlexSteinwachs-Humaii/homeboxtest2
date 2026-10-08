import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

import { StartupError } from "./errors.ts";

export const DEFAULT_SQLITE_PATH = "/data/homebox.db";
export const DEFAULT_PORT = 7745;
export const DEFAULT_HOST = "0.0.0.0";

export type ServerConfig = {
  driver: string;
  sqlitePath: string;
  host: string;
  port: number;
  staticDir: string;
  migrationsDir: string;
  demo: boolean;
  allowRegistration: boolean;
};

type Env = Record<string, string | undefined>;

// Strip the Go driver's query string (`?_pragma=journal_mode=WAL&_fk=1&...`).
// Those pragmas are applied in code after open; bun:sqlite does not understand them,
// and a `?` left in the path would create a file whose name includes the query.
export function sqliteFileFromSetting(raw: string | undefined): string {
  let value = (raw ?? "").trim();
  if (!value) return DEFAULT_SQLITE_PATH;
  const query = value.indexOf("?");
  if (query >= 0) value = value.slice(0, query);
  value = stripFileUri(value);
  if (!value) return DEFAULT_SQLITE_PATH;
  return value;
}

function stripFileUri(value: string): string {
  if (!value.toLowerCase().startsWith("file:")) return value;
  const rest = value.slice("file:".length);
  if (rest.startsWith("///")) return rest.slice(2);
  if (rest.startsWith("//")) {
    const withoutScheme = rest.slice(2);
    const slash = withoutScheme.indexOf("/");
    if (slash === -1) return withoutScheme;
    return withoutScheme.slice(slash);
  }
  return rest;
}

export function isPostgresTarget(driver: string, sqlitePath: string): boolean {
  const normalized = driver.trim().toLowerCase();
  if (normalized === "postgres" || normalized === "postgresql" || normalized === "pgx") return true;
  const path = sqlitePath.trim().toLowerCase();
  return path.startsWith("postgres://") || path.startsWith("postgresql://");
}

export function assertSqliteOnly(driver: string, sqlitePath: string): void {
  if (isPostgresTarget(driver, sqlitePath)) {
    throw new StartupError(
      `PostgreSQL is not supported (driver=${driver || "unset"}). This server opens an existing SQLite homebox.db only and does not migrate PostgreSQL installs.`,
    );
  }
  const normalized = driver.trim().toLowerCase();
  if (normalized && normalized !== "sqlite3" && normalized !== "sqlite") {
    throw new StartupError(`unsupported database driver: ${driver}`);
  }
}

export function loadConfig(env: Env, args: string[] = [], migrationsDir?: string, staticDir?: string): ServerConfig {
  const file = readConfigFile(args);
  const driver = env.HBOX_DATABASE_DRIVER ?? file.driver ?? "sqlite3";
  const sqliteSetting = env.HBOX_DATABASE_SQLITE_PATH ?? file.sqlitePath;
  const sqlitePath = sqliteFileFromSetting(sqliteSetting);
  assertSqliteOnly(driver, sqliteSetting ?? sqlitePath);

  const portRaw = env.HBOX_WEB_PORT ?? file.port ?? String(DEFAULT_PORT);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new StartupError(`invalid HBOX_WEB_PORT: ${portRaw}`);
  }

  return {
    driver: driver.trim().toLowerCase() === "sqlite" ? "sqlite3" : driver.trim().toLowerCase() || "sqlite3",
    sqlitePath,
    host: env.HBOX_WEB_HOST || file.host || DEFAULT_HOST,
    port,
    staticDir: staticDir ?? env.HBOX_STATIC_DIR ?? "frontend/.output/public",
    migrationsDir: migrationsDir ?? env.HBOX_MIGRATIONS_DIR ?? "",
    demo: parseBool(env.HBOX_DEMO, false),
    allowRegistration: parseBool(env.HBOX_OPTIONS_ALLOW_REGISTRATION, true),
  };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

type FileConfig = {
  driver?: string;
  sqlitePath?: string;
  host?: string;
  port?: string;
};

// The Go server takes an optional YAML file as its first argument (Docker CMD is
// `/data/config.yml`). A missing file is ignored so a fresh volume still starts.
function readConfigFile(args: string[]): FileConfig {
  const path = args.find((arg) => arg && !arg.startsWith("-"));
  if (!path) return {};
  if (!existsSync(path)) {
    console.log(`[homebox] config file ${path} not found; using defaults and environment`);
    return {};
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(path, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new StartupError(`failed to read config file ${path}: ${message}`);
  }
  if (parsed == null) return {};
  if (typeof parsed !== "object") {
    throw new StartupError(`config file ${path} must be a YAML mapping`);
  }
  const root = parsed as Record<string, unknown>;
  const database = asRecord(root.database);
  const web = asRecord(root.web);
  return {
    driver: asString(database?.driver),
    sqlitePath: asString(database?.sqlite_path),
    host: asString(web?.host),
    port: asString(web?.port),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}
