import { apiRoute, readJson } from "@/lib/api/handler";
import { setAssetReview } from "@/lib/services/characters";
import { assetReviewSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** POST /api/assets/:id/review — reject an inconsistent image (or undo the rejection) */
export const POST = apiRoute<{ id: string }>(async (req, { app, params }) => {
  const { decision, note } = await readJson(req, assetReviewSchema);
  return { asset: await setAssetReview(app, params.id, decision, note) };
});
