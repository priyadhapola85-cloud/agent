import "server-only";
import type { NextRequest } from "next/server";
import type { AppContext } from "../context";
import type { MediaAsset } from "../db/schema";
import { AppError } from "../errors";
import { extensionFor } from "../media/media-type";

/**
 * Streams a private media file to a logged-in user.
 * Supports HTTP Range requests so the video player can seek.
 */
export async function serveAsset(
  ctx: AppContext,
  asset: MediaAsset,
  req: NextRequest,
  opts: { download?: boolean; filename?: string } = {},
): Promise<Response> {
  let size: number;
  try {
    size = await ctx.storage.size(asset.storageKey);
  } catch {
    throw new AppError("NOT_FOUND", "The media file is missing from storage.");
  }

  const filename = (opts.filename ?? `${asset.id}.${extensionFor(asset.mimeType)}`).replace(/[^\w.\-]/g, "_");
  const headers: Record<string, string> = {
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${opts.download ? "attachment" : "inline"}; filename="${filename}"`,
  };

  const range = req.headers.get("range");
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (match && size > 0) {
    let start = match[1] ? Number(match[1]) : NaN;
    let end = match[2] ? Number(match[2]) : NaN;
    if (Number.isNaN(start)) {
      // "bytes=-500" → last 500 bytes
      start = Math.max(0, size - (Number.isNaN(end) ? 0 : end));
      end = size - 1;
    }
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end || start >= size)
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const { stream } = await ctx.storage.stream(asset.storageKey, { start, end });
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const { stream } = await ctx.storage.stream(asset.storageKey);
  return new Response(stream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}
