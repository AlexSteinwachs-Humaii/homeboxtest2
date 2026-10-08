import { Hono } from "hono";

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

export function statusBody(config: Pick<ServerConfig, "demo" | "allowRegistration">): StatusBody {
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
    oidc: { enabled: false, allowLocal: true },
    telemetry: { enabled: false },
  };
}

export function createApp(config: ServerConfig, env: Record<string, string | undefined> = process.env): Hono {
  const app = new Hono();

  app.get("/api/v1/status", (c) => c.json(statusBody(config)));

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
