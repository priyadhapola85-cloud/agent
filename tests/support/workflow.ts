import { processJobsOnce } from "@/lib/services/jobs";
import {
  approveReference,
  createCharacter,
  generateCandidates,
  getCharacterDetail,
  updateCharacter,
  uploadSourceReference,
} from "@/lib/services/characters";
import { createProject, planProject } from "@/lib/services/content";
import { fakePng, key, type TestHarness } from "./fakes";

/** Runs the worker until no queued/generating jobs remain (max N passes). */
export async function drainJobs(h: TestHarness, passes = 5) {
  for (let i = 0; i < passes; i++) await processJobsOnce(h.ctx);
}

/** Builds a character all the way to "active" (approved master) using fakes. */
export async function makeActiveCharacter(h: TestHarness, name = "Ava Laurent") {
  const c = await createCharacter(h.ctx, {
    name,
    description: "",
    identity: { fictionalAge: 25 },
    style: { niche: "luxury" },
  });
  await uploadSourceReference(h.ctx, c.id, { data: fakePng(), filename: "ref.png" }, true);
  await updateCharacter(h.ctx, c.id, { markReviewed: true, identity: { hair: "long auburn waves" } });
  await generateCandidates(h.ctx, c.id, { numImages: 2, aspectRatio: "3:4", resolution: "1K", idempotencyKey: key() });
  await drainJobs(h);
  const detail = await getCharacterDetail(h.ctx, c.id);
  const master = detail.candidates[0];
  await approveReference(h.ctx, c.id, { assetId: master.id, role: "master" });
  return { character: c, masterAssetId: master.id, detail: await getCharacterDetail(h.ctx, c.id) };
}

/** Character + project + template storyboard with one scene ready for images. */
export async function makePlannedProject(h: TestHarness) {
  const { character, masterAssetId } = await makeActiveCharacter(h);
  const project = await createProject(h.ctx, {
    characterId: character.id,
    title: "Autumn Luxe",
    brief: { theme: "Autumn luxury knitwear", durationSeconds: 5, aspectRatio: "9:16", outfit: "camel wool coat" },
  });
  const detail = await planProject(h.ctx, project.id, { planner: "template", replaceExisting: false });
  return { character, masterAssetId, project, detail, scene: detail.scenes[0] };
}
