/**
 * Detects the real file type from its first bytes ("magic numbers") instead
 * of trusting the file name or the browser — a renamed .exe won't pass.
 */

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";
export type VideoMime = "video/mp4" | "video/quicktime" | "video/webm";

export const ALLOWED_UPLOAD_MIME: ImageMime[] = ["image/png", "image/jpeg", "image/webp"];
/** Claude's image input limit is 5 MB, so we keep uploads at or below that. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_GENERATED_IMAGE_BYTES = 40 * 1024 * 1024;
export const MAX_GENERATED_VIDEO_BYTES = 300 * 1024 * 1024;

export function detectMime(buf: Buffer): ImageMime | VideoMime | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  return null;
}

export function extensionFor(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "video/webm":
      return "webm";
    default:
      return "bin";
  }
}

/** Reads width/height from PNG, JPEG and WebP headers. Returns null if unknown. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  try {
    const mime = detectMime(buf);
    if (mime === "image/png") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buf[offset + 1];
        const length = buf.readUInt16BE(offset + 2);
        // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC) carry the dimensions
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
      return null;
    }
    if (mime === "image/webp") {
      const chunk = buf.toString("ascii", 12, 16);
      if (chunk === "VP8 ") {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8X") {
        return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
      }
    }
  } catch {
    return null;
  }
  return null;
}
