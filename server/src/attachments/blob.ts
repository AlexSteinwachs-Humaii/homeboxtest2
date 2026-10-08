import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { blake3 } from "@noble/hashes/blake3.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

import {
  diskPathForKey,
  fullAttachmentKey,
  legacyFlatKey,
  relativeAttachmentPath,
  resolveFileBucket,
  storageLayout,
  type StorageLayout,
} from "./paths.ts";

export type { StorageLayout };
export { storageLayout, resolveFileBucket, fullAttachmentKey, relativeAttachmentPath, legacyFlatKey };

// zeebo/blake3 DeriveKey(groupID, content, 32). @noble/hashes `context` matches
// that mode (verified against a Go vector in attachments.test.ts).
export function attachmentContentHash(groupId: string, content: Uint8Array): string {
  const digest = blake3(content, { context: utf8ToBytes(groupId) });
  return Buffer.from(digest).toString("hex");
}

export function attachmentRelativePath(groupId: string, content: Uint8Array): string {
  return relativeAttachmentPath(groupId, attachmentContentHash(groupId, content));
}

function candidateDiskPaths(layout: StorageLayout, relativePath: string): string[] {
  const key = fullAttachmentKey(layout.prefixPath, relativePath);
  const nested = diskPathForKey(layout.bucket, key);
  const flat = diskPathForKey(layout.bucket, legacyFlatKey(key));
  return nested === flat ? [nested] : [nested, flat];
}

export function readAttachmentBytes(layout: StorageLayout, relativePath: string): Uint8Array | null {
  for (const path of candidateDiskPaths(layout, relativePath)) {
    try {
      return new Uint8Array(readFileSync(path));
    } catch (err) {
      if (isNotFound(err)) continue;
      throw err;
    }
  }
  return null;
}

export function writeAttachmentBytes(layout: StorageLayout, relativePath: string, content: Uint8Array): string {
  const key = fullAttachmentKey(layout.prefixPath, relativePath);
  const path = diskPathForKey(layout.bucket, key);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${crypto.randomUUID()}`;
  writeFileSync(temp, content);
  renameSync(temp, path);
  return relativePath;
}

export function deleteAttachmentBytes(layout: StorageLayout, relativePath: string): void {
  for (const path of candidateDiskPaths(layout, relativePath)) {
    rmSync(path, { force: true });
  }
}

// Renames pre-v0.22.1 Windows flat keys into the subdirectory layout. Safe to
// run on every start: only names containing __0x5c__ at the bucket root move,
// and an existing target is left alone. Go gates this on Windows; we also run
// it elsewhere so a copied data directory still opens.
export function migrateLegacyFlatPaths(connString: string): { moved: number; skipped: number } {
  const root = resolveFileBucket(connString);
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if (isNotFound(err)) return { moved: 0, skipped: 0 };
    throw err;
  }
  let moved = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (entry.isDirectory() || !entry.name.includes("__0x5c__")) continue;
    const decoded = entry.name.replaceAll("__0x5c__", "/");
    const source = join(root, entry.name);
    let target: string;
    try {
      target = diskPathForKey(root, decoded);
    } catch {
      skipped++;
      continue;
    }
    try {
      statSync(target);
      skipped++;
      continue;
    } catch (err) {
      if (!isNotFound(err)) {
        skipped++;
        continue;
      }
    }
    mkdirSync(dirname(target), { recursive: true });
    try {
      renameSync(source, target);
      moved++;
    } catch {
      skipped++;
    }
  }
  return { moved, skipped };
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "ENOENT";
}
