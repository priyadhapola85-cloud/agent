import { z } from "zod";
import { apiRoute } from "@/lib/api/handler";
import { JOB_STATUSES } from "@/lib/db/schema";
import { listJobs } from "@/lib/services/overview";

export const dynamic = "force-dynamic";

const filters = z.object({
  kind: z.enum(["image", "video"]).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  characterId: z.string().max(60).optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** GET /api/jobs?kind=&status=&characterId=&search= — generation history */
export const GET = apiRoute(async (req, { app }) => {
  const raw = Object.fromEntries([...req.nextUrl.searchParams.entries()].filter(([, v]) => v !== ""));
  return { jobs: await listJobs(app, filters.parse(raw)) };
});
