import { apiRoute } from "@/lib/api/handler";
import { serveAsset } from "@/lib/api/files";
import { getAsset } from "@/lib/services/assets";

export const dynamic = "force-dynamic";

/** GET /api/assets/:id[?download=1] — streams a private image/video to a logged-in user */
export const GET = apiRoute<{ id: string }>(async (req, { app, params }) => {
  const asset = await getAsset(app, params.id);
  return serveAsset(app, asset, req, { download: req.nextUrl.searchParams.get("download") === "1" });
});
