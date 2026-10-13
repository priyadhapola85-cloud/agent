import { and, desc, eq, ilike, inArray, ne, or } from "drizzle-orm";
import type { AppContext } from "../context";
import {
  characterReferences,
  characters,
  contentProjects,
  generationJobs,
  mediaAssets,
  type Character,
  type CharacterIdentity,
  type CharacterReference,
  type CharacterStatus,
  type CharacterStyle,
} from "../db/schema";
import { AppError, notFound } from "../errors";
import { newId } from "../ids";
import { characterCandidatePrompt } from "../prompts/templates";
import { resolveImageModel } from "./model-choice";
import type { z } from "zod";
import type {
  approveReferenceSchema,
  createCharacterSchema,
  generateCandidatesSchema,
  updateCharacterSchema,
  updateReferenceSchema,
} from "../validation/schemas";
import { deleteAssetFiles, getAsset, readAssetData, saveAsset, toAssetDTO, validateImageUpload } from "./assets";
import { recordEvent } from "./events";
import { createJob, toJobDTO } from "./jobs";

/**
 * CHARACTERS — reference-first workflow
 *
 *  1. createCharacter        → "draft" (just a name/notes, no image needed)
 *  2. uploadSourceReference  → "reference_uploaded" (your photo, stored privately)
 *  3. analyzeReference       → Claude describes what is visible (optional)
 *  4. updateCharacter(markReviewed) → "ready_to_generate"
 *  5. generateCandidates     → only when YOU press Generate
 *  6. approveReference(master) → "active" — future images/videos reuse it
 */

type CreateInput = z.infer<typeof createCharacterSchema>;
type UpdateInput = z.infer<typeof updateCharacterSchema>;

export async function getCharacter(ctx: AppContext, id: string): Promise<Character> {
  const [row] = await ctx.db.select().from(characters).where(eq(characters.id, id));
  if (!row) throw notFound("Character");
  return row;
}

async function getReferences(ctx: AppContext, characterId: string) {
  return ctx.db
    .select({ ref: characterReferences, asset: mediaAssets })
    .from(characterReferences)
    .innerJoin(mediaAssets, eq(characterReferences.assetId, mediaAssets.id))
    .where(eq(characterReferences.characterId, characterId))
    .orderBy(characterReferences.createdAt);
}

/** Works out the status from what the character currently has. */
async function recomputeStatus(ctx: AppContext, character: Character): Promise<CharacterStatus> {
  if (character.status === "archived") return "archived";
  const refs = await ctx.db
    .select({ role: characterReferences.role })
    .from(characterReferences)
    .where(eq(characterReferences.characterId, character.id));
  let next: CharacterStatus;
  if (refs.some((r) => r.role === "master")) next = "active";
  else if (refs.some((r) => r.role === "source")) next = character.descriptionReviewedAt ? "ready_to_generate" : "reference_uploaded";
  else next = "draft";
  if (next !== character.status) {
    await ctx.db.update(characters).set({ status: next, updatedAt: new Date() }).where(eq(characters.id, character.id));
    await recordEvent(ctx.db, "character", character.id, character.status, next);
  }
  return next;
}

function mergeDefined<T extends object>(base: T, patch: Partial<T> | undefined): T {
  if (!patch) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === "" || v === null) delete out[k];
    else out[k] = v;
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listCharacters(ctx: AppContext, opts: { search?: string; includeArchived?: boolean } = {}) {
  const filters = [];
  if (!opts.includeArchived) filters.push(ne(characters.status, "archived"));
  if (opts.search) {
    const q = `%${opts.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(or(ilike(characters.name, q), ilike(characters.description, q), ilike(characters.id, q)));
  }
  const rows = await ctx.db
    .select()
    .from(characters)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(characters.updatedAt));

  const ids = rows.map((r) => r.id);
  const refs = ids.length
    ? await ctx.db
        .select({ ref: characterReferences, asset: mediaAssets })
        .from(characterReferences)
        .innerJoin(mediaAssets, eq(characterReferences.assetId, mediaAssets.id))
        .where(and(inArray(characterReferences.characterId, ids), inArray(characterReferences.role, ["master", "source"])))
    : [];
  return rows.map((c) => {
    const master = refs.find((r) => r.ref.characterId === c.id && r.ref.role === "master");
    const source = refs.find((r) => r.ref.characterId === c.id && r.ref.role === "source");
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      status: c.status,
      niche: c.style.niche ?? null,
      thumbnailUrl: (master ?? source)?.asset ? toAssetDTO((master ?? source)!.asset).url : null,
      hasMaster: !!master,
      updatedAt: c.updatedAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
    };
  });
}

export async function getCharacterDetail(ctx: AppContext, id: string) {
  const character = await getCharacter(ctx, id);
  const refs = await getReferences(ctx, id);
  const candidateAssets = await ctx.db
    .select({ asset: mediaAssets, purpose: generationJobs.purpose })
    .from(mediaAssets)
    .innerJoin(generationJobs, eq(mediaAssets.jobId, generationJobs.id))
    .where(and(eq(mediaAssets.characterId, id), eq(generationJobs.purpose, "character_candidate")))
    .orderBy(desc(mediaAssets.createdAt));
  const jobs = await ctx.db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.characterId, id))
    .orderBy(desc(generationJobs.createdAt))
    .limit(50);
  const jobAssets = jobs.length
    ? await ctx.db.select().from(mediaAssets).where(inArray(mediaAssets.jobId, jobs.map((j) => j.id)))
    : [];

  const refByAsset = new Map(refs.map((r) => [r.asset.id, r.ref]));
  return {
    character: serializeCharacter(character),
    references: refs.map((r) => ({ ...serializeRef(r.ref), asset: toAssetDTO(r.asset) })),
    candidates: candidateAssets.map(({ asset }) => ({
      ...toAssetDTO(asset),
      referenceRole: refByAsset.get(asset.id)?.role ?? null,
    })),
    jobs: jobs.map((j) => toJobDTO(j, jobAssets.filter((a) => a.jobId === j.id))),
    canGenerate: character.status === "ready_to_generate" || character.status === "active",
  };
}

export function serializeCharacter(c: Character) {
  return {
    ...c,
    rightsConfirmedAt: c.rightsConfirmedAt?.toISOString() ?? null,
    descriptionReviewedAt: c.descriptionReviewedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function serializeRef(r: CharacterReference) {
  return { ...r, createdAt: r.createdAt.toISOString() };
}

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

export async function createCharacter(ctx: AppContext, input: CreateInput) {
  const [row] = await ctx.db
    .insert(characters)
    .values({
      id: newId("chr"),
      name: input.name,
      description: input.description ?? "",
      identity: mergeDefined<CharacterIdentity>({}, input.identity),
      style: mergeDefined<CharacterStyle>({}, input.style),
      status: "draft",
    })
    .returning();
  await recordEvent(ctx.db, "character", row.id, null, "draft", "Character profile created");
  return row;
}

export async function updateCharacter(ctx: AppContext, id: string, input: UpdateInput) {
  const current = await getCharacter(ctx, id);
  const patch: Partial<Character> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.identity) patch.identity = mergeDefined(current.identity, input.identity);
  if (input.style) patch.style = mergeDefined(current.style, input.style);
  if (input.markReviewed) patch.descriptionReviewedAt = new Date();
  if (input.archived === true) patch.status = "archived";
  if (input.archived === false && current.status === "archived") patch.status = "draft"; // recomputed below

  const [updated] = await ctx.db.update(characters).set(patch).where(eq(characters.id, id)).returning();
  if (input.archived !== undefined && patch.status) {
    await recordEvent(ctx.db, "character", id, current.status, patch.status, input.archived ? "Archived" : "Restored");
  }
  await recomputeStatus(ctx, updated);
  return getCharacter(ctx, id);
}

export async function deleteCharacter(ctx: AppContext, id: string) {
  await getCharacter(ctx, id);
  const projects = await ctx.db
    .select({ id: contentProjects.id })
    .from(contentProjects)
    .where(eq(contentProjects.characterId, id));
  if (projects.length > 0)
    throw new AppError("CONFLICT", `This character is used by ${projects.length} content project(s).`, {
      action: "Delete those projects first, or archive the character instead.",
    });
  const assets = await ctx.db.select().from(mediaAssets).where(eq(mediaAssets.characterId, id));
  await ctx.db.delete(characters).where(eq(characters.id, id));
  if (assets.length) await ctx.db.delete(mediaAssets).where(inArray(mediaAssets.id, assets.map((a) => a.id)));
  await deleteAssetFiles(ctx, assets);
}

// ---------------------------------------------------------------------------
// Reference upload + analysis
// ---------------------------------------------------------------------------

export async function uploadSourceReference(
  ctx: AppContext,
  characterId: string,
  file: { data: Buffer; filename: string },
  rightsConfirmed: boolean,
) {
  const character = await getCharacter(ctx, characterId);
  if (character.status === "archived") throw new AppError("CONFLICT", "Restore this character before uploading.");
  if (!rightsConfirmed)
    throw new AppError("VALIDATION", "Please confirm you have the right to use this image.", {
      fields: { rightsConfirmed: "Required" },
      action: "Tick the confirmation box. Only upload images you own or have permission to use, and never use a real person's likeness without their consent.",
    });
  const { mimeType } = validateImageUpload(file.data);

  const asset = await saveAsset(ctx, {
    data: file.data,
    mimeType,
    kind: "image",
    source: "upload",
    characterId,
    originalFilename: file.filename.replace(/[^\w.\- ]/g, "").slice(0, 120) || null,
    reviewStatus: "approved",
  });

  // Only one current source upload; older uploads stay in history as assets.
  await ctx.db
    .delete(characterReferences)
    .where(and(eq(characterReferences.characterId, characterId), eq(characterReferences.role, "source")));
  await ctx.db.insert(characterReferences).values({
    id: newId("ref"),
    characterId,
    assetId: asset.id,
    role: "source",
    useForGeneration: true,
    label: "Uploaded reference",
  });
  const [updated] = await ctx.db
    .update(characters)
    .set({ rightsConfirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(characters.id, characterId))
    .returning();
  await recordEvent(ctx.db, "asset", asset.id, null, "uploaded", `Reference uploaded for ${characterId}`);
  await recomputeStatus(ctx, updated);
  return asset;
}

export async function analyzeReference(ctx: AppContext, characterId: string, mode: "fill_empty" | "overwrite") {
  const character = await getCharacter(ctx, characterId);
  const analyzer = ctx.providers.analyzer;
  if (!analyzer.isConfigured())
    throw new AppError("NOT_CONFIGURED", "Automatic image analysis needs Claude, which is not configured.", {
      action: "Add ANTHROPIC_API_KEY to .env.local and restart — or simply write the description fields yourself.",
    });
  const [source] = await ctx.db
    .select({ asset: mediaAssets })
    .from(characterReferences)
    .innerJoin(mediaAssets, eq(characterReferences.assetId, mediaAssets.id))
    .where(and(eq(characterReferences.characterId, characterId), eq(characterReferences.role, "source")));
  if (!source) throw new AppError("CONFLICT", "Upload a reference image first.");

  const result = await analyzer.analyze({
    data: await readAssetData(ctx, source.asset),
    mimeType: source.asset.mimeType,
  });

  const fill = <T extends object>(current: T, found: T): T => {
    const out = { ...current } as Record<string, unknown>;
    for (const [k, v] of Object.entries(found)) {
      if (typeof v !== "string" || !v.trim()) continue;
      if (mode === "overwrite" || !out[k]) out[k] = v.trim();
    }
    return out as T;
  };

  const [updated] = await ctx.db
    .update(characters)
    .set({
      identity: fill(character.identity, result.identity),
      style: fill(character.style, result.style),
      description: mode === "overwrite" || !character.description ? result.summary : character.description,
      analysis: {
        ...result,
        notes: result.notes ?? "",
        model: analyzer.model,
        analyzedAt: new Date().toISOString(),
        sourceAssetId: source.asset.id,
      },
      updatedAt: new Date(),
    })
    .where(eq(characters.id, characterId))
    .returning();
  await recordEvent(ctx.db, "character", characterId, character.status, character.status, `Reference analyzed by ${analyzer.model}`);
  return updated;
}

// ---------------------------------------------------------------------------
// Candidate generation (only when the user presses Generate)
// ---------------------------------------------------------------------------

/**
 * The reference images sent to the provider: master first, then the uploaded
 * source, then extra approved images — only those marked "use for generation".
 */
export async function referenceAssetIdsForGeneration(ctx: AppContext, characterId: string, max: number) {
  const refs = await ctx.db
    .select()
    .from(characterReferences)
    .where(and(eq(characterReferences.characterId, characterId), eq(characterReferences.useForGeneration, true)));
  const order = { master: 0, source: 1, approved: 2 } as const;
  return refs
    .sort((a, b) => order[a.role] - order[b.role] || a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, max)
    .map((r) => r.assetId);
}

export async function generateCandidates(ctx: AppContext, characterId: string, input: z.infer<typeof generateCandidatesSchema>) {
  const character = await getCharacter(ctx, characterId);
  if (character.status === "draft")
    throw new AppError("CONFLICT", "Upload a reference image before generating.", {
      action: "Use the upload area in the Design Studio.",
    });
  if (character.status === "reference_uploaded")
    throw new AppError("CONFLICT", "Review the character description first.", {
      action: 'Check the description fields, then press "Save & mark reviewed".',
    });
  if (character.status === "archived") throw new AppError("CONFLICT", "Restore this character before generating.");

  const model = resolveImageModel(ctx, input.model);
  const referenceAssetIds = await referenceAssetIdsForGeneration(ctx, characterId, model.maxReferences);
  if (referenceAssetIds.length === 0)
    throw new AppError("CONFLICT", "No reference images are enabled for generation.", {
      action: 'Turn on "Use for generation" for at least one reference.',
    });

  const prompt = characterCandidatePrompt(character, input.revisionNotes);
  const { job, duplicate } = await createJob(ctx, {
    kind: "image",
    purpose: "character_candidate",
    characterId,
    provider: model.provider,
    model: model.id,
    prompt,
    params: {
      numImages: input.numImages,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      ...(input.revisionNotes ? { revisionNotes: input.revisionNotes } : {}),
    },
    referenceAssetIds,
    idempotencyKey: input.idempotencyKey,
  });
  return { job: toJobDTO(job), duplicate };
}

// ---------------------------------------------------------------------------
// Approving references
// ---------------------------------------------------------------------------

export async function approveReference(ctx: AppContext, characterId: string, input: z.infer<typeof approveReferenceSchema>) {
  const character = await getCharacter(ctx, characterId);
  const asset = await getAsset(ctx, input.assetId);
  if (asset.characterId !== characterId || asset.kind !== "image")
    throw new AppError("VALIDATION", "That image does not belong to this character.");
  if (input.role === "master" && asset.source === "upload")
    throw new AppError("VALIDATION", "Choose a generated candidate as the master reference.", {
      action: "Generate candidates from your upload, then approve the best one.",
    });

  await ctx.db.transaction(async (tx) => {
    if (input.role === "master") {
      // Demote the existing master (keeps it as an extra approved reference).
      await tx
        .update(characterReferences)
        .set({ role: "approved" })
        .where(and(eq(characterReferences.characterId, characterId), eq(characterReferences.role, "master")));
    }
    const [existing] = await tx
      .select()
      .from(characterReferences)
      .where(and(eq(characterReferences.characterId, characterId), eq(characterReferences.assetId, asset.id)));
    if (existing) {
      if (existing.role !== "source") {
        await tx
          .update(characterReferences)
          .set({ role: input.role, label: input.label ?? existing.label })
          .where(eq(characterReferences.id, existing.id));
      }
    } else {
      await tx.insert(characterReferences).values({
        id: newId("ref"),
        characterId,
        assetId: asset.id,
        role: input.role,
        useForGeneration: true,
        label: input.label ?? (input.role === "master" ? "Master reference" : "Approved reference"),
      });
    }
    await tx.update(mediaAssets).set({ reviewStatus: "approved", reviewNote: null }).where(eq(mediaAssets.id, asset.id));
  });
  await recordEvent(ctx.db, "asset", asset.id, asset.reviewStatus, "approved", `Approved as ${input.role} reference`);
  await recomputeStatus(ctx, character);
  return getCharacterDetail(ctx, characterId);
}

export async function updateReference(
  ctx: AppContext,
  characterId: string,
  refId: string,
  input: z.infer<typeof updateReferenceSchema>,
) {
  const [ref] = await ctx.db
    .select()
    .from(characterReferences)
    .where(and(eq(characterReferences.id, refId), eq(characterReferences.characterId, characterId)));
  if (!ref) throw notFound("Reference");
  if (input.makeMaster) return approveReference(ctx, characterId, { assetId: ref.assetId, role: "master", label: input.label });
  await ctx.db
    .update(characterReferences)
    .set({
      ...(input.useForGeneration !== undefined ? { useForGeneration: input.useForGeneration } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
    })
    .where(eq(characterReferences.id, refId));
  return getCharacterDetail(ctx, characterId);
}

export async function removeReference(ctx: AppContext, characterId: string, refId: string) {
  const character = await getCharacter(ctx, characterId);
  const [ref] = await ctx.db
    .select()
    .from(characterReferences)
    .where(and(eq(characterReferences.id, refId), eq(characterReferences.characterId, characterId)));
  if (!ref) throw notFound("Reference");
  await ctx.db.delete(characterReferences).where(eq(characterReferences.id, refId));
  if (ref.role !== "source") {
    await ctx.db.update(mediaAssets).set({ reviewStatus: "pending" }).where(eq(mediaAssets.id, ref.assetId));
  }
  await recordEvent(ctx.db, "asset", ref.assetId, ref.role, "removed", "Removed from character references");
  await recomputeStatus(ctx, character);
  return getCharacterDetail(ctx, characterId);
}

/** Reject (or un-reject) a generated image that doesn't match the character. */
export async function setAssetReview(ctx: AppContext, assetId: string, decision: "rejected" | "pending", note: string) {
  const asset = await getAsset(ctx, assetId);
  if (asset.source === "upload") throw new AppError("VALIDATION", "Uploaded references can't be rejected; replace them instead.");
  const refs = await ctx.db.select().from(characterReferences).where(eq(characterReferences.assetId, assetId));
  if (decision === "rejected" && refs.length > 0)
    throw new AppError("CONFLICT", "This image is an approved reference.", {
      action: "Remove it from the references first, then reject it.",
    });
  const [updated] = await ctx.db
    .update(mediaAssets)
    .set({ reviewStatus: decision, reviewNote: note || null })
    .where(eq(mediaAssets.id, assetId))
    .returning();
  await recordEvent(ctx.db, "asset", assetId, asset.reviewStatus, decision, note);
  return toAssetDTO(updated);
}

export type CharacterDetail = Awaited<ReturnType<typeof getCharacterDetail>>;
export type CharacterListItem = Awaited<ReturnType<typeof listCharacters>>[number];
