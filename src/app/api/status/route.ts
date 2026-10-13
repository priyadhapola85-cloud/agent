import { apiRoute } from "@/lib/api/handler";
import { getProviderStatus } from "@/lib/services/overview";

export const dynamic = "force-dynamic";

/** GET /api/status — which providers are configured (true/false only, never key values) */
export const GET = apiRoute(async (_req, { app }) => getProviderStatus(app));
