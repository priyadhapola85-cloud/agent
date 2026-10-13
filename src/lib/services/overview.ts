import { and, desc, eq, ilike, inArray, ne, sql, type SQL } from "drizzle-orm";
import { apiKeyProblem, authConfigProblem, DEFAULT_MODELS, env } from "../config/env";
import type { AppContext } from "../context";
import {
  characters,
  contentProjects,
  generationJobs,
  mediaAssets,
  statusEvents,
  storyboardScenes,
  type JobKind,
  type JobStatus,
} from "../db/schema";
import { IMAGE_MODELS, VIDEO_MODELS } from "../providers/models";
import { toJobDTO } from "./jobs";

/** Numbers for the dashboard. */
export async function getOverview(ctx: AppContext) {
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const n = sql<number>`count(*)::int`;
  const [characterCount, activeCharacters, projectCount, generating, review, approved, failedJobs] = await Promise.all([
    count(ctx.db.select({ n }).from(characters).where(ne(characters.status, "archived"))),
    count(ctx.db.select({ n }).from(characters).where(eq(characters.status, "active"))),
    count(ctx.db.select({ n }).from(contentProjects)),
    count(ctx.db.select({ n }).from(generationJobs).where(inArray(generationJobs.status, ["queued", "generating"]))),
    count(ctx.db.select({ n }).from(storyboardScenes).where(eq(storyboardScenes.videoStatus, "ready_for_review"))),
    count(ctx.db.select({ n }).from(storyboardScenes).where(eq(storyboardScenes.videoStatus, "approved"))),
    count(ctx.db.select({ n }).from(generationJobs).where(eq(generationJobs.status, "failed"))),
  ]);
  const recentJobs = await ctx.db.select().from(generationJobs).orderBy(desc(generationJobs.createdAt)).limit(8);
  return {
    counts: { characterCount, activeCharacters, projectCount, generating, review, approved, failedJobs },
    recentJobs: recentJobs.map((j) => toJobDTO(j)),
  };
}

export async function listJobs(
  ctx: AppContext,
  f: { kind?: JobKind; status?: JobStatus; characterId?: string; search?: string; limit?: number },
) {
  const where: SQL[] = [];
  if (f.kind) where.push(eq(generationJobs.kind, f.kind));
  if (f.status) where.push(eq(generationJobs.status, f.status));
  if (f.characterId) where.push(eq(generationJobs.characterId, f.characterId));
  if (f.search) where.push(ilike(generationJobs.prompt, `%${f.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`));
  const jobs = await ctx.db
    .select({ job: generationJobs, characterName: characters.name })
    .from(generationJobs)
    .leftJoin(characters, eq(generationJobs.characterId, characters.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(generationJobs.createdAt))
    .limit(Math.min(f.limit ?? 100, 200));
  const ids = jobs.map((j) => j.job.id);
  const outputs = ids.length ? await ctx.db.select().from(mediaAssets).where(inArray(mediaAssets.jobId, ids)) : [];
  const events = ids.length
    ? await ctx.db
        .select()
        .from(statusEvents)
        .where(and(eq(statusEvents.entityType, "job"), inArray(statusEvents.entityId, ids)))
        .orderBy(statusEvents.createdAt)
    : [];
  return jobs.map(({ job, characterName }) => ({
    ...toJobDTO(job, outputs.filter((o) => o.jobId === job.id)),
    characterName,
    history: events
      .filter((e) => e.entityId === job.id)
      .map((e) => ({ from: e.fromStatus, to: e.toStatus, message: e.message, at: e.createdAt.toISOString() })),
  }));
}

/** What is configured — booleans only, never the key values. */
export function getProviderStatus(ctx: AppContext) {
  const imageModel = IMAGE_MODELS.find((m) => m.id === ctx.settings.imageModel) ?? null;
  const videoModel = VIDEO_MODELS.find((m) => m.id === ctx.settings.videoModel) ?? null;
  const imageReady = !!imageModel && ctx.providers.image.isConfigured(imageModel.id);
  const videoReady = !!videoModel && ctx.providers.video.isConfigured(videoModel.id);
  return {
    login: { configured: authConfigProblem() === null, problem: authConfigProblem() },
    /** Can the DEFAULT image/video models run right now? */
    generation: {
      configured: imageReady && videoReady,
      imageReady,
      videoReady,
      imageModel: ctx.settings.imageModel,
      videoModel: ctx.settings.videoModel,
      imageModelLabel: imageModel?.label ?? null,
      videoModelLabel: videoModel?.label ?? null,
      problem: !imageModel
        ? `IMAGE_MODEL "${ctx.settings.imageModel}" is not a supported model.`
        : !videoModel
          ? `VIDEO_MODEL "${ctx.settings.videoModel}" is not a supported model.`
          : !imageReady || !videoReady
            ? "The default model is a paid fal.ai model, but fal.ai isn't set up. Remove IMAGE_MODEL / VIDEO_MODEL from .env.local to use the free models."
            : null,
    },
    huggingface: {
      configured: true,
      tokenSet: !!env.hfToken(),
      problem: apiKeyProblem("HF_TOKEN"),
    },
    fal: {
      configured: !!env.falKey(),
      problem: apiKeyProblem("FAL_KEY"),
    },
    anthropic: {
      configured: ctx.providers.analyzer.isConfigured(),
      problem: apiKeyProblem("ANTHROPIC_API_KEY"),
      model: ctx.providers.analyzer.model,
    },
    database: env.databaseUrl() ? "PostgreSQL server (DATABASE_URL)" : "Embedded PostgreSQL (PGlite) in ./data/pglite",
    storage: "Private local folder (./storage by default)",
    defaults: DEFAULT_MODELS,
    imageModels: IMAGE_MODELS.map((m) => ({ ...m, ready: ctx.providers.image.isConfigured(m.id) })),
    videoModels: VIDEO_MODELS.map((m) => ({ ...m, ready: ctx.providers.video.isConfigured(m.id) })),
  };
}
