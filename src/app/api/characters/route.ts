import { apiRoute, readJson } from "@/lib/api/handler";
import { createCharacter, listCharacters, serializeCharacter } from "@/lib/services/characters";
import { createCharacterSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** GET /api/characters?search=…&archived=1 — character library */
export const GET = apiRoute(async (req, { app }) => {
  const sp = req.nextUrl.searchParams;
  const search = sp.get("search")?.slice(0, 100) || undefined;
  return { characters: await listCharacters(app, { search, includeArchived: sp.get("archived") === "1" }) };
});

/** POST /api/characters — create a draft profile (no image needed) */
export const POST = apiRoute(async (req, { app }) => {
  const input = await readJson(req, createCharacterSchema);
  return { character: serializeCharacter(await createCharacter(app, input)) };
});
