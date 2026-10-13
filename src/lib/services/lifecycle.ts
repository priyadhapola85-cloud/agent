import { and, desc, eq } from "drizzle-orm";
import type { AppContext } from "../context";
import { approvals, storyboardScenes, type VideoStatus } from "../db/schema";
import { AppError, notFound } from "../errors";
import { newId } from "../ids";
import { recordEvent } from "./events";

/**
 * VIDEO APPROVAL LIFECYCLE
 *
 *   draft ──start──▶ generating ──success──▶ ready_for_review ──approve──▶ approved
 *                        │                         │  ▲                       │
 *                     failure                   reject │ (change of mind)     │ regenerate
 *                        ▼                         ▼  │                       ▼
 *                      failed ──retry──▶ generating  rejected ◀──reject── generating …
 *
 * Regenerating ALWAYS clears an approval: the new video must be reviewed again.
 */

export type VideoEvent = "start_generation" | "generation_succeeded" | "generation_failed" | "approve" | "reject";

const TRANSITIONS: Record<VideoStatus, Partial<Record<VideoEvent, VideoStatus>>> = {
  draft: { start_generation: "generating" },
  generating: { generation_succeeded: "ready_for_review", generation_failed: "failed" },
  ready_for_review: { approve: "approved", reject: "rejected", start_generation: "generating" },
  approved: { reject: "rejected", start_generation: "generating" },
  rejected: { approve: "approved", start_generation: "generating" },
  failed: { start_generation: "generating" },
};

const EXPLAIN: Partial<Record<VideoEvent, string>> = {
  approve: "Only a finished video that is waiting for review can be approved.",
  reject: "Only a finished video can be rejected.",
  start_generation: "A video is already being generated for this scene.",
};

/** Pure function: what status comes next, or an error if the move is not allowed. */
export function nextVideoStatus(current: VideoStatus, event: VideoEvent): VideoStatus {
  const next = TRANSITIONS[current]?.[event];
  if (!next)
    throw new AppError("CONFLICT", EXPLAIN[event] ?? `Cannot ${event.replace("_", " ")} while the scene is "${current}".`);
  return next;
}

/** Applies a lifecycle event to a scene and logs it. Invalidates approvals on regeneration. */
export async function transitionVideoStatus(ctx: AppContext, sceneId: string, event: VideoEvent, message = "") {
  const [scene] = await ctx.db.select().from(storyboardScenes).where(eq(storyboardScenes.id, sceneId));
  if (!scene) throw notFound("Scene");
  const to = nextVideoStatus(scene.videoStatus, event);

  if (event === "start_generation" && scene.videoStatus === "approved") {
    await ctx.db.insert(approvals).values({
      id: newId("apr"),
      sceneId,
      assetId: scene.currentVideoAssetId,
      decision: "invalidated",
      note: "Approval cleared because a new version is being generated.",
    });
  }

  const [updated] = await ctx.db
    .update(storyboardScenes)
    .set({ videoStatus: to, updatedAt: new Date() })
    .where(and(eq(storyboardScenes.id, sceneId), eq(storyboardScenes.videoStatus, scene.videoStatus)))
    .returning();
  if (!updated) throw new AppError("CONFLICT", "The scene changed at the same time. Refresh and try again.");
  await recordEvent(ctx.db, "scene", sceneId, scene.videoStatus, to, message || event);
  return updated;
}

/**
 * A scene's video can be exported only when it is approved AND the latest
 * approval record is for the exact video file that is current now.
 */
export async function isExportable(ctx: AppContext, sceneId: string) {
  const [scene] = await ctx.db.select().from(storyboardScenes).where(eq(storyboardScenes.id, sceneId));
  if (!scene || scene.videoStatus !== "approved" || !scene.currentVideoAssetId) return false;
  const [latest] = await ctx.db
    .select()
    .from(approvals)
    .where(eq(approvals.sceneId, sceneId))
    .orderBy(desc(approvals.createdAt), desc(approvals.id))
    .limit(1);
  return !!latest && latest.decision === "approved" && latest.assetId === scene.currentVideoAssetId;
}
