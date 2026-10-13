import { apiRoute, readJson } from "@/lib/api/handler";
import { removeReference, updateReference } from "@/lib/services/characters";
import { updateReferenceSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

type P = { id: string; refId: string };

/** PATCH — toggle "use for generation", rename, or make master */
export const PATCH = apiRoute<P>(async (req, { app, params }) => {
  const input = await readJson(req, updateReferenceSchema);
  return updateReference(app, params.id, params.refId, input);
});

/** DELETE — remove from references (the image itself stays in history) */
export const DELETE = apiRoute<P>(async (_req, { app, params }) => removeReference(app, params.id, params.refId));
