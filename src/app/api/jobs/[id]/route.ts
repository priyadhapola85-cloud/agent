import { apiRoute } from "@/lib/api/handler";
import { getJobWithOutputs } from "@/lib/services/jobs";

export const dynamic = "force-dynamic";

/** GET /api/jobs/:id — status + outputs (the UI polls this while a job runs) */
export const GET = apiRoute<{ id: string }>(async (_req, { app, params }) => ({ job: await getJobWithOutputs(app, params.id) }));
