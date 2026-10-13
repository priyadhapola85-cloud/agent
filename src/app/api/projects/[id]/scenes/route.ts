import { apiRoute, readJson } from "@/lib/api/handler";
import { addScene, getProjectDetail } from "@/lib/services/content";
import { sceneFieldsSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** POST /api/projects/:id/scenes — add a scene manually */
export const POST = apiRoute<{ id: string }>(async (req, { app, params }) => {
  await addScene(app, params.id, await readJson(req, sceneFieldsSchema));
  return getProjectDetail(app, params.id);
});
