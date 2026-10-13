import { z } from "zod";
import { apiRoute, readJson } from "@/lib/api/handler";
import { analyzeReference, getCharacterDetail } from "@/lib/services/characters";

export const dynamic = "force-dynamic";

const schema = z.object({ mode: z.enum(["fill_empty", "overwrite"]).default("fill_empty") }).strict();

/** POST /api/characters/:id/analyze — Claude describes the uploaded reference */
export const POST = apiRoute<{ id: string }>(async (req, { app, params }) => {
  const { mode } = await readJson(req, schema);
  await analyzeReference(app, params.id, mode);
  return getCharacterDetail(app, params.id);
});
