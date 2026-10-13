import "server-only";
import { env } from "./config/env";
import { getDb, type Db } from "./db/client";
import { ClaudeReferenceAnalyzer } from "./providers/anthropic/claude-analyzer";
import { ClaudePlanner } from "./providers/anthropic/claude-planner";
import { FalImageProvider, FalVideoProvider } from "./providers/fal/fal-provider";
import { HfImageProvider, HfVideoProvider } from "./providers/huggingface/hf-provider";
import { ModelRouter } from "./providers/router";
import { TemplatePlanner } from "./providers/template-planner";
import type { ContentPlanner, ImageProvider, ReferenceAnalyzer, VideoProvider } from "./providers/types";
import { LocalFileStorage, type MediaStorage } from "./storage/storage";

/**
 * APP CONTEXT — the one place where real implementations are chosen.
 *
 * Services receive this object instead of importing fal/Anthropic/the DB
 * directly. Automated tests replace it with fakes (setContextForTests), which
 * is how we test without spending money on real API calls.
 */
export type Providers = {
  image: ImageProvider;
  video: VideoProvider;
  analyzer: ReferenceAnalyzer;
  aiPlanner: ContentPlanner;
  templatePlanner: ContentPlanner;
};

export type AppSettings = {
  imageModel: string;
  videoModel: string;
  /** How long a job may run before we mark it as timed out. */
  imageTimeoutMs: number;
  videoTimeoutMs: number;
};

export type AppContext = {
  db: Db;
  storage: MediaStorage;
  providers: Providers;
  settings: AppSettings;
};

let testOverride: AppContext | null = null;

export function setContextForTests(ctx: AppContext | null) {
  testOverride = ctx;
}

const realProviders = (): Providers => ({
  // Each request goes to Hugging Face (free) or fal.ai (paid) depending on the chosen model.
  image: new ModelRouter("image", { huggingface: new HfImageProvider(env.hfToken), fal: new FalImageProvider(env.falKey) }),
  video: new ModelRouter("video", { huggingface: new HfVideoProvider(env.hfToken), fal: new FalVideoProvider(env.falKey) }),
  analyzer: new ClaudeReferenceAnalyzer(env.anthropicKey, env.anthropicModel),
  aiPlanner: new ClaudePlanner(env.anthropicKey, env.anthropicModel),
  templatePlanner: new TemplatePlanner(),
});

export async function getContext(): Promise<AppContext> {
  if (testOverride) return testOverride;
  return {
    db: await getDb(),
    storage: new LocalFileStorage(env.storageDir()),
    providers: realProviders(),
    settings: {
      imageModel: env.imageModel(),
      videoModel: env.videoModel(),
      imageTimeoutMs: 10 * 60_000,
      videoTimeoutMs: 30 * 60_000,
    },
  };
}
