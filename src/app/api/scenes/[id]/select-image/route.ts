import { apiRoute, readJson } from "@/lib/api/handler";
import { selectSceneImage } from "@/lib/services/content";
import { selectSceneImageSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** POST /api/scenes/:id/select-image — choose the start frame for the video */
export const POST = apiRoute<{ id: string }>(async (req, { app, params }) => {
  const { assetId } = await readJson(req, selectSceneImageSchema);
  return { scene: await selectSceneImage(app, params.id, assetId) };
});
