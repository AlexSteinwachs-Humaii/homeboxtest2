// Enough of net/http.DetectContentType for the types the attachment handler
// branches on. Unknown bytes stay application/octet-stream, which is what the
// Go thumbnail path then classifies by filename suffix.

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF = [0x47, 0x49, 0x46, 0x38];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.byteLength < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

export function sniffContentType(bytes: Uint8Array): string {
  const head = bytes.subarray(0, Math.min(512, bytes.byteLength));
  if (head.byteLength >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (startsWith(head, PNG)) return "image/png";
  if (startsWith(head, GIF)) return "image/gif";
  if (
    head.byteLength >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return "image/webp";
  }
  if (startsWith(head, PDF)) return "application/pdf";
  return "application/octet-stream";
}

// Same suffix rescue as CreateThumbnail when DetectContentType returns octet-stream.
export function contentTypeForThumbnail(sniffed: string, title: string): string {
  if (sniffed !== "application/octet-stream") return sniffed;
  if (title.endsWith(".heic") || title.endsWith(".heif")) return "image/heic";
  if (title.endsWith(".avif")) return "image/avif";
  if (title.endsWith(".jxl")) return "image/jxl";
  return sniffed;
}

export function isThumbnailable(contentType: string): boolean {
  return (
    contentType.includes("image/jpeg") ||
    contentType.includes("image/png") ||
    contentType.includes("image/gif") ||
    contentType === "image/webp" ||
    contentType === "image/avif" ||
    contentType === "image/heic" ||
    contentType === "image/heif" ||
    contentType === "image/jxl"
  );
}

const INLINE = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/avif",
  "image/ico",
  "image/x-icon",
  "application/pdf",
]);

const DANGEROUS = [
  "text/html",
  "text/xml",
  "application/xhtml",
  "application/xml",
  "application/javascript",
  "text/javascript",
  "image/svg+xml",
  "image/svg",
];

export function isSafeInlineType(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  if (INLINE.has(lower)) return true;
  // Go returns false for every other type, including after the dangerous-type scan.
  void DANGEROUS;
  return false;
}

export function photoTypeFromName(name: string): boolean {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".avif", ".ico", ".heic", ".jxl"].includes(ext);
}

export function sanitizeAttachmentName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  return base.replaceAll("..", "").replaceAll("/", "").replaceAll("\\", "");
}

export const MIME_LINK_URL = "link/url";

export function parseExternalHttpUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.host || parsed.username || parsed.password) return null;
  return parsed;
}
