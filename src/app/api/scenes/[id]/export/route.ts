import { apiRoute } from "@/lib/api/handler";
import { serveAsset } from "@/lib/api/files";
import { getExport } from "@/lib/services/content";

export const dynamic = "force-dynamic";

/** GET /api/scenes/:id/export — downloads the APPROVED video (403 otherwise) */
export const GET = apiRoute<{ id: string }>(async (req, { app, params }) => {
  const { asset, filename } = await getExport(app, params.id);
  return serveAsset(app, asset, req, { download: true, filename });
});
