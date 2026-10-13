import { z } from "zod";
import { apiRoute } from "@/lib/api/handler";
import { VIDEO_STATUSES } from "@/lib/db/schema";
import { reviewQueue } from "@/lib/services/content";

export const dynamic = "force-dynamic";

const q = z.object({ status: z.enum(VIDEO_STATUSES).optional() });

/** GET /api/review?status=ready_for_review — the review & approval queue */
export const GET = apiRoute(async (req, { app }) => {
  const { status } = q.parse({ status: req.nextUrl.searchParams.get("status") || undefined });
  return { items: await reviewQueue(app, status) };
});
