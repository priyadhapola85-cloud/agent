import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppContext } from "../context";
import { mediaAssets, type AssetKind, type AssetSource, type MediaAsset } from "../db/schema";
import { AppError, notFound } from "../errors";
import { newId } from "../ids";
import {
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
  detectMime,
  extensionFor,
  imageSize,
  type ImageMime,
} from "../media/media-type";

/**
 * MEDIA ASSETS
 * Saves files into private storage and records their metadata in the DB.
 * The browser only ever sees `/api/assets/<id>` — never the storage path.
 */

export type AssetDTO = {
  id: string;
  kind: AssetKind;
  source: AssetSource;
  url: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  reviewStatus: MediaAsset["reviewStatus"];
  reviewNote: string | null;
  jobId: string | null;
  sceneId: string | null;
  characterId: string | null;
  createdAt: string;
};

export function toAssetDTO(a: MediaAsset): AssetDTO {
  return {
    id: a.id,
    kind: a.kind,
    source: a.source,
    url: `/api/assets/${a.id}`,
    downloadUrl: `/api/assets/${a.id}?download=1`,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    width: a.width,
    height: a.height,
    reviewStatus: a.reviewStatus,
    reviewNote: a.reviewNote,
    jobId: a.jobId,
    sceneId: a.sceneId,
    characterId: a.characterId,
    createdAt: a.createdAt.toISOString(),
  };
}

export type SaveAssetInput = {
  data: Buffer;
  mimeType: string;
  kind: AssetKind;
  source: AssetSource;
  characterId?: string | null;
  projectId?: string | null;
  sceneId?: string | null;
  jobId?: string | null;
  originalFilename?: string | null;
  reviewStatus?: MediaAsset["reviewStatus"];
  width?: number | null;
  height?: number | null;
};

export async function saveAsset(ctx: AppContext, input: SaveAssetInput): Promise<MediaAsset> {
  const id = newId("ast");
  const folder = input.characterId
    ? `characters/${input.characterId}`
    : input.projectId
      ? `projects/${input.projectId}`
      : "misc";
  const storageKey = `${folder}/${id}.${extensionFor(input.mimeType)}`;
  await ctx.storage.put(storageKey, input.data);

  const dims = input.kind === "image" ? imageSize(input.data) : null;
  const [row] = await ctx.db
    .insert(mediaAssets)
    .values({
      id,
      kind: input.kind,
      source: input.source,
      storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.data.length,
      width: dims?.width ?? input.width ?? null,
      height: dims?.height ?? input.height ?? null,
      sha256: createHash("sha256").update(input.data).digest("hex"),
      originalFilename: input.originalFilename ?? null,
      characterId: input.characterId ?? null,
      projectId: input.projectId ?? null,
      sceneId: input.sceneId ?? null,
      jobId: input.jobId ?? null,
      reviewStatus: input.reviewStatus ?? "pending",
    })
    .returning();
  return row;
}

/** Checks an uploaded reference image: real image type, size limit, sensible dimensions. */
export function validateImageUpload(data: Buffer): { mimeType: ImageMime; width: number; height: number } {
  if (data.length === 0) throw new AppError("VALIDATION", "The uploaded file is empty.");
  if (data.length > MAX_UPLOAD_BYTES)
    throw new AppError("PAYLOAD_TOO_LARGE", "The image is larger than 5 MB.", {
      action: "Export or resize it to under 5 MB (for example 2000 px on the long side, JPG quality 85) and upload again.",
    });
  const mime = detectMime(data);
  if (!mime || !ALLOWED_UPLOAD_MIME.includes(mime as ImageMime))
    throw new AppError("UNSUPPORTED_MEDIA", "Only JPG, PNG or WebP images can be uploaded.", {
      action: "Convert the image to JPG or PNG and try again.",
    });
  const dims = imageSize(data);
  if (!dims) throw new AppError("UNSUPPORTED_MEDIA", "Could not read the image dimensions. The file may be damaged.");
  if (Math.min(dims.width, dims.height) < 256)
    throw new AppError("VALIDATION", "The image is too small (minimum 256 px on the short side).", {
      action: "Upload a larger, clearer photo — ideally 1024 px or more.",
    });
  if (dims.width > 12000 || dims.height > 12000)
    throw new AppError("VALIDATION", "The image dimensions are too large (max 12000 px).");
  return { mimeType: mime as ImageMime, ...dims };
}

export async function getAsset(ctx: AppContext, id: string): Promise<MediaAsset> {
  const [row] = await ctx.db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
  if (!row) throw notFound("Media file");
  return row;
}

export async function readAssetData(ctx: AppContext, asset: MediaAsset): Promise<Buffer> {
  try {
    return await ctx.storage.read(asset.storageKey);
  } catch (err) {
    throw new AppError("NOT_FOUND", "The media file is missing from storage.", {
      action: "It may have been deleted from the storage folder. Regenerate or re-upload it.",
      detail: String(err),
    });
  }
}

export async function deleteAssetFiles(ctx: AppContext, assets: MediaAsset[]) {
  for (const a of assets) await ctx.storage.delete(a.storageKey).catch(() => undefined);
}
