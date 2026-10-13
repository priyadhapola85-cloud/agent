import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteScene, getScene, updateScene } from "@/lib/services/content";
import { updateSceneSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

type P = { id: string };

export const GET = apiRoute<P>(async (_req, { app, params }) => ({ scene: await getScene(app, params.id) }));

/** PATCH — edit scene text/prompts (never starts a generation) */
export const PATCH = apiRoute<P>(async (req, { app, params }) => ({
  scene: await updateScene(app, params.id, await readJson(req, updateSceneSchema)),
}));

export const DELETE = apiRoute<P>(async (_req, { app, params }) => deleteScene(app, params.id));
