"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, History } from "lucide-react";
import { useApiData } from "@/lib/client/hooks";
import { PURPOSE_LABEL } from "@/lib/client/labels";
import type { listJobs } from "@/lib/services/overview";
import { JobProgress, JobStatusBadge, isActiveJob } from "./jobs";
import { EmptyState, ErrorNote, Spinner, cx } from "./ui";

export type HistoryJob = Awaited<ReturnType<typeof listJobs>>[number];

/** Generation history list with filters applied via the query string. */
export function JobHistory({ query, emptyText }: { query: string; emptyText?: string }) {
  const { data, error, loading, reload } = useApiData<{ jobs: HistoryJob[] }>(`/api/jobs?${query}`, {
    pollMs: 4000,
    shouldPoll: (d) => d.jobs.some(isActiveJob),
  });
  const [open, setOpen] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNote error={error} />;
  if (!data?.jobs.length)
    return (
      <EmptyState icon={<History className="h-8 w-8" />} title="No generations found">
        {emptyText ?? "Generations appear here once you start one."}
      </EmptyState>
    );

  return (
    <ul className="card divide-y divide-line">
      {data.jobs.map((j) => {
        const href = j.projectId ? `/content/${j.projectId}` : j.characterId ? `/characters/${j.characterId}` : null;
        return (
          <li key={j.id} className="p-4 text-sm">
            <button className="flex w-full flex-wrap items-center gap-3 text-left" onClick={() => setOpen(open === j.id ? null : j.id)}>
              <JobStatusBadge status={j.status} />
              <span className="font-medium">{PURPOSE_LABEL[j.purpose] ?? j.purpose}</span>
              {j.characterName && <span className="text-muted">· {j.characterName}</span>}
              <span className="text-muted">· {new Date(j.createdAt).toLocaleString()}</span>
              {j.retryOfJobId && <span className="text-xs text-muted">(retry)</span>}
              <div className="ml-auto flex items-center gap-2">
                {j.outputs.slice(0, 4).map((o) =>
                  o.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={o.id} src={o.url} alt="" className="h-10 w-8 rounded object-cover" />
                  ) : (
                    <span key={o.id} className="rounded bg-ink px-1.5 py-0.5 text-[10px] text-white">MP4</span>
                  ),
                )}
                <ChevronDown className={cx("h-4 w-4 text-muted transition", open === j.id && "rotate-180")} />
              </div>
            </button>
            {open === j.id && (
              <div className="mt-3 space-y-3">
                <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  <div><dt className="inline text-muted">Job ID: </dt><dd className="inline font-mono">{j.id}</dd></div>
                  <div><dt className="inline text-muted">Provider / model: </dt><dd className="inline">{j.provider} / {j.model}</dd></div>
                  <div><dt className="inline text-muted">Character: </dt><dd className="inline font-mono">{j.characterId ?? "—"}</dd></div>
                  <div><dt className="inline text-muted">Reference images sent: </dt><dd className="inline">{j.referenceAssetIds.length}{j.inputAssetId ? " + start frame" : ""}</dd></div>
                  <div className="sm:col-span-2"><dt className="inline text-muted">Options: </dt><dd className="inline font-mono">{JSON.stringify(j.params)}</dd></div>
                </dl>
                <pre className="whitespace-pre-wrap rounded-lg bg-paper p-3 font-mono text-xs">{j.prompt}</pre>
                {j.negativePrompt && <p className="text-xs text-muted">Negative prompt: {j.negativePrompt}</p>}
                {j.outputs.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {j.outputs.map((o) =>
                      o.kind === "image" ? (
                        <a key={o.id} href={o.url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={o.url} alt="" className="h-32 rounded-lg object-cover" />
                        </a>
                      ) : (
                        <video key={o.id} src={o.url} controls className="h-48 rounded-lg bg-ink" />
                      ),
                    )}
                  </div>
                )}
                <ol className="space-y-1 border-l border-line pl-3 text-xs text-muted">
                  {j.history.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono">{new Date(e.at).toLocaleTimeString()}</span> — {e.from ? `${e.from} → ` : ""}
                      <strong className="text-ink">{e.to}</strong> {e.message && `· ${e.message}`}
                    </li>
                  ))}
                </ol>
                {(isActiveJob(j) || j.status === "failed") && <JobProgress job={j} onChanged={reload} />}
                {href && <Link href={href} className="text-xs underline">Open {j.projectId ? "project" : "character"}</Link>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
