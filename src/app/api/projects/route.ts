import { apiRoute, readJson } from "@/lib/api/handler";
import { createProject, listProjects } from "@/lib/services/content";
import { createProjectSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** GET /api/projects[?characterId=] */
export const GET = apiRoute(async (req, { app }) => ({
  projects: await listProjects(app, { characterId: req.nextUrl.searchParams.get("characterId")?.slice(0, 60) || undefined }),
}));

/** POST /api/projects — create a content brief (does not generate anything) */
export const POST = apiRoute(async (req, { app }) => {
  const input = await readJson(req, createProjectSchema);
  return { project: await createProject(app, input) };
});
