import { isAbsolute, relative, resolve } from "node:path";

import { StartupError } from "../errors.ts";

// gocloud fileblob escape for a backslash (0x5c). Pre-v0.22.1 Windows keys
// built with filepath.Join were stored as one flat name at the bucket root.
export const LEGACY_FLAT_PATH_TOKEN = "__0x5c__";

export const DEFAULT_STORAGE_CONN_STRING = "file:///./";
export const DEFAULT_STORAGE_PREFIX_PATH = ".data";

export type StorageLayout = {
  connString: string;
  prefixPath: string;
  bucket: string;
};

// Forward slashes, no leading or trailing slash. Matches normalizePath in
// repo_item_attachments.go. A prefix of "/" or "" stores keys with no prefix.
export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

export function relativeAttachmentPath(groupId: string, hash: string): string {
  return `${groupId}/documents/${hash}`;
}

export function fullAttachmentKey(prefixPath: string, relativePath: string): string {
  const relative = normalizePath(relativePath);
  if (relative.split("/").some((part) => part === "..")) {
    throw new Error("invalid attachment path");
  }
  const prefix = normalizePath(prefixPath);
  if (prefix.split("/").some((part) => part === "..")) {
    throw new Error("invalid attachment prefix");
  }
  if (!prefix) return relative;
  if (!relative) return prefix;
  return `${prefix}/${relative}`;
}

export function legacyFlatKey(key: string): string {
  return key.replaceAll("/", LEGACY_FLAT_PATH_TOKEN);
}

// file:///./ is relative to the process cwd, as GetConnString treats it.
// file:///?no_tmp_dir=true (the Docker default) is the filesystem root.
// Anything other than file:// is refused: this port does not open S3, GCS, or Azure.
export function resolveFileBucket(connString: string): string {
  const trimmed = connString.trim();
  if (!trimmed.toLowerCase().startsWith("file://")) {
    throw new StartupError(
      `attachment storage must be a file:// URL; S3, GCS, and Azure are not supported (got ${trimmed || "empty"})`,
    );
  }
  if (trimmed.startsWith("file:///./") || trimmed === "file:///.") {
    const rest = trimmed.slice("file:///./".length);
    const pathPart = rest.split(/[?#]/)[0] ?? "";
    return resolve(pathPart || ".");
  }
  let raw = trimmed.slice("file://".length);
  const cut = raw.search(/[?#]/);
  if (cut >= 0) raw = raw.slice(0, cut);
  if (!raw.startsWith("/")) {
    throw new StartupError(`attachment storage file URL must be absolute or file:///./ (got ${trimmed})`);
  }
  return resolve(raw);
}

export function storageLayout(connString: string, prefixPath: string): StorageLayout {
  return {
    connString,
    prefixPath,
    bucket: resolveFileBucket(connString),
  };
}

// On-disk path for a blob key. Rejects `..` so a stored path cannot leave the bucket.
export function diskPathForKey(bucket: string, key: string): string {
  const cleaned = key.replaceAll("\\", "/");
  if (!cleaned || cleaned.split("/").some((part) => part === "..")) {
    throw new Error("invalid attachment path");
  }
  const root = resolve(bucket);
  const full = resolve(root, ...cleaned.split("/").filter((part) => part.length > 0));
  const rel = relative(root, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("invalid attachment path");
  }
  return full;
}
