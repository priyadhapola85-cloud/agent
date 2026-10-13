import { apiRoute, readJson } from "@/lib/api/handler";
import { reviewSceneVideo } from "@/lib/services/content";
import { reviewDecisionSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** POST /api/scenes/:id/review — approve or reject the current video */
export const POST = apiRoute<{ id: string }>(async (req, { app, params }) => {
  const { decision, note } = await readJson(req, reviewDecisionSchema);
  return { scene: await reviewSceneVideo(app, params.id, decision, note) };
});
