/**
 * TEST DOUBLES ("fakes") — MOCK PROVIDERS
 *
 * These imitate fal.ai / Claude so the automated tests can run offline and
 * for free. Nothing in here talks to a real API. Real-API checks live in
 * tests/integration and are skipped unless explicitly enabled.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/lib/db/client";
import type { AppContext } from "@/lib/context";
import { AppError } from "@/lib/errors";
import { TemplatePlanner } from "@/lib/providers/template-planner";
import type {
  AsyncMediaProvider,
  ImageGenerationRequest,
  ImageInput,
  ProviderHandle,
  ProviderJobState,
  ProviderOutputFile,
  ReferenceAnalysisResult,
  ReferenceAnalyzer,
  VideoGenerationRequest,
} from "@/lib/providers/types";
import { LocalFileStorage } from "@/lib/storage/storage";

/** A minimal PNG header with the given dimensions (enough for type + size detection). */
export function fakePng(width = 1024, height = 1024): Buffer {
  const buf = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf.write(`unique-${Math.random()}`, 30, "ascii");
  return buf;
}

export function fakeMp4(): Buffer {
  const buf = Buffer.alloc(64);
  buf.writeUInt32BE(32, 0);
  buf.write("ftypisom", 4, "ascii");
  buf.write(`video-${Math.random()}`, 16, "ascii");
  return buf;
}

export class FakeMediaProvider<Req> implements AsyncMediaProvider<Req> {
  readonly id = "fake";
  configured = true;
  submitted: Req[] = [];
  /** If set, submit() throws this error (once per entry). */
  submitErrors: AppError[] = [];
  /** States returned by successive status() calls; when empty → "completed". */
  statusSequence: ProviderJobState[] = [];
  statusError: AppError | null = null;
  resultError: AppError | null = null;
  outputsPerJob = 1;
  private counter = 0;

  constructor(private readonly kind: "image" | "video") {}

  isConfigured() {
    return this.configured;
  }

  async submit(req: Req): Promise<ProviderHandle> {
    const err = this.submitErrors.shift();
    if (err) throw err;
    this.submitted.push(req);
    return { requestId: `fake_req_${++this.counter}` };
  }

  async status(): Promise<ProviderJobState> {
    if (this.statusError) throw this.statusError;
    return this.statusSequence.shift() ?? { state: "completed" };
  }

  async result(): Promise<ProviderOutputFile[]> {
    if (this.resultError) throw this.resultError;
    const n = (this.submitted.at(-1) as { numImages?: number } | undefined)?.numImages ?? this.outputsPerJob;
    return Array.from({ length: this.kind === "image" ? n : 1 }, (_, i) => ({ url: `https://fake.test/out-${i}` }));
  }

  async download() {
    return this.kind === "image"
      ? { data: fakePng(768, 1024), mimeType: "image/png" }
      : { data: fakeMp4(), mimeType: "video/mp4" };
  }
}

export class FakeAnalyzer implements ReferenceAnalyzer {
  readonly id = "fake";
  readonly model = "fake-vision";
  configured = true;
  calls: ImageInput[] = [];
  isConfigured() {
    return this.configured;
  }
  async analyze(image: ImageInput): Promise<ReferenceAnalysisResult> {
    this.calls.push(image);
    return {
      summary: "A woman in her mid-20s with long wavy auburn hair.",
      notes: "Apparent age: mid-20s.",
      identity: { face: "oval face, high cheekbones", hair: "long wavy auburn hair", eyes: "green almond eyes", skin: "fair, warm undertone" },
      style: { clothing: "cream knit sweater", lighting: "soft window light" },
    };
  }
}

export type TestHarness = {
  ctx: AppContext;
  image: FakeMediaProvider<ImageGenerationRequest>;
  video: FakeMediaProvider<VideoGenerationRequest>;
  analyzer: FakeAnalyzer;
  aiPlanner: TemplatePlanner & { configured: boolean };
  storageDir: string;
  close: () => Promise<void>;
};

// One in-memory database per test file (starting Postgres is the slow part);
// every test gets empty tables via TRUNCATE.
let shared: Awaited<ReturnType<typeof createTestDb>> | null = null;

async function freshDb() {
  if (!shared) shared = await createTestDb();
  await shared.db.execute(
    sql.raw(
      `TRUNCATE ${["status_events", "approvals", "generation_jobs", "storyboard_scenes", "content_projects", "character_references", "media_assets", "characters"].join(", ")} CASCADE`,
    ),
  );
  return shared.db;
}

export async function createHarness(): Promise<TestHarness> {
  const db = await freshDb();
  const close = async () => undefined;
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "fashion-test-"));
  const image = new FakeMediaProvider<ImageGenerationRequest>("image");
  const video = new FakeMediaProvider<VideoGenerationRequest>("video");
  const analyzer = new FakeAnalyzer();
  // The "AI" planner in tests is a template planner pretending to be unconfigured/configured.
  const aiPlanner = Object.assign(new TemplatePlanner(), { configured: false }) as TemplatePlanner & { configured: boolean };
  aiPlanner.isConfigured = () => aiPlanner.configured;

  const ctx: AppContext = {
    db,
    storage: new LocalFileStorage(storageDir),
    providers: { image, video, analyzer, aiPlanner, templatePlanner: new TemplatePlanner() },
    settings: {
      imageModel: "fal-ai/nano-banana-pro/edit",
      videoModel: "fal-ai/kling-video/v2.6/pro/image-to-video",
      imageTimeoutMs: 10 * 60_000,
      videoTimeoutMs: 30 * 60_000,
    },
  };
  return {
    ctx,
    image,
    video,
    analyzer,
    aiPlanner,
    storageDir,
    close: async () => {
      await close();
      fs.rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

let keyCounter = 0;
export const key = () => `test-key-${Date.now()}-${++keyCounter}`;
