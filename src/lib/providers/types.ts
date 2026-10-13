import type { CharacterIdentity, CharacterStyle, ContentBrief } from "../db/schema";

/**
 * PROVIDER INTERFACES
 *
 * The rest of the app only talks to these interfaces — never directly to
 * fal.ai or Anthropic. To switch provider later, write a new class that
 * implements the same interface and register it in ./registry.ts.
 */

export type ImageInput = { data: Buffer; mimeType: string };

/** Identifies a request that is running on the provider's side. */
export type ProviderHandle = { requestId: string };

export type ProviderJobState =
  | { state: "queued"; position?: number }
  | { state: "running" }
  | { state: "completed" }
  | { state: "failed"; message: string; detail?: string };

export type ProviderOutputFile = {
  url: string;
  contentType?: string;
  width?: number;
  height?: number;
};

export interface AsyncMediaProvider<Request> {
  /** Short provider name stored with every job, e.g. "fal". */
  readonly id: string;
  /** Whether this provider can run now (optionally for one specific model). */
  isConfigured(model?: string): boolean;
  /** Starts a generation and returns immediately with a handle. */
  submit(request: Request): Promise<ProviderHandle>;
  /** Asks the provider how the request is doing. */
  status(model: string, handle: ProviderHandle): Promise<ProviderJobState>;
  /** Gets the finished output file links. Only call after status = completed. */
  result(model: string, handle: ProviderHandle): Promise<ProviderOutputFile[]>;
  /** Downloads one output file so we can keep a private copy. */
  download(file: ProviderOutputFile, maxBytes: number): Promise<{ data: Buffer; mimeType: string }>;
}

export type ImageGenerationRequest = {
  model: string;
  prompt: string;
  /** Character reference images (master first). At least one is required. */
  references: ImageInput[];
  numImages: number;
  aspectRatio: string;
  resolution: "1K" | "2K" | "4K";
  seed?: number;
};

export type VideoGenerationRequest = {
  model: string;
  prompt: string;
  negativePrompt?: string;
  /** The approved still image that becomes the first frame. */
  startImage: ImageInput;
  durationSeconds: number;
  generateAudio: boolean;
};

export type ImageProvider = AsyncMediaProvider<ImageGenerationRequest>;
export type VideoProvider = AsyncMediaProvider<VideoGenerationRequest>;

// ---------------------------------------------------------------------------
// Reference analysis (vision) — describes what is visible in an uploaded image
// ---------------------------------------------------------------------------

export type ReferenceAnalysisResult = {
  identity: CharacterIdentity;
  style: CharacterStyle;
  summary: string;
  notes?: string;
};

export interface ReferenceAnalyzer {
  readonly id: string;
  readonly model: string;
  isConfigured(): boolean;
  analyze(image: ImageInput): Promise<ReferenceAnalysisResult>;
}

// ---------------------------------------------------------------------------
// Content planning — turns a brief into a concept + storyboard
// ---------------------------------------------------------------------------

export type PlanInput = {
  characterName: string;
  characterSummary: string;
  style: CharacterStyle;
  brief: ContentBrief;
  /** Clip lengths the selected video model can produce. */
  allowedSceneDurations: number[];
};

export type PlannedScene = {
  title: string;
  description: string;
  imagePrompt: string;
  videoPrompt: string;
  cameraMovement: string;
  durationSeconds: number;
  transition: string;
  onScreenText: string;
};

export type PlanOutput = {
  concept: string;
  scenes: PlannedScene[];
  transitions: string[];
  caption: string;
  hashtags: string[];
};

export interface ContentPlanner {
  readonly id: "claude" | "template";
  readonly model: string | null;
  isConfigured(): boolean;
  plan(input: PlanInput): Promise<PlanOutput>;
}
