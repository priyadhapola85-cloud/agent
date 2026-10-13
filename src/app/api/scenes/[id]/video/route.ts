import { apiRoute, readJson } from "@/lib/api/handler";
import { generateSceneVideo } from "@/lib/services/content";
import { generateVideoSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** POST /api/scenes/:id/video — start image-to-video generation (paid, asynchronous) */
export const POST = apiRoute<{ id: string }>(async (req, { app, params }) =>
  generateSceneVideo(app, params.id, await readJson(req, generateVideoSchema)),
);
