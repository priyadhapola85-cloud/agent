import { apiRoute, readJson } from "@/lib/api/handler";
import { generateSceneImages } from "@/lib/services/content";
import { generateSceneImageSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** POST /api/scenes/:id/images — generate first-frame images using the character references (paid) */
export const POST = apiRoute<{ id: string }>(async (req, { app, params }) =>
  generateSceneImages(app, params.id, await readJson(req, generateSceneImageSchema)),
);
