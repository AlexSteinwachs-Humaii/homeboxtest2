import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

import { StartupError } from "./errors.ts";

export const DEFAULT_SQLITE_PATH = "/data/homebox.db";
export const DEFAULT_PORT = 7745;
export const DEFAULT_HOST = "0.0.0.0";

export type OidcConfig = {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  allowedGroups: string;
  groupClaim: string;
  emailClaim: string;
  nameClaim: string;
  emailVerifiedClaim: string;
  buttonText: string;
  autoRedirect: boolean;
  verifyEmail: boolean;
  stateExpiryMs: number;
  requestTimeoutMs: number;
};

export type MailerConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
};

export type ServerConfig = {
  driver: string;
  sqlitePath: string;
  host: string;
  port: number;
  staticDir: string;
  migrationsDir: string;
  demo: boolean;
  allowRegistration: boolean;
  allowLocalLogin: boolean;
  hostname: string;
  trustProxy: boolean;
  cookieSecure: boolean;
  apiKeyPepper: string;
  passwordProtectionDisabled: boolean;
  oidc: OidcConfig;
  mailer: MailerConfig;
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
    demo: parseBool(env.HBOX_DEMO, file.demo ?? false),
    allowRegistration: parseBool(env.HBOX_OPTIONS_ALLOW_REGISTRATION, file.allowRegistration ?? true),
    allowLocalLogin: parseBool(env.HBOX_OPTIONS_ALLOW_LOCAL_LOGIN, file.allowLocalLogin ?? true),
    hostname: env.HBOX_OPTIONS_HOSTNAME ?? file.hostname ?? "",
    trustProxy: parseBool(env.HBOX_OPTIONS_TRUST_PROXY, file.trustProxy ?? false),
    cookieSecure: false,
    apiKeyPepper: env.HBOX_AUTH_API_KEY_PEPPER ?? file.apiKeyPepper ?? "",
    passwordProtectionDisabled: env.UNSAFE_DISABLE_PASSWORD_PROJECTION === "yes_i_am_sure",
    oidc: {
      enabled: parseBool(env.HBOX_OIDC_ENABLED, file.oidcEnabled ?? false),
      issuerUrl: env.HBOX_OIDC_ISSUER_URL ?? file.oidcIssuerUrl ?? "",
      clientId: env.HBOX_OIDC_CLIENT_ID ?? file.oidcClientId ?? "",
      clientSecret: env.HBOX_OIDC_CLIENT_SECRET ?? file.oidcClientSecret ?? "",
      scope: env.HBOX_OIDC_SCOPE ?? file.oidcScope ?? "openid profile email",
      allowedGroups: env.HBOX_OIDC_ALLOWED_GROUPS ?? file.oidcAllowedGroups ?? "",
      groupClaim: env.HBOX_OIDC_GROUP_CLAIM ?? "groups",
      emailClaim: env.HBOX_OIDC_EMAIL_CLAIM ?? "email",
      nameClaim: env.HBOX_OIDC_NAME_CLAIM ?? "name",
      emailVerifiedClaim: env.HBOX_OIDC_EMAIL_VERIFIED_CLAIM ?? "email_verified",
      buttonText: env.HBOX_OIDC_BUTTON_TEXT ?? "Sign in with OIDC",
      autoRedirect: parseBool(env.HBOX_OIDC_AUTO_REDIRECT, false),
      verifyEmail: parseBool(env.HBOX_OIDC_VERIFY_EMAIL, false),
      stateExpiryMs: parseDuration(env.HBOX_OIDC_STATE_EXPIRY, 10 * 60 * 1000),
      requestTimeoutMs: parseDuration(env.HBOX_OIDC_REQUEST_TIMEOUT, 30 * 1000),
    },
    mailer: {
      host: env.HBOX_MAILER_HOST ?? file.mailerHost ?? "",
      port: Number(env.HBOX_MAILER_PORT ?? file.mailerPort ?? 0) || 0,
      username: env.HBOX_MAILER_USERNAME ?? file.mailerUsername ?? "",
      password: env.HBOX_MAILER_PASSWORD ?? file.mailerPassword ?? "",
      from: env.HBOX_MAILER_FROM ?? file.mailerFrom ?? "",
    },
  };
}

export function parseDuration(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const match = /^(\d+)(ms|s|m|h)$/.exec(value.trim());
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "ms") return amount;
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60 * 1000;
  return amount * 60 * 60 * 1000;
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
  demo?: boolean;
  allowRegistration?: boolean;
  allowLocalLogin?: boolean;
  hostname?: string;
  trustProxy?: boolean;
  apiKeyPepper?: string;
  oidcEnabled?: boolean;
  oidcIssuerUrl?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcScope?: string;
  oidcAllowedGroups?: string;
  mailerHost?: string;
  mailerPort?: string;
  mailerUsername?: string;
  mailerPassword?: string;
  mailerFrom?: string;
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
  const options = asRecord(root.options);
  const auth = asRecord(root.auth);
  const oidc = asRecord(root.oidc);
  const mailer = asRecord(root.mailer);
  return {
    driver: asString(database?.driver),
    sqlitePath: asString(database?.sqlite_path),
    host: asString(web?.host),
    port: asString(web?.port),
    demo: asBool(root.demo),
    allowRegistration: asBool(options?.allow_registration ?? options?.disable_registration),
    allowLocalLogin: asBool(options?.allow_local_login),
    hostname: asString(options?.hostname),
    trustProxy: asBool(options?.trust_proxy),
    apiKeyPepper: asString(auth?.api_key_pepper),
    oidcEnabled: asBool(oidc?.enabled),
    oidcIssuerUrl: asString(oidc?.issuer_url),
    oidcClientId: asString(oidc?.client_id),
    oidcClientSecret: asString(oidc?.client_secret),
    oidcScope: asString(oidc?.scope),
    oidcAllowedGroups: asString(oidc?.allowed_groups),
    mailerHost: asString(mailer?.host),
    mailerPort: asString(mailer?.port),
    mailerUsername: asString(mailer?.username),
    mailerPassword: asString(mailer?.password),
    mailerFrom: asString(mailer?.from),
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

function asBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "n"].includes(normalized)) return false;
  }
  return undefined;
}
