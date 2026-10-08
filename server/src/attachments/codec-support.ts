// How new-photo thumbnails are decoded, checked against the Go server.
//
// Go (github.com/gen2brain/heic and github.com/gen2brain/jpegxl) decodes
// testdata/images/test8.heic and testdata/images/or6_ll.jxl in this environment.
// Those samples are the library fixtures, copied so the Bun tests do not depend
// on the module cache.
//
// sharp 0.35.5 prebuilt binaries decode JPEG, PNG, WebP, GIF, and AVIF, and
// encode the WebP thumbnail (quality 80, fit inside the configured box).
// They do not decode these two samples:
// - HEIC/HEVC: sharp reports heif input, then fails with "bad seek". HEVC
//   encode is "Unsupported compression". heic-decode (libheif wasm) decodes
//   the same bytes Go accepts; sharp resizes and encodes the WebP.
// - JPEG XL: sharp format.jxl.input is false. @jsquash/jxl decodes the same
//   bytes Go accepts via its wazero decoder; sharp encodes the WebP.
//
// A decode failure does not fail the upload. The Go worker logs the error,
// acks the message, and leaves the attachment without a thumbnail row. This
// server does the same. backend/ image code is not deleted.
export const IMAGE_CODEC_SUPPORT = {
  jpeg: { decoder: "sharp", goAccepts: true },
  heic: {
    decoder: "heic-decode",
    sharpDecodesHevcSample: false,
    goAcceptsSample: true,
    sample: "testdata/images/test8.heic",
  },
  jpegxl: {
    decoder: "@jsquash/jxl",
    sharpInput: false,
    goAcceptsSample: true,
    sample: "testdata/images/or6_ll.jxl",
  },
} as const;
