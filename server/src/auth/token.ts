import { createHash, createHmac } from "node:crypto";

import { StartupError } from "../errors.ts";

// Session tokens and API keys, matching backend/pkgs/hasher/token.go.
// Pepper rotation is not implemented: a new pepper simply stops matching
// previously stored HMAC hashes.

export const API_KEY_PREFIX = "hb_";
export const API_KEY_PEPPER_MIN_BYTES = 32;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

let pepper: Buffer | null = null;

export function assertApiKeyPepper(value: string): void {
  if (Buffer.byteLength(value) < API_KEY_PEPPER_MIN_BYTES) {
    throw new StartupError(
      "auth.api_key_pepper must be set to at least 32 bytes; generate with `openssl rand -base64 48` " +
        "and provide via HBOX_AUTH_API_KEY_PEPPER. Rotating it invalidates all issued API keys",
    );
  }
}

export function setApiKeyPepper(value: string | Uint8Array): void {
  const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  if (bytes.byteLength < API_KEY_PEPPER_MIN_BYTES) {
    assertApiKeyPepper(bytes.toString("utf8"));
  }
  pepper = Buffer.from(bytes);
}

export function apiKeyPepperConfigured(): boolean {
  return pepper !== null && pepper.byteLength > 0;
}

export function hashToken(plain: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(plain).digest());
}

export function hashApiKey(plain: string): Uint8Array {
  if (!pepper || pepper.byteLength === 0) {
    throw new Error("hasher: API key pepper not configured (call SetAPIKeyPepper at startup)");
  }
  return new Uint8Array(createHmac("sha256", pepper).update(plain).digest());
}

export function generateToken(): { raw: string; hash: Uint8Array } {
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  const raw = base32Encode(randomBytes);
  return { raw, hash: hashToken(raw) };
}

export function generateApiKey(): { raw: string; hash: Uint8Array } {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = API_KEY_PREFIX + Buffer.from(randomBytes).toString("base64url");
  return { raw, hash: hashApiKey(raw) };
}

export function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function pkceChallenge(verifier: string): string {
  return Buffer.from(createHash("sha256").update(verifier).digest()).toString("base64url");
}

export function randomUrlToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}
