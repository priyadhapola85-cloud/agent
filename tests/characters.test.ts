import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { characterReferences, generationJobs } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  analyzeReference,
  approveReference,
  createCharacter,
  generateCandidates,
  getCharacter,
  getCharacterDetail,
  listCharacters,
  removeReference,
  setAssetReview,
  updateCharacter,
  updateReference,
  uploadSourceReference,
} from "@/lib/services/characters";
import { createHarness, fakePng, key, type TestHarness } from "./support/fakes";
import { drainJobs, makeActiveCharacter } from "./support/workflow";

let h: TestHarness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe("creating and saving a character", () => {
  it("creates a draft profile without any image and persists it", async () => {
    const c = await createCharacter(h.ctx, {
      name: "Mila Noor",
      description: "Warm, editorial",
      identity: { fictionalAge: 27, hair: "sleek black bob" },
      style: { niche: "editorial" },
    });
    expect(c.id).toMatch(/^chr_/);
    expect(c.status).toBe("draft");
    const reloaded = await getCharacter(h.ctx, c.id);
    expect(reloaded.identity.hair).toBe("sleek black bob");
    const list = await listCharacters(h.ctx, { search: "mila" });
    expect(list.map((x) => x.id)).toEqual([c.id]);
  });

  it("edits keep stable identity separate from changeable style; empty strings clear fields", async () => {
    const c = await createCharacter(h.ctx, { name: "A", description: "", identity: { face: "oval" }, style: { mood: "calm" } });
    await updateCharacter(h.ctx, c.id, { identity: { face: "", eyes: "hazel" }, style: { mood: "bold" } });
    const r = await getCharacter(h.ctx, c.id);
    expect(r.identity).toEqual({ eyes: "hazel" });
    expect(r.style).toEqual({ mood: "bold" });
  });

  it("archives and restores", async () => {
    const c = await createCharacter(h.ctx, { name: "Z", description: "", identity: {}, style: {} });
    await updateCharacter(h.ctx, c.id, { archived: true });
    expect((await getCharacter(h.ctx, c.id)).status).toBe("archived");
    expect(await listCharacters(h.ctx)).toHaveLength(0);
    await updateCharacter(h.ctx, c.id, { archived: false });
    expect((await getCharacter(h.ctx, c.id)).status).toBe("draft");
  });
});

describe("reference-first workflow", () => {
  it("does not allow generation before a reference is uploaded and reviewed", async () => {
    const c = await createCharacter(h.ctx, { name: "B", description: "", identity: {}, style: {} });
    const gen = () => generateCandidates(h.ctx, c.id, { numImages: 2, aspectRatio: "3:4", resolution: "1K", idempotencyKey: key() });
    await expect(gen()).rejects.toThrow(/Upload a reference/);

    await uploadSourceReference(h.ctx, c.id, { data: fakePng(), filename: "me.png" }, true);
    expect((await getCharacter(h.ctx, c.id)).status).toBe("reference_uploaded");
    await expect(gen()).rejects.toThrow(/Review the character description/);
    expect(h.image.submitted).toHaveLength(0); // nothing was sent to the provider

    await updateCharacter(h.ctx, c.id, { markReviewed: true });
    expect((await getCharacter(h.ctx, c.id)).status).toBe("ready_to_generate");
    const { job } = await gen();
    expect(job.status).toBe("queued");
  });

  it("requires the rights confirmation and a real image file", async () => {
    const c = await createCharacter(h.ctx, { name: "C", description: "", identity: {}, style: {} });
    await expect(uploadSourceReference(h.ctx, c.id, { data: fakePng(), filename: "x.png" }, false)).rejects.toThrow(/right to use/);
    await expect(
      uploadSourceReference(h.ctx, c.id, { data: Buffer.from("MZ this is an exe pretending to be png"), filename: "x.png" }, true),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
    await expect(uploadSourceReference(h.ctx, c.id, { data: fakePng(100, 100), filename: "tiny.png" }, true)).rejects.toThrow(
      /too small/,
    );
    const big = Buffer.concat([fakePng(), Buffer.alloc(6 * 1024 * 1024)]);
    await expect(uploadSourceReference(h.ctx, c.id, { data: big, filename: "big.png" }, true)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("analysis fills empty fields only (fill_empty) and stores the raw analysis", async () => {
    const c = await createCharacter(h.ctx, { name: "D", description: "", identity: { hair: "my own words" }, style: {} });
    await uploadSourceReference(h.ctx, c.id, { data: fakePng(), filename: "r.png" }, true);
    const updated = await analyzeReference(h.ctx, c.id, "fill_empty");
    expect(updated.identity.hair).toBe("my own words"); // user's text kept
    expect(updated.identity.face).toBe("oval face, high cheekbones");
    expect(updated.analysis?.model).toBe("fake-vision");
    expect(h.analyzer.calls[0].mimeType).toBe("image/png");
  });

  it("uploaded image is sent as a reference; approving a candidate makes it the master", async () => {
    const { character, masterAssetId, detail } = await makeActiveCharacter(h);
    expect(detail.character.status).toBe("active");
    const roles = detail.references.map((r) => r.role).sort();
    expect(roles).toEqual(["master", "source"]);

    // The candidate request used the uploaded source image as reference
    expect(h.image.submitted[0].references).toHaveLength(1);
    const [job] = await h.ctx.db.select().from(generationJobs).where(eq(generationJobs.characterId, character.id));
    expect(job.referenceAssetIds).toHaveLength(1);
    expect(job.prompt).toContain("long auburn waves");

    // Second generation now sends master first, then the source
    await generateCandidates(h.ctx, character.id, { numImages: 1, aspectRatio: "3:4", resolution: "1K", idempotencyKey: key() });
    const jobs = await h.ctx.db.select().from(generationJobs).where(eq(generationJobs.characterId, character.id));
    const second = jobs.find((j) => j.id !== job.id)!;
    expect(second.referenceAssetIds[0]).toBe(masterAssetId);
    expect(second.referenceAssetIds).toHaveLength(2);
  });

  it("allows only one master; promoting another demotes the old one", async () => {
    const { character, masterAssetId, detail } = await makeActiveCharacter(h);
    const other = detail.candidates.find((c) => c.id !== masterAssetId)!;
    await approveReference(h.ctx, character.id, { assetId: other.id, role: "master" });
    const refs = await h.ctx.db.select().from(characterReferences).where(eq(characterReferences.characterId, character.id));
    expect(refs.filter((r) => r.role === "master").map((r) => r.assetId)).toEqual([other.id]);
    expect(refs.find((r) => r.assetId === masterAssetId)?.role).toBe("approved");
  });

  it("an uploaded photo cannot itself become the master", async () => {
    const { character, detail } = await makeActiveCharacter(h);
    const source = detail.references.find((r) => r.role === "source")!;
    await expect(approveReference(h.ctx, character.id, { assetId: source.asset.id, role: "master" })).rejects.toThrow(
      /generated candidate/,
    );
  });

  it("rejects inconsistent candidates, but not approved references", async () => {
    const { masterAssetId, detail } = await makeActiveCharacter(h);
    const other = detail.candidates.find((c) => c.id !== masterAssetId)!;
    const rejected = await setAssetReview(h.ctx, other.id, "rejected", "different nose");
    expect(rejected.reviewStatus).toBe("rejected");
    await expect(setAssetReview(h.ctx, masterAssetId, "rejected", "")).rejects.toBeInstanceOf(AppError);
  });

  it("removing the master returns the character to ready_to_generate; disabled refs are not sent", async () => {
    const { character, detail } = await makeActiveCharacter(h);
    const source = detail.references.find((r) => r.role === "source")!;
    const master = detail.references.find((r) => r.role === "master")!;
    await updateReference(h.ctx, character.id, source.id, { useForGeneration: false });
    await removeReference(h.ctx, character.id, master.id);
    expect((await getCharacter(h.ctx, character.id)).status).toBe("ready_to_generate");
    await expect(
      generateCandidates(h.ctx, character.id, { numImages: 1, aspectRatio: "3:4", resolution: "1K", idempotencyKey: key() }),
    ).rejects.toThrow(/No reference images are enabled/);
  });

  it("keeps generation history with prompt, provider, model and outputs", async () => {
    const { character } = await makeActiveCharacter(h);
    await drainJobs(h);
    const detail = await getCharacterDetail(h.ctx, character.id);
    const job = detail.jobs[0];
    expect(job).toMatchObject({ provider: "fal", model: "fal-ai/nano-banana-pro/edit", status: "completed" });
    expect(job.prompt.length).toBeGreaterThan(50);
    expect(job.outputs).toHaveLength(2);
    expect(job).not.toHaveProperty("errorDetail"); // internal details never leave the server
  });
});
