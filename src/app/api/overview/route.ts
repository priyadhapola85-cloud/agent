import { apiRoute } from "@/lib/api/handler";
import { getOverview, getProviderStatus } from "@/lib/services/overview";

export const dynamic = "force-dynamic";

/** GET /api/overview — dashboard numbers */
export const GET = apiRoute(async (_req, { app }) => ({ ...(await getOverview(app)), status: getProviderStatus(app) }));
