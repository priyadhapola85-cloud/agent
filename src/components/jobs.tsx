"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import type { JobDTO } from "@/lib/services/jobs";
import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/hooks";
import { JOB_STATUS, PURPOSE_LABEL, timeAgo } from "@/lib/client/labels";
import { Badge, Button, ErrorNote } from "./ui";

export const isActiveJob = (j: { status: string }) => j.status === "queued" || j.status === "generating";

export function JobStatusBadge({ status }: { status: string }) {
  const s = JOB_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={s.tone} pulse={status === "queued" || status === "generating"}>
      {s.label}
    </Badge>
  );
}

/** Explains what is happening for a running/failed job, with a deliberate Retry button. */
export function JobProgress({ job, onChanged }: { job: JobDTO; onChanged?: () => void }) {
  const retry = useAction();
  if (job.status === "completed") return null;
  const waiting =
    job.status === "queued"
      ? job.providerRequestId
        ? "Waiting in the provider's queue…"
        : "Sending to the provider…"
      : job.kind === "video"
        ? "Generating video — this usually takes 1–5 minutes. You can leave this page; it continues in the background."
        : "Generating images — usually under a minute.";
  return (
    <div className="space-y-2 rounded-xl border border-line bg-paper p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <JobStatusBadge status={job.status} />
        <span className="text-muted">{PURPOSE_LABEL[job.purpose] ?? job.purpose}</span>
        <span className="text-muted">· started {timeAgo(job.createdAt)}</span>
      </div>
      {isActiveJob(job) && (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full w-1/3 animate-[progress_1.6s_ease-in-out_infinite] rounded-full bg-accent" />
          </div>
          <p className="text-muted">{waiting}</p>
          {job.errorMessage && <p className="text-amber-700">{job.errorMessage}</p>}
        </>
      )}
      {job.status === "failed" && (
        <>
          <ErrorNote error={{ message: job.errorMessage ?? "The job failed." }} />
          <Button
            size="sm"
            variant="secondary"
            busy={retry.busy}
            onClick={() =>
              retry.run(async (idempotencyKey) => {
                await api(`/api/jobs/${job.id}/retry`, { method: "POST", body: { idempotencyKey } });
                onChanged?.();
              })
            }
          >
            <RotateCcw className="h-3.5 w-3.5" /> Retry (starts a new paid generation)
          </Button>
          <ErrorNote error={retry.error} />
        </>
      )}
    </div>
  );
}

export function JobRow({ job, characterName }: { job: JobDTO; characterName?: string | null }) {
  const href = job.projectId ? `/content/${job.projectId}` : job.characterId ? `/characters/${job.characterId}` : "/history";
  return (
    <Link href={href} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm hover:bg-paper">
      <div className="min-w-0">
        <p className="truncate font-medium">
          {PURPOSE_LABEL[job.purpose] ?? job.purpose}
          {characterName ? ` · ${characterName}` : ""}
        </p>
        <p className="truncate text-xs text-muted">
          {job.model} · {timeAgo(job.createdAt)}
        </p>
      </div>
      <JobStatusBadge status={job.status} />
    </Link>
  );
}
