import { apiRoute, readJson } from "@/lib/api/handler";
import { generateCandidates } from "@/lib/services/characters";
import { generateCandidatesSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** POST /api/characters/:id/candidates — start candidate image generation (paid) */
export const POST = apiRoute<{ id: string }>(async (req, { app, params }) => {
  const input = await readJson(req, generateCandidatesSchema);
  return generateCandidates(app, params.id, input);
});
