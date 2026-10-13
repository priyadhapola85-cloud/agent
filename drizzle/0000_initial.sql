CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"scene_id" text NOT NULL,
	"asset_id" text,
	"decision" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_references" (
	"id" text PRIMARY KEY NOT NULL,
	"character_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"role" text NOT NULL,
	"use_for_generation" boolean DEFAULT true NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"identity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"analysis" jsonb,
	"rights_confirmed_at" timestamp with time zone,
	"description_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"character_id" text NOT NULL,
	"title" text NOT NULL,
	"brief" jsonb NOT NULL,
	"concept" text DEFAULT '' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"planner_source" text,
	"planner_model" text,
	"planned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"character_id" text,
	"project_id" text,
	"scene_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"negative_prompt" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reference_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_asset_id" text,
	"provider_request_id" text,
	"submit_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"error_detail" text,
	"idempotency_key" text NOT NULL,
	"retry_of_job_id" text,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"sha256" text NOT NULL,
	"original_filename" text,
	"character_id" text,
	"project_id" text,
	"scene_id" text,
	"job_id" text,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_events" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storyboard_scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_prompt" text DEFAULT '' NOT NULL,
	"video_prompt" text DEFAULT '' NOT NULL,
	"camera_movement" text DEFAULT '' NOT NULL,
	"duration_seconds" integer DEFAULT 5 NOT NULL,
	"transition" text DEFAULT '' NOT NULL,
	"on_screen_text" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"selected_image_asset_id" text,
	"current_video_asset_id" text,
	"video_status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_scene_id_storyboard_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."storyboard_scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_references" ADD CONSTRAINT "character_references_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_references" ADD CONSTRAINT "character_references_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_projects" ADD CONSTRAINT "content_projects_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_project_id_content_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."content_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_scene_id_storyboard_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."storyboard_scenes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_input_asset_id_media_assets_id_fk" FOREIGN KEY ("input_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_scenes" ADD CONSTRAINT "storyboard_scenes_project_id_content_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."content_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_scenes" ADD CONSTRAINT "storyboard_scenes_selected_image_asset_id_media_assets_id_fk" FOREIGN KEY ("selected_image_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_scenes" ADD CONSTRAINT "storyboard_scenes_current_video_asset_id_media_assets_id_fk" FOREIGN KEY ("current_video_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_scene_idx" ON "approvals" USING btree ("scene_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_references_unique_asset" ON "character_references" USING btree ("character_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_references_one_master" ON "character_references" USING btree ("character_id") WHERE "character_references"."role" = 'master';--> statement-breakpoint
CREATE INDEX "content_projects_character_idx" ON "content_projects" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_idempotency_key" ON "generation_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generation_jobs_character_idx" ON "generation_jobs" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_scene_idx" ON "generation_jobs" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "media_assets_character_idx" ON "media_assets" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "media_assets_scene_idx" ON "media_assets" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "media_assets_job_idx" ON "media_assets" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "status_events_entity_idx" ON "status_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "storyboard_scenes_project_idx" ON "storyboard_scenes" USING btree ("project_id","position");