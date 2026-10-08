// Storage rules copied from the Go server, not a new schema.
//
// Ent field.UUID values are 16 bytes in google/uuid order (the same bytes
// uuid.UUID.String() formats). modernc.org/sqlite with `_time_format=sqlite`
// writes time.Time as text `2006-01-02 15:04:05.999999999-07:00` and bool as
// integer 0/1. Reads return those stored values. They are not parsed into Date
// or boolean, which would rewrite them on the way back out.

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuidText(value: string): boolean {
  return UUID_TEXT.test(value);
}

// google/uuid String() is lowercase. Canonical form is what the Go API returns.
export function canonicalUuid(value: string): string {
  const text = value.trim().toLowerCase();
  if (!isUuidText(text)) {
    throw new Error(`invalid uuid ${value}`);
  }
  return text;
}

export function uuidToBytes(value: string): Uint8Array {
  const text = canonicalUuid(value);
  const hex = text.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.byteLength !== 16) {
    throw new Error(`uuid blob length ${bytes.byteLength}, expected 16`);
  }
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newUuidBytes(): Uint8Array {
  return uuidToBytes(crypto.randomUUID());
}

export function asUuidBytes(value: unknown): Uint8Array {
  if (typeof value === "string") return uuidToBytes(value);
  if (value instanceof Uint8Array) {
    if (value.byteLength === 16) return new Uint8Array(value);
    if (value.byteLength === 36) return uuidToBytes(new TextDecoder().decode(value));
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return asUuidBytes(new Uint8Array(value));
  }
  throw new Error(`refusing to coerce uuid from ${value === null ? "null" : typeof value}`);
}

// Match modernc writeTimeFormats["sqlite"] (parseTimeFormats[0]), including
// Go's rule that trailing zeros in the fractional second are omitted.
export function formatSqliteDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error("invalid datetime");
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const minute = pad(date.getUTCMinutes());
  const second = pad(date.getUTCSeconds());
  const nanos = date.getUTCMilliseconds() * 1_000_000;
  let fraction = "";
  if (nanos !== 0) {
    fraction = `.${String(nanos).padStart(9, "0").replace(/0+$/, "")}`;
  }
  return `${year}-${month}-${day} ${hour}:${minute}:${second}${fraction}+00:00`;
}

export function sqliteNow(): string {
  return formatSqliteDateTime(new Date());
}

// modernc writes `2006-01-02 15:04:05.999999999-07:00`. Existing rows may omit
// the fraction or use `Z`. Parsed only to compare instants; the stored text is
// not rewritten.
export function parseSqliteDateTime(value: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error(`unrecognized sqlite datetime ${value}`);
  }
  const fraction = match[3] ? match[3].slice(1, 4).padEnd(3, "0") : "000";
  let offset = match[4];
  if (offset === "Z") offset = "+00:00";
  else if (/^[+-]\d{4}$/.test(offset)) offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const parsed = new Date(`${match[1]}T${match[2]}.${fraction}${offset}`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`unrecognized sqlite datetime ${value}`);
  return parsed;
}
