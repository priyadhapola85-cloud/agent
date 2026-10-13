import { apiRoute, readJson } from "@/lib/api/handler";
import { retryJob, toJobDTO } from "@/lib/services/jobs";
import { retryJobSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** POST /api/jobs/:id/retry — deliberately retry a FAILED job (creates a new job) */
export const POST = apiRoute<{ id: string }>(async (req, { app, params }) => {
  const { idempotencyKey } = await readJson(req, retryJobSchema);
  const { job, duplicate } = await retryJob(app, params.id, idempotencyKey);
  return { job: toJobDTO(job), duplicate };
});
