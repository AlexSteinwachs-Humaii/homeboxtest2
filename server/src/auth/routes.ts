import type { Context } from "hono";
import type { Database } from "bun:sqlite";

import type { ServerConfig } from "../config.ts";
import { authClearCookies, authSetCookies, cookieDomain, withSetCookies } from "./cookies.ts";
import { resolveAuth } from "./guard.ts";
import { finishOidcCallback, startOidcLogin, type OidcRuntime } from "./oidc.ts";
import {
  AuthError,
  deleteAllSessions,
  deleteSessionToken,
  login,
  PASSWORD_MIN_LENGTH,
  registerUser,
  renewSession,
  requestPasswordReset,
  resetPassword,
  type MailSender,
} from "./users.ts";

export type AuthDeps = {
  db: Database;
  config: ServerConfig;
  oidc?: OidcRuntime | null;
  mailer?: MailSender | null;
  env?: Record<string, string | undefined>;
};

export function mountAuthRoutes(app: { post: Function; get: Function }, deps: AuthDeps): void {
  app.post("/api/v1/users/register", (c: Context) => handleRegister(c, deps));
  app.post("/api/v1/users/login", (c: Context) => handleLogin(c, deps));
  app.post("/api/v1/users/forgot-password", (c: Context) => handleForgot(c, deps));
  app.post("/api/v1/users/reset-password", (c: Context) => handleReset(c, deps));
  app.post("/api/v1/users/logout", (c: Context) => handleLogout(c, deps));
  app.post("/api/v1/users/logout/all", (c: Context) => handleLogoutAll(c, deps));
  app.get("/api/v1/users/refresh", (c: Context) => handleRefresh(c, deps));
  if (deps.oidc) {
    app.get("/api/v1/users/login/oidc", (c: Context) => startOidcLogin(c.req.raw, deps.config, deps.oidc!));
    app.get("/api/v1/users/login/oidc/callback", (c: Context) => handleOidcCallback(c, deps));
  }
}

async function handleLogin(c: Context, deps: AuthDeps): Promise<Response> {
  const provider = new URL(c.req.url).searchParams.get("provider") || "local";
  if (provider === "local" && !deps.config.allowLocalLogin) {
    return errorJson(403, "local login is not enabled");
  }
  if (provider !== "local") return errorJson(400, "invalid auth provider");
  let form: { username: string; password: string; stayLoggedIn: boolean };
  try {
    form = await readLoginForm(c.req.raw);
  } catch {
    return errorJson(401, "unauthorized");
  }
  try {
    const session = await login(deps.db, form.username, form.password, form.stayLoggedIn, deps.env);
    const body = {
      token: `Bearer ${session.raw}`,
      expiresAt: session.expiresAt.toISOString(),
      attachmentToken: session.attachmentToken,
    };
    return withSetCookies(
      Response.json(body),
      authSetCookies(cookieDomain(c.req.raw), session.raw, session.expiresAt, true, session.attachmentToken, deps.config.cookieSecure),
    );
  } catch (err) {
    if (err instanceof AuthError) return errorJson(err.status, err.status === 401 ? "unauthorized" : err.message);
    console.warn(`[homebox] authentication failed: ${err instanceof Error ? err.message : err}`);
    return errorJson(401, "unauthorized");
  }
}

async function handleRegister(c: Context, deps: AuthDeps): Promise<Response> {
  if (!deps.config.allowLocalLogin) return errorJson(403, "local login is not enabled");
  let body: { name?: string; email?: string; password?: string; token?: string };
  try {
    body = await c.req.json();
  } catch (err) {
    console.warn(`[homebox] failed to decode user registration data: ${err instanceof Error ? err.message : err}`);
    return errorJson(500, "failed to decode user registration data");
  }
  if (!deps.config.allowRegistration && !body.token) return errorJson(403, "user registration disabled");
  try {
    await registerUser(
      deps.db,
      {
        name: body.name ?? "",
        email: body.email ?? "",
        password: body.password ?? "",
        groupToken: body.token,
      },
      deps.env,
    );
    return new Response(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to register user";
    const status = err instanceof AuthError ? err.status : 500;
    return errorJson(status, message);
  }
}

async function handleForgot(c: Context, deps: AuthDeps): Promise<Response> {
  if (deps.config.demo) return errorJson(403, "Forbidden");
  if (!deps.config.allowLocalLogin) return errorJson(403, "local login is not enabled");
  let body: { email?: string };
  try {
    body = await c.req.json();
  } catch {
    return errorJson(400, "invalid request body");
  }
  const email = (body.email ?? "").trim();
  if (!email) return errorJson(400, "email is required");
  const mailer = deps.mailer;
  if (!mailer?.ready) {
    console.warn("[homebox] forgot-password requested but SMTP mailer is not configured; no email will be sent");
    return new Response(null, { status: 204 });
  }
  const baseURL = secureBaseURL(c.req.raw, deps.config);
  if (!baseURL) {
    console.warn("[homebox] forgot-password requested but no safe base URL is available; set HBOX_OPTIONS_HOSTNAME to enable");
    return new Response(null, { status: 204 });
  }
  try {
    await requestPasswordReset(deps.db, email, baseURL, mailer);
  } catch (err) {
    console.warn(`[homebox] password reset request failed: ${err instanceof Error ? err.message : err}`);
    return errorJson(500, "internal error");
  }
  return new Response(null, { status: 204 });
}

async function handleReset(c: Context, deps: AuthDeps): Promise<Response> {
  if (deps.config.demo) return errorJson(403, "Forbidden");
  if (!deps.config.allowLocalLogin) return errorJson(403, "local login is not enabled");
  let body: { token?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return errorJson(400, "invalid request body");
  }
  const password = body.password ?? "";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return errorJson(400, `password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  try {
    await resetPassword(deps.db, body.token ?? "", password, deps.env);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof AuthError) return errorJson(err.status, err.message);
    console.warn(`[homebox] password reset failed: ${err instanceof Error ? err.message : err}`);
    return errorJson(500, "internal error");
  }
}

async function handleLogout(c: Context, deps: AuthDeps): Promise<Response> {
  const auth = resolveAuth(c.req.raw, deps.db);
  if (!auth) return errorJson(401, "no token within request context");
  if (auth.isApiKey) {
    return errorJson(400, "API keys cannot be logged out; revoke them from the API keys page");
  }
  if (!auth.roles.includes("user")) return errorJson(403, "Forbidden");
  deleteSessionToken(deps.db, auth.raw);
  return withSetCookies(new Response(null, { status: 204 }), authClearCookies(cookieDomain(c.req.raw), deps.config.cookieSecure));
}

async function handleLogoutAll(c: Context, deps: AuthDeps): Promise<Response> {
  const auth = resolveAuth(c.req.raw, deps.db);
  if (!auth) return errorJson(401, "authorization header or query is required");
  if (!auth.isApiKey && !auth.roles.includes("user")) return errorJson(403, "Forbidden");
  deleteAllSessions(deps.db, auth.userId);
  return withSetCookies(new Response(null, { status: 204 }), authClearCookies(cookieDomain(c.req.raw), deps.config.cookieSecure));
}

async function handleRefresh(c: Context, deps: AuthDeps): Promise<Response> {
  const auth = resolveAuth(c.req.raw, deps.db);
  if (!auth) return errorJson(401, "no token within request context");
  if (auth.isApiKey) return errorJson(400, "API keys do not require refresh");
  try {
    const session = renewSession(deps.db, auth.raw);
    return withSetCookies(
      Response.json({
        raw: session.raw,
        attachmentToken: session.attachmentToken,
        expiresAt: session.expiresAt.toISOString(),
      }),
      authSetCookies(cookieDomain(c.req.raw), session.raw, session.expiresAt, false, session.attachmentToken, deps.config.cookieSecure),
    );
  } catch (err) {
    if (err instanceof AuthError) return errorJson(err.status, err.status === 401 ? "unauthorized" : err.message);
    return errorJson(401, "unauthorized");
  }
}

async function handleOidcCallback(c: Context, deps: AuthDeps): Promise<Response> {
  if (!deps.oidc) return errorJson(403, "OIDC is not enabled");
  const result = await finishOidcCallback(deps.db, c.req.raw, deps.config, deps.oidc);
  if ("error" in result) {
    const headers = new Headers();
    for (const cookie of result.clear) headers.append("set-cookie", cookie);
    headers.set("location", absoluteLocation(c.req.raw, "/?oidc_error=oidc_auth_failed"));
    return new Response(null, { status: 302, headers });
  }
  const headers = new Headers();
  for (const cookie of result.clear) headers.append("set-cookie", cookie);
  for (const cookie of authSetCookies(
    cookieDomain(c.req.raw),
    result.session.raw,
    result.session.expiresAt,
    true,
    result.session.attachmentToken,
    deps.config.cookieSecure,
  )) {
    headers.append("set-cookie", cookie);
  }
  headers.set("location", absoluteLocation(c.req.raw, "/home"));
  return new Response(null, { status: 302, headers });
}

async function readLoginForm(request: Request): Promise<{ username: string; password: string; stayLoggedIn: boolean }> {
  const type = request.headers.get("content-type") ?? "";
  let username = "";
  let password = "";
  let stayLoggedIn = false;
  if (type === "application/x-www-form-urlencoded" || type.startsWith("application/x-www-form-urlencoded;")) {
    const params = new URLSearchParams(await request.text());
    username = params.get("username") ?? "";
    password = params.get("password") ?? "";
    stayLoggedIn = params.get("stayLoggedIn") === "true";
  } else if (type === "application/json" || type.startsWith("application/json;")) {
    const body = (await request.json()) as { username?: string; password?: string; stayLoggedIn?: boolean };
    username = body.username ?? "";
    password = body.password ?? "";
    stayLoggedIn = body.stayLoggedIn === true;
  } else {
    throw new Error("invalid content type");
  }
  if (!username || !password) throw new Error("username or password is empty");
  return { username, password, stayLoggedIn };
}

export function secureBaseURL(request: Request, config: ServerConfig): string {
  if (config.hostname) return ensureScheme(config.hostname, request, config.trustProxy);
  if (!config.trustProxy) return "";
  const host = firstHeaderValue(request.headers.get("x-forwarded-host"));
  if (!host || /[\s/?#\\]/.test(host) || host.includes("://")) return "";
  try {
    const parsed = new URL(`http://${host}`);
    if (parsed.host !== host) return "";
  } catch {
    return "";
  }
  const scheme = config.trustProxy && firstHeaderValue(request.headers.get("x-forwarded-proto")) === "https" ? "https" : "http";
  return `${scheme}://${host}`;
}

function ensureScheme(hostname: string, request: Request, trustProxy: boolean): string {
  if (hostname.startsWith("http://") || hostname.startsWith("https://")) return hostname.replace(/\/$/, "");
  const scheme = trustProxy && firstHeaderValue(request.headers.get("x-forwarded-proto")) === "https" ? "https" : "http";
  return `${scheme}://${hostname}`;
}

function firstHeaderValue(value: string | null): string {
  if (!value) return "";
  return value.split(",")[0]?.trim() ?? "";
}

function absoluteLocation(request: Request, path: string): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}${path}`;
}

function errorJson(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
