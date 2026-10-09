import decodeJxl from "@jsquash/jxl/decode.js";
import sharp from "sharp";

import { IMAGE_CODEC_SUPPORT } from "./codec-support.ts";
import { contentTypeForThumbnail, isThumbnailable, sniffContentType } from "./sniff.ts";

export { IMAGE_CODEC_SUPPORT };

declare module "heic-decode" {
  function decode(options: {
    buffer: Uint8Array;
  }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  export default decode;
}

const MAX_THUMBNAIL_SOURCE_BYTES = 100 * 1024 * 1024;

export type ThumbnailOptions = {
  enabled: boolean;
  width: number;
  height: number;
};

export class ThumbnailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThumbnailError";
  }
}

export async function renderThumbnail(
  content: Uint8Array,
  title: string,
  options: ThumbnailOptions,
): Promise<Uint8Array> {
  if (content.byteLength > MAX_THUMBNAIL_SOURCE_BYTES) {
    throw new ThumbnailError(`original file ${title} is too large to create a thumbnail`);
  }
  const contentType = contentTypeForThumbnail(sniffContentType(content), title);
  if (!isThumbnailable(contentType)) {
    throw new ThumbnailError(
      `file type ${title} is not supported for thumbnail creation or document thumbnails disabled`,
    );
  }
  if (contentType === "image/heic" || contentType === "image/heif") {
    return thumbnailFromRaw(await decodeHeic(content), options);
  }
  if (contentType === "image/jxl") {
    return thumbnailFromRaw(await decodeJpegXl(content), options);
  }
  try {
    const webp = await sharp(content)
      .rotate()
      .resize({
        width: options.width,
        height: options.height,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
    return new Uint8Array(webp);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ThumbnailError(`failed to decode image file: ${message}`);
  }
}

async function decodeHeic(content: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array }> {
  // sharp's prebuilt libvips does not decode HEVC HEIC (see codec-support.ts).
  const decode = (await import("heic-decode")).default;
  const decoded = await decode({ buffer: content });
  return { width: decoded.width, height: decoded.height, data: new Uint8Array(decoded.data) };
}

async function decodeJpegXl(content: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array }> {
  const decoded = await decodeJxl(toArrayBuffer(content));
  return { width: decoded.width, height: decoded.height, data: new Uint8Array(decoded.data) };
}

async function thumbnailFromRaw(
  image: { width: number; height: number; data: Uint8Array },
  options: ThumbnailOptions,
): Promise<Uint8Array> {
  const webp = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .resize({
      width: options.width,
      height: options.height,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();
  return new Uint8Array(webp);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
