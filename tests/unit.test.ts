import { describe, expect, it } from "vitest";
import { ApiError, ValidationError } from "@fal-ai/client";
import { createSessionToken, passwordMatches, verifySessionToken } from "@/lib/auth/session";
import { redact } from "@/lib/logger";
import { detectMime, imageSize } from "@/lib/media/media-type";
import { characterCandidatePrompt, identityBlock, sceneImagePrompt, sceneVideoPrompt } from "@/lib/prompts/templates";
import { mapFalError } from "@/lib/providers/fal/fal-errors";
import { FalImageProvider, FalVideoProvider } from "@/lib/providers/fal/fal-provider";
import { TemplatePlanner } from "@/lib/providers/template-planner";
import { nextVideoStatus } from "@/lib/services/lifecycle";
import { fakeMp4, fakePng } from "./support/fakes";

const character = {
  name: "Ava Laurent",
  description: "Quiet luxury muse",
  identity: { fictionalAge: 26, face: "oval face, soft jaw", hair: "long auburn waves", eyes: "not visible" },
  style: { niche: "luxury", lighting: "golden hour" },
};

describe("prompt generation", () => {
  it("identity block contains stable traits and skips 'not visible'", () => {
    const block = identityBlock(character);
    expect(block).toContain("fictional adult fashion model (age 26)");
    expect(block).toContain("Hair: long auburn waves.");
    expect(block).not.toContain("not visible");
  });

  it("candidate prompt includes consistency rules, styling and revisions", () => {
    const p = characterCandidatePrompt(character, "softer smile");
    expect(p).toMatch(/keep the exact same face/i);
    expect(p).toContain("STYLING: Fashion niche: luxury.");
    expect(p).toContain("REVISION REQUEST (apply these changes, keep the identity): softer smile");
  });

  it("scene prompt combines identity with changeable campaign details", () => {
    const p = sceneImagePrompt(
      character,
      { imagePrompt: "walking on a Paris bridge", description: "" },
      { theme: "Paris", durationSeconds: 5, aspectRatio: "9:16", outfit: "trench coat" },
    );
    expect(p).toContain("IDENTITY:");
    expect(p).toContain("SCENE: walking on a Paris bridge");
    expect(p).toContain("Outfit: trench coat.");
  });

  it("video prompt carries motion and camera, not identity", () => {
    const p = sceneVideoPrompt({ videoPrompt: "She turns", cameraMovement: "slow dolly in", description: "" });
    expect(p).toContain("She turns Camera: slow dolly in.");
    expect(p).not.toContain("auburn");
  });

  it("template planner only uses allowed durations", async () => {
    const plan = await new TemplatePlanner().plan({
      characterName: "Ava",
      characterSummary: "",
      style: { niche: "street wear" },
      brief: { theme: "Drop", durationSeconds: 12, aspectRatio: "9:16" },
      allowedSceneDurations: [5, 10],
    });
    expect(plan.scenes.every((s) => [5, 10].includes(s.durationSeconds))).toBe(true);
    expect(plan.hashtags[0]).toBe("#streetwear");
  });
});

describe("video approval lifecycle (pure)", () => {
  it("allows the documented transitions", () => {
    expect(nextVideoStatus("draft", "start_generation")).toBe("generating");
    expect(nextVideoStatus("generating", "generation_succeeded")).toBe("ready_for_review");
    expect(nextVideoStatus("generating", "generation_failed")).toBe("failed");
    expect(nextVideoStatus("ready_for_review", "approve")).toBe("approved");
    expect(nextVideoStatus("approved", "start_generation")).toBe("generating");
    expect(nextVideoStatus("failed", "start_generation")).toBe("generating");
    expect(nextVideoStatus("rejected", "approve")).toBe("approved");
  });
  it("refuses invalid ones", () => {
    expect(() => nextVideoStatus("draft", "approve")).toThrow(/finished video/);
    expect(() => nextVideoStatus("generating", "start_generation")).toThrow(/already being generated/);
    expect(() => nextVideoStatus("failed", "approve")).toThrow();
  });
});

describe("sessions", () => {
  const secret = "x".repeat(40);
  it("valid token verifies; tampered, wrong-secret and expired tokens don't", async () => {
    const t = await createSessionToken(secret);
    expect(await verifySessionToken(t, secret)).toBe(true);
    expect(await verifySessionToken(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), secret)).toBe(false);
    expect(await verifySessionToken(t, "y".repeat(40))).toBe(false);
    expect(await verifySessionToken(t, secret, Date.now() + 8 * 24 * 3600 * 1000)).toBe(false);
    expect(await verifySessionToken(undefined, secret)).toBe(false);
  });
  it("password check", async () => {
    expect(await passwordMatches("abc12345", "abc12345")).toBe(true);
    expect(await passwordMatches("abc12345", "abc123456")).toBe(false);
  });
});

describe("secret handling", () => {
  it("redacts known keys and key-like strings from logs", () => {
    process.env.FAL_KEY = "11111111-2222-3333-4444-555555555555:abcdefabcdefabcdefabcdef";
    const out = redact(`Authorization: Key ${process.env.FAL_KEY} and sk-ant-api03-SECRETSECRET`);
    expect(out).not.toContain("abcdefabcdef");
    expect(out).not.toContain("SECRETSECRET");
    delete process.env.FAL_KEY;
  });
});

describe("API key sanity check", () => {
  it("flags masked/pasted-wrong keys and treats them as not configured", async () => {
    const { apiKeyProblem, env } = await import("@/lib/config/env");
    process.env.FAL_KEY = "1234abcd••••••••••••••••••••5678";
    expect(apiKeyProblem("FAL_KEY")).toMatch(/masked preview/);
    expect(env.falKey()).toBeUndefined();
    process.env.FAL_KEY = '"11111111-2222-3333-4444-555555555555:abcdef"';
    expect(apiKeyProblem("FAL_KEY")).toMatch(/quotes/);
    process.env.FAL_KEY = "11111111-2222-3333-4444-555555555555:abcdef0123";
    expect(apiKeyProblem("FAL_KEY")).toBeNull();
    expect(env.falKey()).toBe(process.env.FAL_KEY);
    delete process.env.FAL_KEY;
  });
});

describe("file type detection", () => {
  it("detects by content, not name", () => {
    expect(detectMime(fakePng())).toBe("image/png");
    expect(detectMime(fakeMp4())).toBe("video/mp4");
    expect(detectMime(Buffer.from("GIF89a-not-allowed-here"))).toBeNull();
    expect(imageSize(fakePng(800, 1200))).toEqual({ width: 800, height: 1200 });
  });
});

describe("fal.ai provider (no network)", () => {
  it("missing FAL_KEY → clear NOT_CONFIGURED error before any network call", async () => {
    const p = new FalImageProvider(() => undefined);
    expect(p.isConfigured()).toBe(false);
    await expect(
      p.submit({
        model: "fal-ai/nano-banana-pro/edit",
        prompt: "x",
        references: [{ data: fakePng(), mimeType: "image/png" }],
        numImages: 1,
        aspectRatio: "9:16",
        resolution: "1K",
      }),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED", action: expect.stringContaining("FAL_KEY") });
  });

  it("refuses unsupported models and parameters instead of guessing", async () => {
    const v = new FalVideoProvider(() => "fake:key");
    await expect(
      v.submit({ model: "made-up/model", prompt: "x", startImage: { data: fakePng(), mimeType: "image/png" }, durationSeconds: 5, generateAudio: false }),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(
      v.submit({
        model: "fal-ai/kling-video/v2.6/pro/image-to-video",
        prompt: "x",
        startImage: { data: fakePng(), mimeType: "image/png" },
        durationSeconds: 7,
        generateAudio: false,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("maps provider errors to friendly messages", () => {
    const mk = (status: number) => new ApiError({ message: "x", status, body: { detail: "raw" }, requestId: "r" });
    expect(mapFalError(mk(401), "t").code).toBe("PROVIDER_AUTH");
    // Real fal.ai reply when credit runs out — must say "billing", not "bad key"
    const broke = new ApiError({
      message: "Forbidden",
      status: 403,
      body: { detail: "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing" },
      requestId: "",
    });
    expect(mapFalError(broke, "t").message).toMatch(/out of credit/);
    expect(mapFalError(broke, "t").action).toMatch(/key is fine/);
    expect(mapFalError(mk(429), "t")).toMatchObject({ code: "PROVIDER_RATE_LIMIT", retryable: true });
    expect(mapFalError(mk(503), "t")).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(mapFalError(mk(422), "t")).toMatchObject({ code: "PROVIDER_REJECTED", retryable: false });
    expect(mapFalError(new TypeError("fetch failed"), "t").code).toBe("PROVIDER_UNAVAILABLE");
    const v = new ValidationError({
      message: "Unprocessable",
      status: 422,
      body: { detail: [{ msg: "content policy violation", loc: ["body"], type: "content_policy" }] },
      requestId: "r",
    });
    const mapped = mapFalError(v, "t");
    expect(mapped.code).toBe("CONTENT_REFUSED");
    expect(JSON.stringify(mapped.toJSON())).not.toContain("raw"); // detail never in the browser payload
  });

  it("parses result shapes and rejects invalid responses", () => {
    const img = new FalImageProvider(() => "k") as unknown as { parseResult: (d: unknown) => unknown };
    expect(img.parseResult({ images: [{ url: "https://x.test/a.png", width: 1, height: 2 }] })).toEqual([
      { url: "https://x.test/a.png", contentType: undefined, width: 1, height: 2 },
    ]);
    expect(() => img.parseResult({ images: [] })).toThrow(/without images/);
    const vid = new FalVideoProvider(() => "k") as unknown as { parseResult: (d: unknown) => unknown };
    expect(vid.parseResult({ video: { url: "https://x.test/v.mp4" } })).toEqual([{ url: "https://x.test/v.mp4", contentType: undefined }]);
    expect(() => vid.parseResult({ nope: 1 })).toThrow(/without a video/);
  });
});
