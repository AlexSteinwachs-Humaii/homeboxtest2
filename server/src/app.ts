import type { Database } from "bun:sqlite";
import { Hono } from "hono";

import { mailerFromConfig } from "./auth/mailer.ts";
import { mountAuthRoutes, type AuthDeps } from "./auth/routes.ts";
import type { OidcRuntime } from "./auth/oidc.ts";
import type { MailSender } from "./auth/users.ts";
import type { ServerConfig } from "./config.ts";
import { readStatic } from "./static.ts";

export type StatusBody = {
  health: boolean;
  versions: string[];
  title: string;
  message: string;
  build: { version: string; commit: string; buildTime: string };
  latest: { date: string; version: string };
  demo: boolean;
  allowRegistration: boolean;
  labelPrinting: boolean;
  oidc: { enabled: boolean; allowLocal: boolean; buttonText?: string; autoRedirect?: boolean };
  telemetry: { enabled: boolean };
};

export function statusBody(
  config: Pick<ServerConfig, "demo" | "allowRegistration" | "allowLocalLogin" | "oidc">,
  oidcEnabled = false,
): StatusBody {
  return {
    health: true,
    versions: ["v1"],
    title: "Homebox",
    message: "Track, Manage, and Organize your Things",
    build: { version: "nightly", commit: "HEAD", buildTime: "now" },
    latest: { date: "", version: "" },
    demo: config.demo,
    allowRegistration: config.allowRegistration,
    labelPrinting: false,
    oidc: {
      enabled: oidcEnabled,
      allowLocal: config.allowLocalLogin,
      buttonText: config.oidc.buttonText,
      autoRedirect: config.oidc.autoRedirect,
    },
    telemetry: { enabled: false },
  };
}

export type CreateAppOptions = {
  db?: Database;
  oidc?: OidcRuntime | null;
  mailer?: MailSender | null;
  env?: Record<string, string | undefined>;
};

export function createApp(
  config: ServerConfig,
  env: Record<string, string | undefined> = process.env,
  options: CreateAppOptions = {},
): Hono {
  const app = new Hono();
  const oidc = options.oidc ?? null;

  app.get("/api/v1/status", (c) => c.json(statusBody(config, Boolean(oidc))));

  if (options.db) {
    const deps: AuthDeps = {
      db: options.db,
      config,
      oidc,
      mailer: options.mailer === undefined ? mailerFromConfig(config.mailer) : options.mailer,
      env: options.env ?? env,
    };
    mountAuthRoutes(app, deps);
  }

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  app.get("*", (c) => serveAsset(c.req.path, config, env));
  app.on("HEAD", "*", (c) => serveAsset(c.req.path, config, env));

  return app;
}

function serveAsset(urlPath: string, config: ServerConfig, env: Record<string, string | undefined>): Response {
  const asset = readStatic(config.staticDir, urlPath, env);
  if (asset.kind === "missing") {
    return new Response("frontend assets not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const headers: Record<string, string> = { "content-type": asset.contentType };
  if (asset.cacheControl) headers["cache-control"] = asset.cacheControl;
  return new Response(asset.body, { status: 200, headers });
}
