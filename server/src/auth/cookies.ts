// Cookie names and flags from backend/app/api/handlers/v1/v1_ctrl_auth.go.

export const COOKIE_TOKEN = "hb.auth.token";
export const COOKIE_REMEMBER = "hb.auth.remember";
export const COOKIE_SESSION = "hb.auth.session";
export const COOKIE_ATTACHMENT = "hb.auth.attachment_token";

export const OIDC_STATE = "oidc_state";
export const OIDC_NONCE = "oidc_nonce";
export const OIDC_PKCE = "oidc_pkce_verifier";

export type AuthCookie = {
  name: string;
  value: string;
  expires: Date;
  httpOnly: boolean;
  secure: boolean;
  maxAge?: number;
};

export function noPort(host: string): string {
  return host.split(":")[0] ?? "";
}

export function formatSetCookie(cookie: AuthCookie, domain: string): string {
  const parts = [`${cookie.name}=${cookie.value}`, "Path=/"];
  if (domain) parts.push(`Domain=${domain}`);
  parts.push(`Expires=${cookie.expires.toUTCString()}`);
  if (cookie.maxAge !== undefined && cookie.maxAge < 0) parts.push("Max-Age=0");
  if (cookie.httpOnly) parts.push("HttpOnly");
  if (cookie.secure) parts.push("Secure");
  parts.push("SameSite=Lax");
  return parts.join("; ");
}

export function authSetCookies(
  domain: string,
  token: string,
  expires: Date,
  remember: boolean,
  attachmentToken: string,
  secure: boolean,
): string[] {
  const cookies: AuthCookie[] = [
    { name: COOKIE_REMEMBER, value: remember ? "true" : "false", expires, httpOnly: true, secure },
    { name: COOKIE_TOKEN, value: token, expires, httpOnly: true, secure },
    { name: COOKIE_SESSION, value: "true", expires, httpOnly: false, secure },
  ];
  if (attachmentToken) {
    cookies.push({ name: COOKIE_ATTACHMENT, value: attachmentToken, expires, httpOnly: false, secure });
  }
  return cookies.map((cookie) => formatSetCookie(cookie, domain));
}

export function authClearCookies(domain: string, secure: boolean): string[] {
  const expired = new Date(0);
  const cookies: AuthCookie[] = [
    { name: COOKIE_TOKEN, value: "", expires: expired, httpOnly: true, secure },
    { name: COOKIE_REMEMBER, value: "false", expires: expired, httpOnly: true, secure },
    { name: COOKIE_SESSION, value: "false", expires: expired, httpOnly: false, secure },
    { name: COOKIE_ATTACHMENT, value: "", expires: expired, httpOnly: false, secure },
  ];
  return cookies.map((cookie) => formatSetCookie(cookie, domain));
}

export function oidcSetCookies(domain: string, expires: Date, secure: boolean, values: Record<string, string>): string[] {
  return Object.entries(values).map(([name, value]) =>
    formatSetCookie({ name, value, expires, httpOnly: true, secure }, domain),
  );
}

export function oidcClearCookies(domain: string, secure: boolean): string[] {
  const expired = new Date(0);
  return [OIDC_STATE, OIDC_NONCE, OIDC_PKCE].map((name) =>
    formatSetCookie({ name, value: "", expires: expired, httpOnly: true, secure, maxAge: -1 }, domain),
  );
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

export function requestHost(request: Request): string {
  return request.headers.get("host") ?? new URL(request.url).host;
}

export function cookieDomain(request: Request): string {
  return noPort(requestHost(request));
}

export function withSetCookies(response: Response, cookies: string[]): Response {
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
