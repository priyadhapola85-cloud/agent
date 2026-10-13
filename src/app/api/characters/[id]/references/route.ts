import { apiRoute, readJson } from "@/lib/api/handler";
import { approveReference } from "@/lib/services/characters";
import { approveReferenceSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** POST /api/characters/:id/references — approve an image as master or extra reference */
export const POST = apiRoute<{ id: string }>(async (req, { app, params }) => {
  const input = await readJson(req, approveReferenceSchema);
  return approveReference(app, params.id, input);
});
