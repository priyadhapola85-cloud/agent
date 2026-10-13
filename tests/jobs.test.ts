import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { generationJobs, mediaAssets, statusEvents } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { generateCandidates, updateCharacter, uploadSourceReference, createCharacter } from "@/lib/services/characters";
import { generateSceneImages, generateSceneVideo, getScene, selectSceneImage } from "@/lib/services/content";
import { getJob, pollJob, processJobsOnce, retryJob } from "@/lib/services/jobs";
import { createHarness, fakePng, key, type TestHarness } from "./support/fakes";
import { drainJobs, makePlannedProject } from "./support/workflow";

let h: TestHarness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

async function readyCharacter() {
  const c = await createCharacter(h.ctx, { name: "Jobs", description: "", identity: {}, style: {} });
  await uploadSourceReference(h.ctx, c.id, { data: fakePng(), filename: "r.png" }, true);
  await updateCharacter(h.ctx, c.id, { markReviewed: true });
  return c;
}

const genArgs = () => ({ numImages: 2, aspectRatio: "3:4" as const, resolution: "1K" as const, idempotencyKey: key() });

describe("image provider success and failure (mock provider)", () => {
  it("success: queued → generating → completed, outputs saved privately with metadata", async () => {
    const c = await readyCharacter();
    h.image.statusSequence = [{ state: "queued", position: 2 }, { state: "running" }];
    const { job } = await generateCandidates(h.ctx, c.id, genArgs());

    await processJobsOnce(h.ctx); // submit + poll → queued
    expect((await getJob(h.ctx, job.id)).status).toBe("queued");
    expect((await getJob(h.ctx, job.id)).providerRequestId).toBe("fake_req_1");
    await processJobsOnce(h.ctx); // running
    expect((await getJob(h.ctx, job.id)).status).toBe("generating");
    await processJobsOnce(h.ctx); // completed
    const done = await getJob(h.ctx, job.id);
    expect(done.status).toBe("completed");
    expect(done.completedAt).not.toBeNull();

    const outputs = await h.ctx.db.select().from(mediaAssets).where(eq(mediaAssets.jobId, job.id));
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toMatchObject({ kind: "image", source: "generated", characterId: c.id, width: 768, height: 1024 });
    expect(await h.ctx.storage.exists(outputs[0].storageKey)).toBe(true);

    const history = await h.ctx.db.select().from(statusEvents).where(eq(statusEvents.entityId, job.id));
    expect(history.map((e) => e.toStatus)).toEqual(expect.arrayContaining(["queued", "generating", "completed"]));
  });

  it("permanent provider rejection fails the job with a friendly message and hides internal detail", async () => {
    const c = await readyCharacter();
    h.image.submitErrors = [
      new AppError("CONTENT_REFUSED", "fal.ai's safety filter declined this request.", { detail: "raw provider body xyz" }),
    ];
    const { job } = await generateCandidates(h.ctx, c.id, genArgs());
    await processJobsOnce(h.ctx);
    const failed = await getJob(h.ctx, job.id);
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("CONTENT_REFUSED");
    expect(failed.errorMessage).toContain("safety filter");
    expect(failed.errorDetail).toContain("raw provider body"); // stored for debugging (server side)
  });

  it("temporary errors (rate limit) are re-submitted automatically, then fail after 3 attempts", async () => {
    const c = await readyCharacter();
    const rl = () => new AppError("PROVIDER_RATE_LIMIT", "rate limited");
    h.image.submitErrors = [rl(), rl(), rl()];
    const { job } = await generateCandidates(h.ctx, c.id, genArgs());

    await processJobsOnce(h.ctx);
    let j = await getJob(h.ctx, job.id);
    expect(j.status).toBe("queued");
    expect(j.submitAttempts).toBe(1);
    expect(j.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    await processJobsOnce(h.ctx, new Date(Date.now() + 60_000));
    await processJobsOnce(h.ctx, new Date(Date.now() + 120_000));
    j = await getJob(h.ctx, job.id);
    expect(j.status).toBe("failed");
    expect(j.submitAttempts).toBe(3);
  });

  it("provider-reported failure and invalid results fail the job", async () => {
    const c = await readyCharacter();
    h.image.statusSequence = [{ state: "failed", message: "generation failed", detail: "boom" }];
    const { job } = await generateCandidates(h.ctx, c.id, genArgs());
    await drainJobs(h);
    expect((await getJob(h.ctx, job.id)).status).toBe("failed");

    h.image.resultError = new AppError("PROVIDER_INVALID_RESPONSE", "fal.ai returned a response without images.");
    const { job: job2 } = await generateCandidates(h.ctx, c.id, genArgs());
    await drainJobs(h);
    const j2 = await getJob(h.ctx, job2.id);
    expect(j2.status).toBe("failed");
    expect(j2.errorCode).toBe("PROVIDER_INVALID_RESPONSE");
  });

  it("missing API credentials: generation is refused up front, nothing is queued", async () => {
    const c = await readyCharacter();
    h.image.configured = false;
    await expect(generateCandidates(h.ctx, c.id, genArgs())).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await h.ctx.db.select().from(generationJobs)).toHaveLength(0);
  });

  it("credentials removed after queuing: the job fails with setup instructions", async () => {
    const c = await readyCharacter();
    const { job } = await generateCandidates(h.ctx, c.id, genArgs());
    h.image.configured = false;
    await processJobsOnce(h.ctx);
    const j = await getJob(h.ctx, job.id);
    expect(j.status).toBe("failed");
    expect(j.errorMessage).toMatch(/FAL_KEY/);
  });

  it("the same idempotency key twice creates only one job (double-click protection)", async () => {
    const c = await readyCharacter();
    const args = genArgs();
    const a = await generateCandidates(h.ctx, c.id, args);
    const b = await generateCandidates(h.ctx, c.id, args);
    expect(b.duplicate).toBe(true);
    expect(b.job.id).toBe(a.job.id);
    const [x, y] = await Promise.all([
      generateCandidates(h.ctx, c.id, { ...args, idempotencyKey: "same-key-race-1" }),
      generateCandidates(h.ctx, c.id, { ...args, idempotencyKey: "same-key-race-1" }),
    ]);
    expect(x.job.id).toBe(y.job.id);
    expect(await h.ctx.db.select().from(generationJobs)).toHaveLength(2);
  });
});

describe("retry behaviour", () => {
  it("retry of a failed job creates a new linked job; completed jobs cannot be retried", async () => {
    const c = await readyCharacter();
    h.image.submitErrors = [new AppError("PROVIDER_REJECTED", "nope")];
    const { job } = await generateCandidates(h.ctx, c.id, genArgs());
    await processJobsOnce(h.ctx);
    expect((await getJob(h.ctx, job.id)).status).toBe("failed");

    const k = key();
    const { job: retry } = await retryJob(h.ctx, job.id, k);
    expect(retry.retryOfJobId).toBe(job.id);
    expect(retry.prompt).toBe((await getJob(h.ctx, job.id)).prompt);
    const again = await retryJob(h.ctx, job.id, k); // double click
    expect(again.job.id).toBe(retry.id);

    await drainJobs(h);
    expect((await getJob(h.ctx, retry.id)).status).toBe("completed");
    await expect(retryJob(h.ctx, retry.id, key())).rejects.toThrow(/Only failed jobs/);
  });

  it("retry is refused up front when the provider is not configured", async () => {
    const c = await readyCharacter();
    h.image.submitErrors = [new AppError("PROVIDER_REJECTED", "nope")];
    const { job } = await generateCandidates(h.ctx, c.id, genArgs());
    await processJobsOnce(h.ctx);
    h.image.configured = false;
    await expect(retryJob(h.ctx, job.id, key())).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await h.ctx.db.select().from(generationJobs)).toHaveLength(1);
  });
});

describe("video job status transitions", () => {
  it("draft → generating → ready_for_review, video stored and linked to the scene", async () => {
    const { scene, masterAssetId } = await makePlannedProject(h);
    expect(scene.videoStatus).toBe("draft");
    await selectSceneImage(h.ctx, scene.id, masterAssetId); // approved reference as start frame
    h.video.statusSequence = [{ state: "queued" }, { state: "running" }];

    const { job } = await generateSceneVideo(h.ctx, scene.id, { generateAudio: false, idempotencyKey: key() });
    expect((await getScene(h.ctx, scene.id)).videoStatus).toBe("generating");
    await processJobsOnce(h.ctx);
    await processJobsOnce(h.ctx);
    expect((await getJob(h.ctx, job.id)).status).toBe("generating");
    await processJobsOnce(h.ctx);

    const s = await getScene(h.ctx, scene.id);
    expect(s.videoStatus).toBe("ready_for_review");
    expect(s.currentVideoAssetId).toBeTruthy();
    expect(h.video.submitted[0]).toMatchObject({ durationSeconds: 5, generateAudio: false, model: "fal-ai/kling-video/v2.6/pro/image-to-video" });
    expect(h.video.submitted[0].startImage.mimeType).toBe("image/png");
  });

  it("validates duration against the model, refuses a second concurrent video, and needs a start frame", async () => {
    const { scene, masterAssetId } = await makePlannedProject(h);
    await expect(generateSceneVideo(h.ctx, scene.id, { generateAudio: false, idempotencyKey: key() })).rejects.toThrow(
      /start frame/,
    );
    await expect(
      generateSceneVideo(h.ctx, scene.id, { startAssetId: masterAssetId, durationSeconds: 7, generateAudio: false, idempotencyKey: key() }),
    ).rejects.toThrow(/5, 10 seconds/);
    await generateSceneVideo(h.ctx, scene.id, { startAssetId: masterAssetId, generateAudio: false, idempotencyKey: key() });
    await expect(
      generateSceneVideo(h.ctx, scene.id, { startAssetId: masterAssetId, generateAudio: false, idempotencyKey: key() }),
    ).rejects.toThrow(/already generating/);
  });

  it("failure → scene 'failed'; deliberate retry → generating again → ready", async () => {
    const { scene, masterAssetId } = await makePlannedProject(h);
    h.video.statusSequence = [{ state: "failed", message: "fal.ai reported that the generation failed." }];
    const { job } = await generateSceneVideo(h.ctx, scene.id, { startAssetId: masterAssetId, generateAudio: false, idempotencyKey: key() });
    await drainJobs(h);
    expect((await getScene(h.ctx, scene.id)).videoStatus).toBe("failed");

    await retryJob(h.ctx, job.id, key());
    expect((await getScene(h.ctx, scene.id)).videoStatus).toBe("generating");
    await drainJobs(h);
    expect((await getScene(h.ctx, scene.id)).videoStatus).toBe("ready_for_review");
  });

  it("times out jobs that run too long", async () => {
    const { scene, masterAssetId } = await makePlannedProject(h);
    h.video.statusSequence = Array(10).fill({ state: "running" });
    const { job } = await generateSceneVideo(h.ctx, scene.id, { startAssetId: masterAssetId, generateAudio: false, idempotencyKey: key() });
    await processJobsOnce(h.ctx);
    const j = await getJob(h.ctx, job.id);
    await pollJob(h.ctx, j, Date.now() + 31 * 60_000);
    const timedOut = await getJob(h.ctx, job.id);
    expect(timedOut.status).toBe("failed");
    expect(timedOut.errorCode).toBe("PROVIDER_TIMEOUT");
    expect((await getScene(h.ctx, scene.id)).videoStatus).toBe("failed");
  });

  it("temporary status-check errors don't fail the job", async () => {
    const { scene, masterAssetId } = await makePlannedProject(h);
    await generateSceneVideo(h.ctx, scene.id, { startAssetId: masterAssetId, generateAudio: false, idempotencyKey: key() });
    h.video.statusError = new AppError("PROVIDER_UNAVAILABLE", "down");
    await processJobsOnce(h.ctx);
    await processJobsOnce(h.ctx);
    expect((await getScene(h.ctx, scene.id)).videoStatus).toBe("generating");
    h.video.statusError = null;
    await processJobsOnce(h.ctx);
    expect((await getScene(h.ctx, scene.id)).videoStatus).toBe("ready_for_review");
  });
});

describe("scene images reuse the approved character references", () => {
  it("sends the master reference first and the campaign details in the prompt", async () => {
    const { scene, masterAssetId } = await makePlannedProject(h);
    const before = h.image.submitted.length;
    const { job } = await generateSceneImages(h.ctx, scene.id, { numImages: 2, resolution: "1K", idempotencyKey: key() });
    await drainJobs(h);
    const j = await getJob(h.ctx, job.id);
    expect(j.referenceAssetIds[0]).toBe(masterAssetId);
    expect(j.params).toMatchObject({ aspectRatio: "9:16" });
    expect(j.prompt).toContain("camel wool coat");
    expect(j.prompt).toContain("IDENTITY:");
    expect(h.image.submitted.length).toBe(before + 1);
    expect(j.status).toBe("completed");
  });
});
