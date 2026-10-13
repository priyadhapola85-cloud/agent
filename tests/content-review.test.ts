import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { approvals } from "@/lib/db/schema";
import {
  addScene,
  createProject,
  deleteProject,
  generateSceneVideo,
  getExport,
  getProjectDetail,
  getScene,
  planProject,
  reviewQueue,
  reviewSceneVideo,
  updateProject,
  updateScene,
} from "@/lib/services/content";
import { createCharacter } from "@/lib/services/characters";
import { isExportable } from "@/lib/services/lifecycle";
import { createHarness, key, type TestHarness } from "./support/fakes";
import { drainJobs, makeActiveCharacter, makePlannedProject } from "./support/workflow";

let h: TestHarness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

async function sceneWithVideo() {
  const setup = await makePlannedProject(h);
  await generateSceneVideo(h.ctx, setup.scene.id, { startAssetId: setup.masterAssetId, generateAudio: false, idempotencyKey: key() });
  await drainJobs(h);
  return setup;
}

describe("content planning", () => {
  it("needs a character with an approved master", async () => {
    const c = await createCharacter(h.ctx, { name: "No master", description: "", identity: {}, style: {} });
    await expect(
      createProject(h.ctx, { characterId: c.id, title: "x", brief: { theme: "t", durationSeconds: 5, aspectRatio: "9:16" } }),
    ).rejects.toThrow(/master reference/);
  });

  it("template planner writes an editable concept/storyboard and starts no generation", async () => {
    const { detail } = await makePlannedProject(h);
    const imageCallsBefore = h.image.submitted.length;
    expect(detail.project.plannerSource).toBe("template");
    expect(detail.project.concept).toContain("camel wool coat");
    expect(detail.scenes.length).toBeGreaterThanOrEqual(1);
    for (const s of detail.scenes) {
      expect([5, 10]).toContain(s.durationSeconds); // only durations the video model supports
      expect(s.imagePrompt).not.toBe("");
      expect(s.videoPrompt).not.toBe("");
    }
    expect(detail.project.hashtags.every((t) => t.startsWith("#"))).toBe(true);
    expect(h.image.submitted.length).toBe(imageCallsBefore);
    expect(h.video.submitted.length).toBe(0);
  });

  it("splits a longer brief into several scenes", async () => {
    const { character } = await makeActiveCharacter(h);
    const p = await createProject(h.ctx, {
      characterId: character.id,
      title: "Long",
      brief: { theme: "Street", durationSeconds: 30, aspectRatio: "9:16" },
    });
    const d = await planProject(h.ctx, p.id, { planner: "template", replaceExisting: false });
    expect(d.scenes).toHaveLength(3);
    expect(d.scenes.every((s) => s.durationSeconds === 10)).toBe(true);
  });

  it("auto planner falls back to the template when Claude is not configured; explicit claude errors", async () => {
    const { project } = await makePlannedProject(h);
    await expect(planProject(h.ctx, project.id, { planner: "auto", replaceExisting: false })).rejects.toThrow(/already has a storyboard/);
    await expect(planProject(h.ctx, project.id, { planner: "claude", replaceExisting: true })).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    const d = await planProject(h.ctx, project.id, { planner: "auto", replaceExisting: true });
    expect(d.project.plannerSource).toBe("template");
  });

  it("everything stays editable", async () => {
    const { project, scene } = await makePlannedProject(h);
    await updateProject(h.ctx, project.id, { caption: "New caption", hashtags: ["#a", "#b"] });
    await updateScene(h.ctx, scene.id, { videoPrompt: "She spins slowly", durationSeconds: 10 });
    await addScene(h.ctx, project.id, { title: "Bonus", imagePrompt: "close-up of the bag" });
    const d = await getProjectDetail(h.ctx, project.id);
    expect(d.project.caption).toBe("New caption");
    expect(d.scenes.find((s) => s.id === scene.id)?.videoPrompt).toBe("She spins slowly");
    expect(d.scenes.at(-1)?.title).toBe("Bonus");
    expect(d.project.plannerSource).toBe("manual");
  });
});

describe("approval and rejection", () => {
  it("approve → exportable; reject → not exportable", async () => {
    const { scene } = await sceneWithVideo();
    expect((await getScene(h.ctx, scene.id)).videoStatus).toBe("ready_for_review");
    await expect(getExport(h.ctx, scene.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await reviewSceneVideo(h.ctx, scene.id, "approved", "Looks great");
    expect(await isExportable(h.ctx, scene.id)).toBe(true);
    const { filename, asset } = await getExport(h.ctx, scene.id);
    expect(filename).toBe("ava-laurent_autumn-luxe_scene-1.mp4");
    expect(asset.mimeType).toBe("video/mp4");

    await reviewSceneVideo(h.ctx, scene.id, "rejected", "Changed my mind");
    expect((await getScene(h.ctx, scene.id)).videoStatus).toBe("rejected");
    expect(await isExportable(h.ctx, scene.id)).toBe(false);
  });

  it("cannot approve something that has no finished video", async () => {
    const { scene } = await makePlannedProject(h);
    await expect(reviewSceneVideo(h.ctx, scene.id, "approved", "")).rejects.toThrow(/no video/);
  });

  it("review queue lists videos with character, concept and status", async () => {
    const { scene } = await sceneWithVideo();
    const items = await reviewQueue(h.ctx, "ready_for_review");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ characterName: "Ava Laurent", projectTitle: "Autumn Luxe" });
    expect(items[0].scene.id).toBe(scene.id);
    expect(items[0].video?.url).toMatch(/^\/api\/assets\/ast_/);
  });
});

describe("approval invalidation after regeneration", () => {
  it("regenerating an approved video clears the approval and needs a new review", async () => {
    const { scene, masterAssetId } = await sceneWithVideo();
    await reviewSceneVideo(h.ctx, scene.id, "approved", "");
    const firstVideo = (await getScene(h.ctx, scene.id)).currentVideoAssetId;

    await generateSceneVideo(h.ctx, scene.id, {
      startAssetId: masterAssetId,
      generateAudio: false,
      revisionNotes: "slower walk",
      idempotencyKey: key(),
    });
    expect((await getScene(h.ctx, scene.id)).videoStatus).toBe("generating");
    expect(await isExportable(h.ctx, scene.id)).toBe(false);
    const decisions = await h.ctx.db.select().from(approvals).where(eq(approvals.sceneId, scene.id));
    expect(decisions.map((d) => d.decision)).toEqual(expect.arrayContaining(["approved", "invalidated"]));

    await drainJobs(h);
    const after = await getScene(h.ctx, scene.id);
    expect(after.videoStatus).toBe("ready_for_review");
    expect(after.currentVideoAssetId).not.toBe(firstVideo);
    await expect(getExport(h.ctx, scene.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.video.submitted.at(-1)?.prompt).toContain("slower walk");
  });
});

describe("deleting", () => {
  it("deletes a project together with its scenes and media files", async () => {
    const { project, scene } = await sceneWithVideo();
    const video = (await getScene(h.ctx, scene.id)).currentVideoAssetId!;
    const detail = await getProjectDetail(h.ctx, project.id);
    const key0 = detail.scenes[0].currentVideo!.id;
    expect(key0).toBe(video);
    await deleteProject(h.ctx, project.id);
    await expect(getProjectDetail(h.ctx, project.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
