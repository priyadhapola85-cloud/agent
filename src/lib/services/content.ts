import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { z } from "zod";
import type { AppContext } from "../context";
import {
  approvals,
  characterReferences,
  characters,
  contentProjects,
  generationJobs,
  mediaAssets,
  storyboardScenes,
  type ContentProject,
  type StoryboardScene,
  type VideoStatus,
} from "../db/schema";
import { AppError, notFound } from "../errors";
import { newId } from "../ids";
import { DEFAULT_VIDEO_NEGATIVE_PROMPT, identityBlock, sceneImagePrompt, sceneVideoPrompt } from "../prompts/templates";
import { findImageModel, findVideoModel, IMAGE_MODELS, VIDEO_MODELS } from "../providers/models";
import { resolveImageModel, resolveVideoModel } from "./model-choice";
import type { PlannedScene } from "../providers/types";
import type {
  createProjectSchema,
  generateSceneImageSchema,
  generateVideoSchema,
  planProjectSchema,
  sceneFieldsSchema,
  updateProjectSchema,
  updateSceneSchema,
} from "../validation/schemas";
import { deleteAssetFiles, getAsset, toAssetDTO } from "./assets";
import { getCharacter, referenceAssetIdsForGeneration } from "./characters";
import { recordEvent } from "./events";
import { createJob, hasActiveVideoJob, toJobDTO } from "./jobs";
import { isExportable, transitionVideoStatus } from "./lifecycle";

/**
 * CONTENT PROJECTS
 *   brief → (planner) concept + storyboard scenes → scene still images
 *   → pick a start frame → image-to-video → review → export
 *
 * Nothing expensive starts automatically: planning only writes text, and each
 * image/video generation needs its own button press.
 */

export async function getProject(ctx: AppContext, id: string): Promise<ContentProject> {
  const [row] = await ctx.db.select().from(contentProjects).where(eq(contentProjects.id, id));
  if (!row) throw notFound("Project");
  return row;
}

export async function getScene(ctx: AppContext, id: string): Promise<StoryboardScene> {
  const [row] = await ctx.db.select().from(storyboardScenes).where(eq(storyboardScenes.id, id));
  if (!row) throw notFound("Scene");
  return row;
}

function serializeProject(p: ContentProject) {
  return {
    ...p,
    plannedAt: p.plannedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function serializeScene(s: StoryboardScene) {
  return { ...s, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() };
}

async function requireActiveCharacter(ctx: AppContext, characterId: string) {
  const character = await getCharacter(ctx, characterId);
  if (character.status !== "active")
    throw new AppError("CONFLICT", `${character.name} has no approved master reference yet.`, {
      action: "Open the character's Design Studio, generate candidates and approve one as the master reference.",
    });
  return character;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(ctx: AppContext, opts: { characterId?: string } = {}) {
  const rows = await ctx.db
    .select({ project: contentProjects, characterName: characters.name })
    .from(contentProjects)
    .innerJoin(characters, eq(contentProjects.characterId, characters.id))
    .where(opts.characterId ? eq(contentProjects.characterId, opts.characterId) : undefined)
    .orderBy(desc(contentProjects.updatedAt));
  const ids = rows.map((r) => r.project.id);
  const scenes = ids.length
    ? await ctx.db
        .select({ projectId: storyboardScenes.projectId, videoStatus: storyboardScenes.videoStatus })
        .from(storyboardScenes)
        .where(inArray(storyboardScenes.projectId, ids))
    : [];
  return rows.map(({ project, characterName }) => {
    const mine = scenes.filter((s) => s.projectId === project.id);
    const count = (st: VideoStatus) => mine.filter((s) => s.videoStatus === st).length;
    return {
      ...serializeProject(project),
      characterName,
      sceneCount: mine.length,
      approvedCount: count("approved"),
      reviewCount: count("ready_for_review"),
      generatingCount: count("generating"),
    };
  });
}

export async function createProject(ctx: AppContext, input: z.infer<typeof createProjectSchema>) {
  await requireActiveCharacter(ctx, input.characterId);
  const [row] = await ctx.db
    .insert(contentProjects)
    .values({
      id: newId("prj"),
      characterId: input.characterId,
      title: input.title,
      brief: input.brief,
      caption: input.brief.caption ?? "",
    })
    .returning();
  return serializeProject(row);
}

export async function updateProject(ctx: AppContext, id: string, input: z.infer<typeof updateProjectSchema>) {
  await getProject(ctx, id);
  const [row] = await ctx.db
    .update(contentProjects)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(contentProjects.id, id))
    .returning();
  return serializeProject(row);
}

export async function deleteProject(ctx: AppContext, id: string) {
  await getProject(ctx, id);
  const active = await ctx.db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(and(eq(generationJobs.projectId, id), inArray(generationJobs.status, ["queued", "generating"])));
  if (active.length)
    throw new AppError("CONFLICT", "This project has generations still running.", { action: "Wait for them to finish, then delete." });
  const assets = await ctx.db.select().from(mediaAssets).where(eq(mediaAssets.projectId, id));
  await ctx.db.delete(contentProjects).where(eq(contentProjects.id, id));
  if (assets.length) await ctx.db.delete(mediaAssets).where(inArray(mediaAssets.id, assets.map((a) => a.id)));
  await deleteAssetFiles(ctx, assets);
}

export async function getProjectDetail(ctx: AppContext, id: string) {
  const project = await getProject(ctx, id);
  const character = await getCharacter(ctx, project.characterId);
  const [master] = await ctx.db
    .select({ asset: mediaAssets })
    .from(characterReferences)
    .innerJoin(mediaAssets, eq(characterReferences.assetId, mediaAssets.id))
    .where(and(eq(characterReferences.characterId, character.id), eq(characterReferences.role, "master")));
  const references = await ctx.db
    .select({ ref: characterReferences, asset: mediaAssets })
    .from(characterReferences)
    .innerJoin(mediaAssets, eq(characterReferences.assetId, mediaAssets.id))
    .where(and(eq(characterReferences.characterId, character.id), ne(characterReferences.role, "source")));

  const scenes = await ctx.db
    .select()
    .from(storyboardScenes)
    .where(eq(storyboardScenes.projectId, id))
    .orderBy(asc(storyboardScenes.position), asc(storyboardScenes.createdAt));
  const sceneIds = scenes.map((s) => s.id);
  const assets = sceneIds.length
    ? await ctx.db.select().from(mediaAssets).where(inArray(mediaAssets.sceneId, sceneIds)).orderBy(desc(mediaAssets.createdAt))
    : [];
  const jobs = sceneIds.length
    ? await ctx.db
        .select()
        .from(generationJobs)
        .where(inArray(generationJobs.sceneId, sceneIds))
        .orderBy(desc(generationJobs.createdAt))
    : [];
  const approvalRows = sceneIds.length
    ? await ctx.db.select().from(approvals).where(inArray(approvals.sceneId, sceneIds)).orderBy(desc(approvals.createdAt))
    : [];

  const scenesOut = [];
  for (const s of scenes) {
    const mine = assets.filter((a) => a.sceneId === s.id);
    const sceneJobs = jobs.filter((j) => j.sceneId === s.id);
    scenesOut.push({
      ...serializeScene(s),
      images: mine.filter((a) => a.kind === "image").map(toAssetDTO),
      videos: mine.filter((a) => a.kind === "video").map(toAssetDTO),
      selectedImage: s.selectedImageAssetId
        ? toAssetDTO(
            mine.find((a) => a.id === s.selectedImageAssetId) ??
              references.find((r) => r.asset.id === s.selectedImageAssetId)?.asset ??
              (await getAsset(ctx, s.selectedImageAssetId)),
          )
        : null,
      currentVideo: s.currentVideoAssetId ? toAssetDTO(mine.find((a) => a.id === s.currentVideoAssetId) ?? (await getAsset(ctx, s.currentVideoAssetId))) : null,
      jobs: sceneJobs.slice(0, 10).map((j) => toJobDTO(j, mine.filter((a) => a.jobId === j.id))),
      approvals: approvalRows.filter((a) => a.sceneId === s.id).map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      exportable: s.videoStatus === "approved" ? await isExportable(ctx, s.id) : false,
    });
  }

  const videoModel = findVideoModel(ctx.settings.videoModel);
  const imageModel = findImageModel(ctx.settings.imageModel);
  return {
    project: serializeProject(project),
    character: {
      id: character.id,
      name: character.name,
      status: character.status,
      identitySummary: identityBlock(character),
      masterUrl: master ? toAssetDTO(master.asset).url : null,
    },
    references: references.map((r) => ({ id: r.ref.id, role: r.ref.role, asset: toAssetDTO(r.asset) })),
    scenes: scenesOut,
    videoModels: VIDEO_MODELS.map((m) => ({ ...m, ready: ctx.providers.video.isConfigured(m.id) })),
    defaultVideoModel: videoModel?.id ?? null,
    imageModels: IMAGE_MODELS.map((m) => ({ ...m, ready: ctx.providers.image.isConfigured(m.id) })),
    defaultImageModel: imageModel?.id ?? null,
    planners: {
      claude: ctx.providers.aiPlanner.isConfigured(),
      template: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export async function planProject(ctx: AppContext, id: string, input: z.infer<typeof planProjectSchema>) {
  const project = await getProject(ctx, id);
  const character = await getCharacter(ctx, project.characterId);
  const existing = await ctx.db.select().from(storyboardScenes).where(eq(storyboardScenes.projectId, id));
  if (existing.length && !input.replaceExisting)
    throw new AppError("CONFLICT", "This project already has a storyboard.", {
      action: "Confirm that you want to replace the existing scenes.",
    });
  for (const s of existing) {
    if (await hasActiveVideoJob(ctx, s.id))
      throw new AppError("CONFLICT", "A video is still generating for one of the scenes.", { action: "Wait for it to finish first." });
  }

  const ai = ctx.providers.aiPlanner;
  let planner = ctx.providers.templatePlanner;
  if (input.planner === "claude" || (input.planner === "auto" && ai.isConfigured())) {
    if (!ai.isConfigured())
      throw new AppError("NOT_CONFIGURED", "The AI planner needs Claude, which is not configured.", {
        action: "Add ANTHROPIC_API_KEY to .env.local, or choose the basic template planner.",
      });
    planner = ai;
  }

  const videoModel = findVideoModel(ctx.settings.videoModel) ?? VIDEO_MODELS[0];
  const plan = await planner.plan({
    characterName: character.name,
    characterSummary: character.description,
    style: character.style,
    brief: project.brief,
    allowedSceneDurations: videoModel.durations,
  });

  await ctx.db.transaction(async (tx) => {
    if (existing.length) await tx.delete(storyboardScenes).where(eq(storyboardScenes.projectId, id));
    await tx
      .update(contentProjects)
      .set({
        concept: plan.concept,
        caption: plan.caption,
        hashtags: plan.hashtags,
        transitions: plan.transitions,
        plannerSource: planner.id,
        plannerModel: planner.model,
        plannedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contentProjects.id, id));
    if (plan.scenes.length)
      await tx.insert(storyboardScenes).values(plan.scenes.map((s: PlannedScene, i: number) => ({ id: newId("scn"), projectId: id, position: i, ...s })));
  });
  return getProjectDetail(ctx, id);
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export async function addScene(ctx: AppContext, projectId: string, input: z.infer<typeof sceneFieldsSchema>) {
  await getProject(ctx, projectId);
  const scenes = await ctx.db.select({ position: storyboardScenes.position }).from(storyboardScenes).where(eq(storyboardScenes.projectId, projectId));
  if (scenes.length >= 12) throw new AppError("VALIDATION", "A project can have at most 12 scenes.");
  const [row] = await ctx.db
    .insert(storyboardScenes)
    .values({
      id: newId("scn"),
      projectId,
      position: scenes.reduce((m, s) => Math.max(m, s.position + 1), 0),
      ...input,
    })
    .returning();
  await ctx.db.update(contentProjects).set({ plannerSource: "manual", updatedAt: new Date() }).where(eq(contentProjects.id, projectId));
  return serializeScene(row);
}

export async function updateScene(ctx: AppContext, sceneId: string, input: z.infer<typeof updateSceneSchema>) {
  await getScene(ctx, sceneId);
  const [row] = await ctx.db
    .update(storyboardScenes)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(storyboardScenes.id, sceneId))
    .returning();
  return serializeScene(row);
}

export async function deleteScene(ctx: AppContext, sceneId: string) {
  const scene = await getScene(ctx, sceneId);
  if (await hasActiveVideoJob(ctx, sceneId))
    throw new AppError("CONFLICT", "A video is still generating for this scene.", { action: "Wait for it to finish first." });
  const assets = await ctx.db.select().from(mediaAssets).where(eq(mediaAssets.sceneId, sceneId));
  await ctx.db.delete(storyboardScenes).where(eq(storyboardScenes.id, sceneId));
  if (assets.length) await ctx.db.delete(mediaAssets).where(inArray(mediaAssets.id, assets.map((a) => a.id)));
  await deleteAssetFiles(ctx, assets);
  return { projectId: scene.projectId };
}

// ---------------------------------------------------------------------------
// Scene images (first frames) — uses the character's approved references
// ---------------------------------------------------------------------------

export async function generateSceneImages(ctx: AppContext, sceneId: string, input: z.infer<typeof generateSceneImageSchema>) {
  const scene = await getScene(ctx, sceneId);
  const project = await getProject(ctx, scene.projectId);
  const character = await requireActiveCharacter(ctx, project.characterId);
  const model = resolveImageModel(ctx, input.model);
  if (!scene.imagePrompt.trim() && !scene.description.trim())
    throw new AppError("VALIDATION", "Write an image prompt or description for this scene first.");

  const referenceAssetIds = await referenceAssetIdsForGeneration(ctx, character.id, model.maxReferences);
  const { job, duplicate } = await createJob(ctx, {
    kind: "image",
    purpose: "scene_image",
    characterId: character.id,
    projectId: project.id,
    sceneId,
    provider: model.provider,
    model: model.id,
    prompt: sceneImagePrompt(character, scene, project.brief, input.revisionNotes),
    params: {
      numImages: input.numImages,
      aspectRatio: project.brief.aspectRatio,
      resolution: input.resolution,
      ...(input.revisionNotes ? { revisionNotes: input.revisionNotes } : {}),
    },
    referenceAssetIds,
    idempotencyKey: input.idempotencyKey,
  });
  return { job: toJobDTO(job), duplicate };
}

/** A start frame must be this scene's own (non-rejected) image or an approved character reference. */
async function assertUsableStartFrame(ctx: AppContext, scene: StoryboardScene, characterId: string, assetId: string) {
  const asset = await getAsset(ctx, assetId);
  if (asset.kind !== "image") throw new AppError("VALIDATION", "The start frame must be an image.");
  if (asset.sceneId === scene.id) {
    if (asset.reviewStatus === "rejected") throw new AppError("VALIDATION", "That image was rejected. Choose another one.");
    return asset;
  }
  const [ref] = await ctx.db
    .select()
    .from(characterReferences)
    .where(
      and(
        eq(characterReferences.characterId, characterId),
        eq(characterReferences.assetId, assetId),
        ne(characterReferences.role, "source"),
      ),
    );
  if (!ref) throw new AppError("VALIDATION", "Choose one of this scene's images or an approved character reference.");
  return asset;
}

export async function selectSceneImage(ctx: AppContext, sceneId: string, assetId: string) {
  const scene = await getScene(ctx, sceneId);
  const project = await getProject(ctx, scene.projectId);
  await assertUsableStartFrame(ctx, scene, project.characterId, assetId);
  const [row] = await ctx.db
    .update(storyboardScenes)
    .set({ selectedImageAssetId: assetId, updatedAt: new Date() })
    .where(eq(storyboardScenes.id, sceneId))
    .returning();
  await recordEvent(ctx.db, "scene", sceneId, scene.videoStatus, scene.videoStatus, `Start frame set to ${assetId}`);
  return serializeScene(row);
}

// ---------------------------------------------------------------------------
// Video generation
// ---------------------------------------------------------------------------

export async function generateSceneVideo(ctx: AppContext, sceneId: string, input: z.infer<typeof generateVideoSchema>) {
  const scene = await getScene(ctx, sceneId);
  const project = await getProject(ctx, scene.projectId);
  await requireActiveCharacter(ctx, project.characterId);

  // Same click arriving twice → return the job we already created.
  const [already] = await ctx.db.select().from(generationJobs).where(eq(generationJobs.idempotencyKey, input.idempotencyKey));
  if (already) return { job: toJobDTO(already), duplicate: true };

  const model = resolveVideoModel(ctx, input.model);
  const duration = input.durationSeconds ?? scene.durationSeconds;
  if (!model.durations.includes(duration))
    throw new AppError("VALIDATION", `${model.label} can make clips of ${model.durations.join(", ")} seconds.`, {
      fields: { durationSeconds: `Choose ${model.durations.join(" / ")}` },
    });

  const startId = input.startAssetId ?? scene.selectedImageAssetId;
  if (!startId)
    throw new AppError("VALIDATION", "Choose a start frame first.", {
      action: "Generate scene images and select one, or pick the character's master reference.",
    });
  await assertUsableStartFrame(ctx, scene, project.characterId, startId);
  if (await hasActiveVideoJob(ctx, sceneId))
    throw new AppError("CONFLICT", "A video is already generating for this scene.", { action: "Wait for it to finish." });

  const prompt = [sceneVideoPrompt(scene), input.revisionNotes ? `Revision: ${input.revisionNotes}` : ""].filter(Boolean).join(" ");

  // Lifecycle first: this also clears any previous approval.
  await transitionVideoStatus(ctx, sceneId, "start_generation", "Video generation requested");
  try {
    const { job, duplicate } = await createJob(ctx, {
      kind: "video",
      purpose: "scene_video",
      characterId: project.characterId,
      projectId: project.id,
      sceneId,
      provider: model.provider,
      model: model.id,
      prompt,
      negativePrompt: model.supportsNegativePrompt ? (input.negativePrompt ?? DEFAULT_VIDEO_NEGATIVE_PROMPT) : null,
      params: {
        durationSeconds: duration,
        generateAudio: model.supportsAudio ? input.generateAudio : false,
        aspectRatio: project.brief.aspectRatio,
        ...(input.revisionNotes ? { revisionNotes: input.revisionNotes } : {}),
      },
      referenceAssetIds: [],
      inputAssetId: startId,
      idempotencyKey: input.idempotencyKey,
    });
    if (startId !== scene.selectedImageAssetId)
      await ctx.db.update(storyboardScenes).set({ selectedImageAssetId: startId }).where(eq(storyboardScenes.id, sceneId));
    return { job: toJobDTO(job), duplicate };
  } catch (err) {
    await transitionVideoStatus(ctx, sceneId, "generation_failed", "Could not create the job");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Review + export
// ---------------------------------------------------------------------------

export async function reviewSceneVideo(ctx: AppContext, sceneId: string, decision: "approved" | "rejected", note: string) {
  const scene = await getScene(ctx, sceneId);
  if (!scene.currentVideoAssetId) throw new AppError("CONFLICT", "This scene has no video to review yet.");
  await transitionVideoStatus(ctx, sceneId, decision === "approved" ? "approve" : "reject", note || decision);
  await ctx.db.insert(approvals).values({
    id: newId("apr"),
    sceneId,
    assetId: scene.currentVideoAssetId,
    decision,
    note,
  });
  await ctx.db
    .update(mediaAssets)
    .set({ reviewStatus: decision === "approved" ? "approved" : "rejected", reviewNote: note || null })
    .where(eq(mediaAssets.id, scene.currentVideoAssetId));
  return serializeScene(await getScene(ctx, sceneId));
}

export async function getExport(ctx: AppContext, sceneId: string) {
  const scene = await getScene(ctx, sceneId);
  if (!(await isExportable(ctx, sceneId)))
    throw new AppError("FORBIDDEN", "Only approved videos can be exported.", {
      action: "Review the latest video and approve it first.",
    });
  const project = await getProject(ctx, scene.projectId);
  const character = await getCharacter(ctx, project.characterId);
  const asset = await getAsset(ctx, scene.currentVideoAssetId!);
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";
  const filename = `${slug(character.name)}_${slug(project.title)}_scene-${scene.position + 1}.mp4`;
  return { asset, filename };
}

export async function reviewQueue(ctx: AppContext, status?: VideoStatus) {
  const rows = await ctx.db
    .select({ scene: storyboardScenes, project: contentProjects, characterName: characters.name })
    .from(storyboardScenes)
    .innerJoin(contentProjects, eq(storyboardScenes.projectId, contentProjects.id))
    .innerJoin(characters, eq(contentProjects.characterId, characters.id))
    .where(status ? eq(storyboardScenes.videoStatus, status) : ne(storyboardScenes.videoStatus, "draft"))
    .orderBy(desc(storyboardScenes.updatedAt));
  const videoIds = rows.map((r) => r.scene.currentVideoAssetId).filter((x): x is string => !!x);
  const videos = videoIds.length ? await ctx.db.select().from(mediaAssets).where(inArray(mediaAssets.id, videoIds)) : [];
  const out = [];
  for (const r of rows) {
    const v = videos.find((a) => a.id === r.scene.currentVideoAssetId);
    out.push({
      scene: serializeScene(r.scene),
      projectId: r.project.id,
      projectTitle: r.project.title,
      concept: r.project.concept,
      caption: r.project.caption,
      characterName: r.characterName,
      video: v ? toAssetDTO(v) : null,
      exportable: r.scene.videoStatus === "approved" ? await isExportable(ctx, r.scene.id) : false,
    });
  }
  return out;
}

export type ProjectDetail = Awaited<ReturnType<typeof getProjectDetail>>;
export type ProjectListItem = Awaited<ReturnType<typeof listProjects>>[number];
export type ReviewItem = Awaited<ReturnType<typeof reviewQueue>>[number];
