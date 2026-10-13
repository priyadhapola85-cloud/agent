/**
 * REAL API INTEGRATION TESTS — these call fal.ai / Anthropic and COST MONEY.
 *
 * They are skipped unless you opt in:
 *   PowerShell:  $env:RUN_PAID_TESTS="1"; npm run test:integration
 *   Git Bash:    RUN_PAID_TESTS=1 npm run test:integration
 * Keys are read from .env.local. The video test also needs RUN_PAID_VIDEO_TESTS=1.
 *
 * Optional: put a real reference photo you own at tests/integration/reference.jpg
 * (otherwise a plain generated test image is used).
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { ClaudePlanner } from "@/lib/providers/anthropic/claude-planner";
import { FalImageProvider, FalVideoProvider } from "@/lib/providers/fal/fal-provider";
import type { AsyncMediaProvider, ProviderHandle } from "@/lib/providers/types";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* no .env.local — tests below will be skipped */
}

const paid = process.env.RUN_PAID_TESTS === "1";
const paidVideo = paid && process.env.RUN_PAID_VIDEO_TESTS === "1";
const falKey = () => process.env.FAL_KEY?.trim() || undefined;
const anthropicKey = () => process.env.ANTHROPIC_API_KEY?.trim() || undefined;

/** A valid 768x1024 PNG (soft gradient) used when no real reference photo is provided. */
function testPng(): Buffer {
  const w = 768, h = 1024;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3;
    raw[o] = 230 - y / 10; raw[o + 1] = 210 - y / 12; raw[o + 2] = 200;
  }
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let r = 0xffffffff; for (const x of b) r = table[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function reference() {
  const p = "tests/integration/reference.jpg";
  return fs.existsSync(p) ? { data: fs.readFileSync(p), mimeType: "image/jpeg" } : { data: testPng(), mimeType: "image/png" };
}

async function waitFor<R>(provider: AsyncMediaProvider<R>, model: string, handle: ProviderHandle, timeoutMs: number) {
  const start = Date.now();
  for (;;) {
    const s = await provider.status(model, handle);
    if (s.state === "completed") return;
    if (s.state === "failed") throw new Error(`Provider failed: ${s.message} ${s.detail ?? ""}`);
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for provider");
    await new Promise((r) => setTimeout(r, 4000));
  }
}

describe.skipIf(!paid || !anthropicKey())("REAL Anthropic Claude planner", () => {
  it("returns a valid storyboard", async () => {
    const planner = new ClaudePlanner(anthropicKey, () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5");
    const plan = await planner.plan({
      characterName: "Ava",
      characterSummary: "Fictional adult fashion model, quiet luxury style",
      style: { niche: "luxury" },
      brief: { theme: "Autumn knitwear", durationSeconds: 10, aspectRatio: "9:16", outfit: "camel coat" },
      allowedSceneDurations: [5, 10],
    });
    expect(plan.scenes.length).toBeGreaterThan(0);
    expect(plan.scenes.every((s) => [5, 10].includes(s.durationSeconds))).toBe(true);
  });
});

describe.skipIf(!paid || !falKey())("REAL fal.ai image generation (Nano Banana Pro edit)", () => {
  it("generates one image from a reference and downloads it", async () => {
    const provider = new FalImageProvider(falKey);
    const model = "fal-ai/nano-banana-pro/edit";
    const handle = await provider.submit({
      model,
      prompt: "Fashion editorial portrait of the person in the reference wearing a cream knit sweater, soft window light.",
      references: [reference()],
      numImages: 1,
      aspectRatio: "3:4",
      resolution: "1K",
    });
    await waitFor(provider, model, handle, 10 * 60_000);
    const files = await provider.result(model, handle);
    const { data, mimeType } = await provider.download(files[0], 40 * 1024 * 1024);
    expect(mimeType).toMatch(/^image\//);
    expect(data.length).toBeGreaterThan(1000);
  });
});

describe.skipIf(!paidVideo || !falKey())("REAL fal.ai video generation (Kling 2.6 Pro image-to-video)", () => {
  it("animates a still image into a 5 s clip", async () => {
    const provider = new FalVideoProvider(falKey);
    const model = "fal-ai/kling-video/v2.6/pro/image-to-video";
    const handle = await provider.submit({
      model,
      prompt: "Slow camera push-in, gentle fabric movement.",
      startImage: reference(),
      durationSeconds: 5,
      generateAudio: false,
    });
    await waitFor(provider, model, handle, 30 * 60_000);
    const files = await provider.result(model, handle);
    const { mimeType } = await provider.download(files[0], 300 * 1024 * 1024);
    expect(mimeType).toBe("video/mp4");
  });
});
