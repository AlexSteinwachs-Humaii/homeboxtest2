import { bytesToUuid, canonicalUuid, isUuidText, uuidToBytes } from "../db/storage.ts";

export function idPair(id: string): [Uint8Array, string] {
  const text = canonicalUuid(id);
  return [uuidToBytes(text), text];
}

export function readUuid(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" && isUuidText(value)) return canonicalUuid(value);
  if (value instanceof Uint8Array) {
    if (value.byteLength === 16) return bytesToUuid(value);
    const text = new TextDecoder().decode(value);
    if (isUuidText(text)) return canonicalUuid(text);
  }
  return null;
}

export function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return new Uint8Array(value);
  throw new Error("expected blob");
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_TEXT.test(value);
}
