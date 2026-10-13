import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * DATABASE SCHEMA
 *
 * Each `pgTable` below is one table in PostgreSQL. Large files (images and
 * videos) are NOT stored here — they live in private file storage and the
 * `media_assets` table only keeps their location and metadata.
 *
 * After editing this file run `npm run db:generate` to create a migration.
 */

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/** Stable identity traits — these should stay the same in every image. */
export type CharacterIdentity = {
  fictionalAge?: number;
  genderPresentation?: string;
  face?: string;
  eyes?: string;
  hair?: string;
  skin?: string;
  body?: string;
  distinctiveFeatures?: string;
};

/** Default styling — changeable per piece of content. */
export type CharacterStyle = {
  niche?: string;
  clothing?: string;
  accessories?: string;
  makeup?: string;
  personality?: string;
  mood?: string;
  presentationStyle?: string;
  locations?: string;
  lighting?: string;
  camera?: string;
};

/** What the vision analysis saw in the uploaded reference (kept for history). */
export type ReferenceAnalysis = {
  identity: CharacterIdentity;
  style: CharacterStyle;
  summary: string;
  notes?: string;
  model: string;
  analyzedAt: string;
  sourceAssetId: string;
};

export const CHARACTER_STATUSES = [
  "draft", // profile only, no reference uploaded yet
  "reference_uploaded", // reference uploaded, not analyzed/edited yet
  "ready_to_generate", // description reviewed, waiting for user to start generation
  "active", // a master reference has been approved
  "archived",
] as const;
export type CharacterStatus = (typeof CHARACTER_STATUSES)[number];

export const characters = pgTable("characters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").$type<CharacterStatus>().notNull().default("draft"),
  identity: jsonb("identity").$type<CharacterIdentity>().notNull().default({}),
  style: jsonb("style").$type<CharacterStyle>().notNull().default({}),
  analysis: jsonb("analysis").$type<ReferenceAnalysis | null>(),
  /** When the user confirmed they have the rights to the uploaded reference. */
  rightsConfirmedAt: timestamp("rights_confirmed_at", { withTimezone: true }),
  /** When the user last reviewed/saved the description — generation needs this. */
  descriptionReviewedAt: timestamp("description_reviewed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Media assets (images + videos stored in private storage)
// ---------------------------------------------------------------------------

export type AssetKind = "image" | "video";
export type AssetSource = "upload" | "generated";
export type AssetReviewStatus = "pending" | "approved" | "rejected";

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<AssetKind>().notNull(),
    source: text("source").$type<AssetSource>().notNull(),
    /** Location inside private storage, e.g. "characters/chr_x/ast_y.png". */
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256").notNull(),
    originalFilename: text("original_filename"),
    characterId: text("character_id").references(() => characters.id, { onDelete: "set null" }),
    projectId: text("project_id"),
    sceneId: text("scene_id"),
    jobId: text("job_id"),
    reviewStatus: text("review_status").$type<AssetReviewStatus>().notNull().default("pending"),
    reviewNote: text("review_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("media_assets_character_idx").on(t.characterId),
    index("media_assets_scene_idx").on(t.sceneId),
    index("media_assets_job_idx").on(t.jobId),
  ],
);

// ---------------------------------------------------------------------------
// Character references (which images define what the character looks like)
// ---------------------------------------------------------------------------

/**
 * role:
 *  - "source"   the image the user uploaded in the Design Studio
 *  - "master"   the ONE approved image that defines the character (max one)
 *  - "approved" extra approved images (other angles, expressions, outfits)
 */
export type ReferenceRole = "source" | "master" | "approved";

export const characterReferences = pgTable(
  "character_references",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    role: text("role").$type<ReferenceRole>().notNull(),
    /** Whether this image is sent to the provider as a reference in future generations. */
    useForGeneration: boolean("use_for_generation").notNull().default(true),
    label: text("label"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("character_references_unique_asset").on(t.characterId, t.assetId),
    // Database-level guarantee: at most one master per character.
    uniqueIndex("character_references_one_master")
      .on(t.characterId)
      .where(sql`${t.role} = 'master'`),
  ],
);

// ---------------------------------------------------------------------------
// Content projects + storyboard scenes
// ---------------------------------------------------------------------------

export type ContentBrief = {
  theme: string;
  outfit?: string;
  accessories?: string;
  scene?: string;
  mood?: string;
  visualStyle?: string;
  durationSeconds: number;
  aspectRatio: "9:16" | "4:5" | "1:1" | "16:9";
  cameraMovement?: string;
  movementType?: string;
  caption?: string;
  onScreenText?: string;
};

export type PlannerSource = "claude" | "template" | "manual";

export const contentProjects = pgTable(
  "content_projects",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    brief: jsonb("brief").$type<ContentBrief>().notNull(),
    concept: text("concept").notNull().default(""),
    caption: text("caption").notNull().default(""),
    hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
    transitions: jsonb("transitions").$type<string[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    plannerSource: text("planner_source").$type<PlannerSource>(),
    plannerModel: text("planner_model"),
    plannedAt: timestamp("planned_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("content_projects_character_idx").on(t.characterId)],
);

/** Approval lifecycle of a scene's video clip. */
export const VIDEO_STATUSES = [
  "draft",
  "generating",
  "ready_for_review",
  "approved",
  "rejected",
  "failed",
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const storyboardScenes = pgTable(
  "storyboard_scenes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => contentProjects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** Changeable scene parts only — identity is added from the character at generation time. */
    imagePrompt: text("image_prompt").notNull().default(""),
    videoPrompt: text("video_prompt").notNull().default(""),
    cameraMovement: text("camera_movement").notNull().default(""),
    durationSeconds: integer("duration_seconds").notNull().default(5),
    transition: text("transition").notNull().default(""),
    onScreenText: text("on_screen_text").notNull().default(""),
    notes: text("notes").notNull().default(""),
    /** The approved still image the video will be animated from. */
    selectedImageAssetId: text("selected_image_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    currentVideoAssetId: text("current_video_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    videoStatus: text("video_status").$type<VideoStatus>().notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("storyboard_scenes_project_idx").on(t.projectId, t.position)],
);

// ---------------------------------------------------------------------------
// Generation jobs (image and video) — one row per provider request
// ---------------------------------------------------------------------------

export type JobKind = "image" | "video";
export type JobPurpose = "character_candidate" | "scene_image" | "scene_video";
export const JOB_STATUSES = ["queued", "generating", "completed", "failed", "canceled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<JobKind>().notNull(),
    purpose: text("purpose").$type<JobPurpose>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    characterId: text("character_id").references(() => characters.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => contentProjects.id, { onDelete: "set null" }),
    sceneId: text("scene_id").references(() => storyboardScenes.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** The full prompt actually sent to the provider. */
    prompt: text("prompt").notNull(),
    negativePrompt: text("negative_prompt"),
    /** Provider options (aspect ratio, duration, number of images...). */
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    /** Character reference images sent with the request. */
    referenceAssetIds: jsonb("reference_asset_ids").$type<string[]>().notNull().default([]),
    /** Start frame for image-to-video. */
    inputAssetId: text("input_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    providerRequestId: text("provider_request_id"),
    submitAttempts: integer("submit_attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    errorCode: text("error_code"),
    /** Friendly message shown in the UI. */
    errorMessage: text("error_message"),
    /** Internal detail for debugging — never sent to the browser. */
    errorDetail: text("error_detail"),
    /** Prevents duplicate jobs when a button is clicked twice. */
    idempotencyKey: text("idempotency_key").notNull(),
    retryOfJobId: text("retry_of_job_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("generation_jobs_idempotency_key").on(t.idempotencyKey),
    index("generation_jobs_status_idx").on(t.status),
    index("generation_jobs_character_idx").on(t.characterId),
    index("generation_jobs_scene_idx").on(t.sceneId),
  ],
);

// ---------------------------------------------------------------------------
// Approval records + status history
// ---------------------------------------------------------------------------

export type ApprovalDecision = "approved" | "rejected" | "invalidated";

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    sceneId: text("scene_id")
      .notNull()
      .references(() => storyboardScenes.id, { onDelete: "cascade" }),
    assetId: text("asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    decision: text("decision").$type<ApprovalDecision>().notNull(),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_scene_idx").on(t.sceneId)],
);

export type EntityType = "job" | "scene" | "character" | "asset";

/** An append-only log of every status change and error. */
export const statusEvents = pgTable(
  "status_events",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").$type<EntityType>().notNull(),
    entityId: text("entity_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    message: text("message").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("status_events_entity_idx").on(t.entityType, t.entityId)],
);

export type Character = typeof characters.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type CharacterReference = typeof characterReferences.$inferSelect;
export type ContentProject = typeof contentProjects.$inferSelect;
export type StoryboardScene = typeof storyboardScenes.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type StatusEvent = typeof statusEvents.$inferSelect;
