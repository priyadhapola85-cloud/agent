import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteCharacter, getCharacterDetail, updateCharacter } from "@/lib/services/characters";
import { updateCharacterSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

type P = { id: string };

/** GET /api/characters/:id — profile, references, candidates, generation history */
export const GET = apiRoute<P>(async (_req, { app, params }) => getCharacterDetail(app, params.id));

/** PATCH /api/characters/:id — edit description / mark reviewed / archive */
export const PATCH = apiRoute<P>(async (req, { app, params }) => {
  const input = await readJson(req, updateCharacterSchema);
  await updateCharacter(app, params.id, input);
  return getCharacterDetail(app, params.id);
});

/** DELETE /api/characters/:id — permanent (UI asks for confirmation first) */
export const DELETE = apiRoute<P>(async (_req, { app, params }) => {
  await deleteCharacter(app, params.id);
  return { ok: true };
});
