import sharp from "sharp";
import QRCode from "qrcode";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function labelPng(title: string, description: string, url: string): Promise<Uint8Array> {
  const width = 526;
  const height = 200;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <rect x="8" y="8" width="${width - 16}" height="${height - 16}" fill="none" stroke="#111" stroke-width="2"/>
    <text x="32" y="72" font-size="32" font-family="sans-serif" fill="#111">${escapeXml(title)}</text>
    <text x="32" y="112" font-size="16" font-family="sans-serif" fill="#333">${escapeXml(description)}</text>
    <text x="32" y="156" font-size="12" font-family="sans-serif" fill="#555">${escapeXml(url)}</text>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

export async function qrJpeg(data: string): Promise<Uint8Array> {
  const svg = await QRCode.toString(data, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg().toBuffer());
}
