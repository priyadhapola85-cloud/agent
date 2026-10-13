import { apiRoute, readJson } from "@/lib/api/handler";
import { planProject } from "@/lib/services/content";
import { planProjectSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Claude planning can take a minute

/** POST /api/projects/:id/plan — writes concept + storyboard (text only, no images) */
export const POST = apiRoute<{ id: string }>(async (req, { app, params }) =>
  planProject(app, params.id, await readJson(req, planProjectSchema)),
);
