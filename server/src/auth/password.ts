import { timingSafeEqual } from "node:crypto";
import { argon2id } from "hash-wasm";

// Matches backend/pkgs/hasher/password.go: argon2id v=19, m=65536, t=3, p=2,
// 16-byte salt, 32-byte key, PHC encoding with raw standard base64.
const MEMORY_KIB = 64 * 1024;
const ITERATIONS = 3;
const PARALLELISM = 2;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

// Compiled into the Go hasher. Plaintext is unknown; it only equalizes timing.
export const STATIC_DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=2$sD6MJ4qEDD8pJGFFb8Ew7A$v0FY6vLHFJyJUm2cAa8qEYLd1x5WlCQ01B24AJ/Tcxs";

// Vector produced by golang.org/x/crypto/argon2.IDKey with the HomeBox params
// and salt "0123456789abcdef". Used to prove the Bun KDF matches the Go one.
export const GO_ARGON2_VECTOR = {
  password: "password123456788",
  hash: "$argon2id$v=19$m=65536,t=3,p=2$MDEyMzQ1Njc4OWFiY2RlZg$KSE5/Tlo9RDe3TwHPXa2txlPntBZsO6FGrMzGtRdcuc",
};

// bcrypt hash of "legacy-secret" from golang.org/x/crypto/bcrypt (cost 10).
export const GO_BCRYPT_VECTOR = {
  password: "legacy-secret",
  hash: "$2a$10$x3XuqDcCu6lWnOp8xl4Ef.NN1tlMMRT73s5c0SJekP4WzRw30kQxe",
};

let warnedDisabled = false;

export function passwordProtectionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.UNSAFE_DISABLE_PASSWORD_PROJECTION !== "yes_i_am_sure";
}

function warnIfDisabled(env: Record<string, string | undefined>): void {
  if (passwordProtectionEnabled(env) || warnedDisabled) return;
  warnedDisabled = true;
  console.warn(
    "[homebox] WARNING: Password protection is disabled (UNSAFE_DISABLE_PASSWORD_PROJECTION). Do not use this in production.",
  );
}

export async function hashPassword(
  password: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  warnIfDisabled(env);
  if (!passwordProtectionEnabled(env)) return password;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  return argon2id({
    password,
    salt,
    parallelism: PARALLELISM,
    iterations: ITERATIONS,
    memorySize: MEMORY_KIB,
    hashLength: KEY_LENGTH,
    outputType: "encoded",
  });
}

export type PasswordCheck = { match: boolean; needsRehash: boolean };

export async function checkPasswordHash(
  password: string,
  hash: string,
  env: Record<string, string | undefined> = process.env,
): Promise<PasswordCheck> {
  warnIfDisabled(env);
  if (!passwordProtectionEnabled(env)) {
    return { match: password === hash, needsRehash: false };
  }

  const argon2 = await compareArgon2(password, hash);
  if (argon2 === true) return { match: true, needsRehash: false };

  const bcryptMatch = await compareBcrypt(password, hash);
  if (bcryptMatch) return { match: true, needsRehash: true };
  return { match: false, needsRehash: false };
}

export async function checkDummyPasswordHash(env: Record<string, string | undefined> = process.env): Promise<void> {
  if (!passwordProtectionEnabled(env)) return;
  await checkPasswordHash("not-a-real-password", STATIC_DUMMY_HASH, env);
}

async function compareArgon2(password: string, encoded: string): Promise<boolean | null> {
  let decoded: { memory: number; iterations: number; parallelism: number; salt: Uint8Array; hash: Uint8Array };
  try {
    decoded = decodeHash(encoded);
  } catch {
    return null;
  }
  const derived = await argon2id({
    password,
    salt: decoded.salt,
    parallelism: decoded.parallelism,
    iterations: decoded.iterations,
    memorySize: decoded.memory,
    hashLength: decoded.hash.byteLength,
    outputType: "binary",
  });
  if (derived.byteLength !== decoded.hash.byteLength) return false;
  return timingSafeEqual(derived, decoded.hash);
}

async function compareBcrypt(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

function decodeHash(encoded: string): {
  memory: number;
  iterations: number;
  parallelism: number;
  salt: Uint8Array;
  hash: Uint8Array;
} {
  const parts = encoded.split("$");
  if (parts.length !== 6) {
    throw new Error(`invalid hash format: expected 6 segments, got ${parts.length}`);
  }
  const version = /^v=(\d+)$/.exec(parts[2]);
  if (!version) throw new Error(`invalid version segment ${parts[2]}`);
  if (Number(version[1]) !== 19) throw new Error(`unsupported argon2 version: got ${version[1]}, want 19`);
  const params = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[3]);
  if (!params) throw new Error(`invalid params segment ${parts[3]}`);
  return {
    memory: Number(params[1]),
    iterations: Number(params[2]),
    parallelism: Number(params[3]),
    salt: decodeRawStd(parts[4], "salt"),
    hash: decodeRawStd(parts[5], "key"),
  };
}

function decodeRawStd(value: string, label: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+$/.test(value)) throw new Error(`invalid ${label}`);
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const buf = Buffer.from(value + pad, "base64");
  if (buf.length === 0) throw new Error(`invalid ${label}`);
  return new Uint8Array(buf);
}
