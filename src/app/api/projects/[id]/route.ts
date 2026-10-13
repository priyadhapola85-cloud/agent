import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteProject, getProjectDetail, updateProject } from "@/lib/services/content";
import { updateProjectSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

type P = { id: string };

export const GET = apiRoute<P>(async (_req, { app, params }) => getProjectDetail(app, params.id));

/** PATCH — edit brief, concept, caption, hashtags, notes */
export const PATCH = apiRoute<P>(async (req, { app, params }) => {
  await updateProject(app, params.id, await readJson(req, updateProjectSchema));
  return getProjectDetail(app, params.id);
});

export const DELETE = apiRoute<P>(async (_req, { app, params }) => {
  await deleteProject(app, params.id);
  return { ok: true };
});
