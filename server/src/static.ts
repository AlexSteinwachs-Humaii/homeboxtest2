import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const HTML_HEAD = /<head(?:\s[^>]*)?>/i;

// Inject deployment context into the Expo web shell's <head>. The Nuxt app is
// not served.
export function injectLarineContext(html: string, env: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [name, id] of [
    ["__LARINE_ACTIVE_WORK_ITEM_ID__", env.LARINE_ACTIVE_WORK_ITEM_ID],
    ["__LARINE_STATEMENT_ID__", env.LARINE_STATEMENT_ID],
  ] as const) {
    if (!id || !id.trim()) continue;
    parts.push(`window.${name}=${jsString(id)};`);
  }
  if (parts.length === 0) return html;
  const match = HTML_HEAD.exec(html);
  if (!match || match.index === undefined) return html;
  const script = `<script>${parts.join("")}</script>`;
  const at = match.index + match[0].length;
  return html.slice(0, at) + script + html.slice(at);
}

function jsString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function resolveStaticFile(root: string, urlPath: string): string | null {
  let decoded = urlPath.split("?")[0] ?? "/";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, "");
  const full = resolve(root, relative);
  const base = resolve(root);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export type StaticResult =
  | { kind: "file"; body: Uint8Array; contentType: string; cacheControl?: string }
  | { kind: "missing" };

export function readStatic(root: string, urlPath: string, env: Record<string, string | undefined>): StaticResult {
  if (!root || !existsSync(root)) return { kind: "missing" };
  const requested = resolveStaticFile(root, urlPath);
  const file = requested && isFile(requested) ? requested : resolveStaticFile(root, "/index.html");
  if (!file || !isFile(file)) return { kind: "missing" };

  const extension = extname(file).toLowerCase();
  const isHtml = extension === ".html";
  if (isHtml) {
    const html = injectLarineContext(readFileSync(file, "utf8"), env);
    return {
      kind: "file",
      body: new TextEncoder().encode(html),
      contentType: "text/html; charset=utf-8",
      cacheControl: "no-store",
    };
  }
  return {
    kind: "file",
    body: new Uint8Array(readFileSync(file)),
    contentType: contentTypeFor(extension),
  };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function contentTypeFor(extension: string): string {
  switch (extension) {
    case ".js":
    case ".mjs":
      return "application/javascript";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".ico":
      return "image/x-icon";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".map":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

