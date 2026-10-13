import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import {
  generationJobs,
  mediaAssets,
  storyboardScenes,
  type GenerationJob,
  type JobPurpose,
  type JobStatus,
} from "../db/schema";
import { AppError, notFound } from "../errors";
import { newId } from "../ids";
import { log } from "../logger";
import { MAX_GENERATED_IMAGE_BYTES, MAX_GENERATED_VIDEO_BYTES } from "../media/media-type";
import { getAsset, readAssetData, saveAsset, toAssetDTO } from "./assets";
import { recordEvent } from "./events";
import { transitionVideoStatus } from "./lifecycle";

/**
 * GENERATION JOBS
 *
 * Image and video generation take from seconds to minutes, so we never make
 * the browser wait. Instead:
 *   1. An API call creates a job row with status "queued".
 *   2. The background worker (src/lib/jobs/worker.ts) submits it to the provider.
 *   3. The worker polls the provider until it is done ("generating" while running).
 *   4. Outputs are downloaded into private storage → status "completed".
 *   5. Anything that goes wrong → status "failed" with a friendly message.
 *      The user can deliberately press Retry, which creates a NEW job.
 *
 * Duplicate protection: every create request carries an idempotency key.
 * The same key twice returns the same job instead of paying for two.
 */

const MAX_SUBMIT_ATTEMPTS = 3;
const ACTIVE: JobStatus[] = ["queued", "generating"];

export type JobDTO = Omit<GenerationJob, "errorDetail" | "createdAt" | "updatedAt" | "submittedAt" | "completedAt" | "nextAttemptAt"> & {
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  outputs: ReturnType<typeof toAssetDTO>[];
};

/** Removes internal error detail before a job is sent to the browser. */
export function toJobDTO(job: GenerationJob, outputs: (typeof mediaAssets.$inferSelect)[] = []): JobDTO {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { errorDetail, nextAttemptAt, ...rest } = job;
  return {
    ...rest,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    submittedAt: job.submittedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    outputs: outputs.map(toAssetDTO),
  };
}

export async function getJob(ctx: AppContext, id: string): Promise<GenerationJob> {
  const [job] = await ctx.db.select().from(generationJobs).where(eq(generationJobs.id, id));
  if (!job) throw notFound("Job");
  return job;
}

export async function getJobWithOutputs(ctx: AppContext, id: string): Promise<JobDTO> {
  const job = await getJob(ctx, id);
  const outputs = await ctx.db.select().from(mediaAssets).where(eq(mediaAssets.jobId, id));
  return toJobDTO(job, outputs);
}

export type NewJob = {
  kind: GenerationJob["kind"];
  purpose: JobPurpose;
  characterId?: string | null;
  projectId?: string | null;
  sceneId?: string | null;
  provider: string;
  model: string;
  prompt: string;
  negativePrompt?: string | null;
  params: Record<string, unknown>;
  referenceAssetIds: string[];
  inputAssetId?: string | null;
  idempotencyKey: string;
  retryOfJobId?: string | null;
};

async function findByKey(ctx: AppContext, key: string) {
  const [existing] = await ctx.db.select().from(generationJobs).where(eq(generationJobs.idempotencyKey, key));
  return existing ?? null;
}

/**
 * Creates a queued job, or returns the existing one if this idempotency key
 * was already used (double-click / network retry protection).
 */
export async function createJob(ctx: AppContext, input: NewJob): Promise<{ job: GenerationJob; duplicate: boolean }> {
  const existing = await findByKey(ctx, input.idempotencyKey);
  if (existing) return { job: assertSameRequest(existing, input), duplicate: true };
  try {
    const [job] = await ctx.db
      .insert(generationJobs)
      .values({
        id: newId("job"),
        status: "queued",
        ...input,
      })
      .returning();
    await recordEvent(ctx.db, "job", job.id, null, "queued", `${job.kind} job created (${job.purpose})`);
    return { job, duplicate: false };
  } catch (err) {
    // Two identical requests raced each other: the unique index caught it.
    const raced = await findByKey(ctx, input.idempotencyKey);
    if (raced) return { job: assertSameRequest(raced, input), duplicate: true };
    throw err;
  }
}

function assertSameRequest(existing: GenerationJob, input: NewJob) {
  if (existing.purpose !== input.purpose || (existing.sceneId ?? null) !== (input.sceneId ?? null) || (existing.characterId ?? null) !== (input.characterId ?? null))
    throw new AppError("CONFLICT", "This request key was already used for a different job.", {
      action: "Refresh the page and try again.",
    });
  return existing;
}

export async function hasActiveVideoJob(ctx: AppContext, sceneId: string) {
  const rows = await ctx.db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(
      and(eq(generationJobs.sceneId, sceneId), eq(generationJobs.kind, "video"), inArray(generationJobs.status, ACTIVE)),
    );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Retry (always a deliberate user action)
// ---------------------------------------------------------------------------

export async function retryJob(ctx: AppContext, jobId: string, idempotencyKey: string) {
  const original = await getJob(ctx, jobId);
  const existingRetry = await findByKey(ctx, idempotencyKey);
  if (existingRetry) return { job: existingRetry, duplicate: true };
  if (!["failed", "canceled"].includes(original.status))
    throw new AppError("CONFLICT", "Only failed jobs can be retried.", {
      action: original.status === "completed" ? "Use Regenerate to create a new version instead." : "Wait for the job to finish.",
    });
  if (!providerFor(ctx, original).isConfigured(original.model))
    throw new AppError("NOT_CONFIGURED", `${original.kind === "image" ? "Image" : "Video"} generation is not configured.`, {
      action: "Add FAL_KEY to .env.local and restart the app, then press Retry.",
    });
  if (original.kind === "video" && original.sceneId && (await hasActiveVideoJob(ctx, original.sceneId)))
    throw new AppError("CONFLICT", "A video is already generating for this scene.");

  const result = await createJob(ctx, {
    kind: original.kind,
    purpose: original.purpose,
    characterId: original.characterId,
    projectId: original.projectId,
    sceneId: original.sceneId,
    provider: original.provider,
    model: original.model,
    prompt: original.prompt,
    negativePrompt: original.negativePrompt,
    params: original.params,
    referenceAssetIds: original.referenceAssetIds,
    inputAssetId: original.inputAssetId,
    idempotencyKey,
    retryOfJobId: original.id,
  });
  if (!result.duplicate && original.purpose === "scene_video" && original.sceneId)
    await transitionVideoStatus(ctx, original.sceneId, "start_generation", "Retry of failed video job");
  return result;
}

// ---------------------------------------------------------------------------
// Worker steps
// ---------------------------------------------------------------------------

function providerFor(ctx: AppContext, job: GenerationJob) {
  return job.kind === "image" ? ctx.providers.image : ctx.providers.video;
}

async function setStatus(ctx: AppContext, job: GenerationJob, to: JobStatus, patch: Partial<GenerationJob> = {}, message = "") {
  // Conditional update: only moves forward if nobody else changed the job meanwhile.
  const [updated] = await ctx.db
    .update(generationJobs)
    .set({ ...patch, status: to, updatedAt: new Date() })
    .where(and(eq(generationJobs.id, job.id), eq(generationJobs.status, job.status)))
    .returning();
  if (updated && job.status !== to) await recordEvent(ctx.db, "job", job.id, job.status, to, message);
  return updated ?? null;
}

async function failJob(ctx: AppContext, job: GenerationJob, err: AppError) {
  const updated = await setStatus(
    ctx,
    job,
    "failed",
    {
      submitAttempts: job.submitAttempts,
      errorCode: err.code,
      errorMessage: err.action ? `${err.message} ${err.action}` : err.message,
      errorDetail: err.detail ?? null,
      completedAt: new Date(),
    },
    err.message,
  );
  if (updated && job.purpose === "scene_video" && job.sceneId) {
    await transitionVideoStatus(ctx, job.sceneId, "generation_failed", err.message);
  }
  log.warn(`Job ${job.id} failed: ${err.code} ${err.message}`, err.detail);
}

/** Step 2: send a queued job to the provider. */
export async function submitJob(ctx: AppContext, job: GenerationJob) {
  const provider = providerFor(ctx, job);
  const attempts = job.submitAttempts + 1;
  try {
    if (!provider.isConfigured(job.model))
      throw new AppError("NOT_CONFIGURED", `${job.kind === "image" ? "Image" : "Video"} generation is not configured.`, {
        action: "Add FAL_KEY to .env.local, restart the app, then press Retry.",
        retryable: false,
      });

    let handle;
    if (job.kind === "image") {
      const references = [];
      for (const id of job.referenceAssetIds) {
        const asset = await getAsset(ctx, id);
        references.push({ data: await readAssetData(ctx, asset), mimeType: asset.mimeType });
      }
      const p = job.params as { numImages: number; aspectRatio: string; resolution: "1K" | "2K" | "4K"; seed?: number };
      handle = await ctx.providers.image.submit({
        model: job.model,
        prompt: job.prompt,
        references,
        numImages: p.numImages,
        aspectRatio: p.aspectRatio,
        resolution: p.resolution,
        seed: p.seed,
      });
    } else {
      if (!job.inputAssetId) throw new AppError("VALIDATION", "This video job has no start image.", { retryable: false });
      const start = await getAsset(ctx, job.inputAssetId);
      const p = job.params as { durationSeconds: number; generateAudio: boolean };
      handle = await ctx.providers.video.submit({
        model: job.model,
        prompt: job.prompt,
        negativePrompt: job.negativePrompt ?? undefined,
        startImage: { data: await readAssetData(ctx, start), mimeType: start.mimeType },
        durationSeconds: p.durationSeconds,
        generateAudio: p.generateAudio,
      });
    }

    await ctx.db
      .update(generationJobs)
      .set({
        providerRequestId: handle.requestId,
        submittedAt: new Date(),
        submitAttempts: attempts,
        nextAttemptAt: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, job.id));
    await recordEvent(ctx.db, "job", job.id, "queued", "queued", `Submitted to ${job.provider} (${job.model})`);
  } catch (raw) {
    const err = raw instanceof AppError ? raw : new AppError("INTERNAL", "Could not submit the job.", { detail: String(raw) });
    if (err.retryable && attempts < MAX_SUBMIT_ATTEMPTS) {
      // Temporary problem (rate limit, provider hiccup): try again automatically
      // a little later. This is NOT a new paid generation — nothing was accepted.
      const delayMs = 15_000 * attempts;
      await ctx.db
        .update(generationJobs)
        .set({
          submitAttempts: attempts,
          nextAttemptAt: new Date(Date.now() + delayMs),
          errorCode: err.code,
          errorMessage: `${err.message} Trying again automatically (attempt ${attempts + 1} of ${MAX_SUBMIT_ATTEMPTS}).`,
          errorDetail: err.detail ?? null,
          updatedAt: new Date(),
        })
        .where(eq(generationJobs.id, job.id));
      log.warn(`Job ${job.id} submit failed (attempt ${attempts}), will retry`, err.detail);
      return;
    }
    await failJob(ctx, { ...job, submitAttempts: attempts }, err);
  }
}

/** Step 3/4: ask the provider how the job is doing; save outputs when done. */
export async function pollJob(ctx: AppContext, job: GenerationJob, now = Date.now()) {
  const timeoutMs = job.kind === "image" ? ctx.settings.imageTimeoutMs : ctx.settings.videoTimeoutMs;
  const startedAt = (job.submittedAt ?? job.createdAt).getTime();
  if (now - startedAt > timeoutMs) {
    await failJob(
      ctx,
      job,
      new AppError("PROVIDER_TIMEOUT", `The provider did not finish within ${Math.round(timeoutMs / 60_000)} minutes.`, {
        action: "Press Retry to try again. Check your fal.ai dashboard in case it finished late.",
      }),
    );
    return;
  }

  const provider = providerFor(ctx, job);
  const handle = { requestId: job.providerRequestId! };
  let state;
  try {
    state = await provider.status(job.model, handle);
  } catch (raw) {
    const err = raw instanceof AppError ? raw : new AppError("INTERNAL", "Status check failed.", { detail: String(raw) });
    if (err.retryable) {
      log.warn(`Status check for job ${job.id} failed temporarily; will check again`, err.detail);
      return;
    }
    await failJob(ctx, job, err);
    return;
  }

  if (state.state === "queued") return;
  if (state.state === "running") {
    if (job.status === "queued") await setStatus(ctx, job, "generating", {}, "Provider started generating");
    return;
  }
  if (state.state === "failed") {
    await failJob(ctx, job, new AppError("PROVIDER_REJECTED", state.message, { detail: state.detail, action: "Adjust the prompt or image and press Retry." }));
    return;
  }

  // Completed: claim the job so a second worker tick can't process it twice.
  const claimed =
    job.status === "generating" ? job : await setStatus(ctx, job, "generating", {}, "Provider finished; saving outputs");
  if (!claimed) return;
  await finalizeJob(ctx, claimed);
}

async function finalizeJob(ctx: AppContext, job: GenerationJob) {
  const provider = providerFor(ctx, job);
  try {
    const files = await provider.result(job.model, { requestId: job.providerRequestId! });
    if (files.length === 0) throw new AppError("PROVIDER_INVALID_RESPONSE", "The provider returned no files.");

    const saved = [];
    for (const file of files) {
      const { data, mimeType } = await provider.download(
        file,
        job.kind === "image" ? MAX_GENERATED_IMAGE_BYTES : MAX_GENERATED_VIDEO_BYTES,
      );
      const isVideo = mimeType.startsWith("video/");
      if (isVideo !== (job.kind === "video"))
        throw new AppError("PROVIDER_INVALID_RESPONSE", "The provider returned the wrong kind of file.", { detail: mimeType });
      saved.push(
        await saveAsset(ctx, {
          data,
          mimeType,
          kind: job.kind,
          source: "generated",
          characterId: job.characterId,
          projectId: job.projectId,
          sceneId: job.sceneId,
          jobId: job.id,
          width: file.width,
          height: file.height,
        }),
      );
    }

    const updated = await setStatus(ctx, job, "completed", { completedAt: new Date(), errorCode: null, errorMessage: null }, `${saved.length} output(s) saved`);
    if (updated && job.purpose === "scene_video" && job.sceneId) {
      await ctx.db
        .update(storyboardScenes)
        .set({ currentVideoAssetId: saved[0].id, updatedAt: new Date() })
        .where(eq(storyboardScenes.id, job.sceneId));
      await transitionVideoStatus(ctx, job.sceneId, "generation_succeeded", "New video ready for review");
    }
  } catch (raw) {
    const err =
      raw instanceof AppError ? raw : new AppError("INTERNAL", "Saving the generated output failed.", { detail: String(raw) });
    await failJob(ctx, job, err);
  }
}

/** One pass of the background worker over all unfinished jobs. */
export async function processJobsOnce(ctx: AppContext, now = new Date()) {
  const toSubmit = await ctx.db
    .select()
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.status, "queued"),
        isNull(generationJobs.providerRequestId),
        or(isNull(generationJobs.nextAttemptAt), lte(generationJobs.nextAttemptAt, now)),
      ),
    )
    .orderBy(generationJobs.createdAt)
    .limit(5);
  for (const job of toSubmit) await submitJob(ctx, job);

  const toPoll = await ctx.db
    .select()
    .from(generationJobs)
    .where(and(inArray(generationJobs.status, ACTIVE), isNotNull(generationJobs.providerRequestId)))
    .orderBy(generationJobs.createdAt)
    .limit(20);
  for (const job of toPoll) await pollJob(ctx, job, now.getTime());

  return { submitted: toSubmit.length, polled: toPoll.length };
}

export async function countActiveJobs(ctx: AppContext) {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(generationJobs)
    .where(inArray(generationJobs.status, ACTIVE));
  return row?.n ?? 0;
}
