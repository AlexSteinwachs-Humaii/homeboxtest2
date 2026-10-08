// Stored (uncompressed) ZIP, matching the collection export layout: one entry
// per table JSON, manifest.json, and attachments/{id}. No extra dependency.

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array };

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function zipStore(entries: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.byteLength),
      u32(entry.data.byteLength),
      u16(name.byteLength),
      u16(0),
      name,
      entry.data,
    ]);
    locals.push(local);
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(entry.data.byteLength),
        u32(entry.data.byteLength),
        u16(name.byteLength),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.byteLength;
  }
  const central = concat(centrals);
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.byteLength),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, central, eocd]);
}

function readU16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readU32(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

export function unzip(data: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  let offset = 0;
  const decoder = new TextDecoder();
  while (offset + 30 <= data.byteLength) {
    const sig = readU32(data, offset);
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    if (sig !== 0x04034b50) break;
    const method = readU16(data, offset + 8);
    const compressed = readU32(data, offset + 18);
    const nameLen = readU16(data, offset + 26);
    const extraLen = readU16(data, offset + 28);
    const name = decoder.decode(data.subarray(offset + 30, offset + 30 + nameLen));
    const start = offset + 30 + nameLen + extraLen;
    const bytes = data.subarray(start, start + compressed);
    if (method !== 0) throw new Error(`zip entry ${name} is compressed; collection exports are stored uncompressed`);
    out.set(name, bytes);
    offset = start + compressed;
  }
  return out;
}
