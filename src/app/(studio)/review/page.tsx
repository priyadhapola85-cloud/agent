"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckSquare, Download, Pencil, Save, X, Check } from "lucide-react";
import { Badge, Button, EmptyState, ErrorNote, PageHeader, Spinner, cx } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useAction, useApiData } from "@/lib/client/hooks";
import { VIDEO_STATUS, timeAgo } from "@/lib/client/labels";
import type { ReviewItem } from "@/lib/services/content";

const TABS = [
  { key: "ready_for_review", label: "Ready for review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "generating", label: "Generating" },
  { key: "failed", label: "Failed" },
  { key: "", label: "All" },
];

function ReviewQueue() {
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("status") ?? "ready_for_review");
  const { data, error, loading, reload } = useApiData<{ items: ReviewItem[] }>(`/api/review${tab ? `?status=${tab}` : ""}`, {
    pollMs: 4000,
    shouldPoll: (d) => d.items.some((i) => i.scene.videoStatus === "generating"),
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cx("rounded-full px-3 py-1.5 text-sm", tab === t.key ? "bg-ink text-white" : "bg-surface text-muted hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
      {loading && !data ? (
        <Spinner />
      ) : !data?.items.length ? (
        <EmptyState icon={<CheckSquare className="h-8 w-8" />} title="Nothing here">
          {tab === "ready_for_review" ? "Generated videos waiting for your decision appear here." : "No videos with this status."}
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {data.items.map((item) => (
            <ReviewCard key={item.scene.id} item={item} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ item, onChanged }: { item: ReviewItem; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [caption, setCaption] = useState(item.caption);
  const decide = useAction();
  const saveCaption = useAction();
  const st = VIDEO_STATUS[item.scene.videoStatus];
  const s = item.scene;

  return (
    <article className="card overflow-hidden">
      <div className="grid sm:grid-cols-2">
        <div className="bg-ink">
          {item.video ? (
            <video src={item.video.url} controls playsInline className="aspect-[9/16] h-full w-full object-contain" />
          ) : (
            <div className="flex aspect-[9/16] items-center justify-center text-sm text-white/60">
              {s.videoStatus === "generating" ? "Generating…" : "No video yet"}
            </div>
          )}
        </div>
        <div className="space-y-3 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={st.tone} pulse={s.videoStatus === "generating"}>{st.label}</Badge>
            <span className="text-xs text-muted">updated {timeAgo(s.updatedAt)}</span>
          </div>
          <div>
            <p className="font-medium">{item.characterName}</p>
            <Link href={`/content/${item.projectId}`} className="text-muted underline-offset-2 hover:underline">
              {item.projectTitle} · Scene {s.position + 1}: {s.title}
            </Link>
          </div>
          {item.concept && <p className="text-muted"><span className="font-medium text-ink">Concept:</span> {item.concept}</p>}
          <p className="text-muted">
            <span className="font-medium text-ink">Scene:</span> {s.description || s.videoPrompt} ({s.durationSeconds}s
            {s.cameraMovement ? `, ${s.cameraMovement}` : ""})
          </p>
          <label className="block">
            <span className="label">Caption / notes</span>
            <textarea className="input min-h-16" value={caption} onChange={(e) => setCaption(e.target.value)} />
          </label>
          <Button
            size="sm"
            variant="ghost"
            busy={saveCaption.busy}
            disabled={caption === item.caption}
            onClick={() => saveCaption.run(async () => { await api(`/api/projects/${item.projectId}`, { method: "PATCH", body: { caption } }); onChanged(); })}
          >
            <Save className="h-3.5 w-3.5" /> Save caption
          </Button>

          {item.video && s.videoStatus !== "generating" && (
            <>
              <input className="input" placeholder="Decision note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                {s.videoStatus !== "approved" && (
                  <Button size="sm" variant="success" busy={decide.busy} onClick={() => decide.run(async () => { await api(`/api/scenes/${s.id}/review`, { method: "POST", body: { decision: "approved", note } }); onChanged(); })}>
                    <Check className="h-3.5 w-3.5" /> Approve
                  </Button>
                )}
                {s.videoStatus !== "rejected" && (
                  <Button size="sm" variant="danger" busy={decide.busy} onClick={() => decide.run(async () => { await api(`/api/scenes/${s.id}/review`, { method: "POST", body: { decision: "rejected", note } }); onChanged(); })}>
                    <X className="h-3.5 w-3.5" /> Reject
                  </Button>
                )}
                <Link href={`/content/${item.projectId}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:border-ink/40">
                  <Pencil className="h-3.5 w-3.5" /> Revise / regenerate
                </Link>
                {item.exportable && (
                  <a href={`/api/scenes/${s.id}/export`} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white">
                    <Download className="h-3.5 w-3.5" /> Download MP4
                  </a>
                )}
              </div>
            </>
          )}
          <ErrorNote error={decide.error ?? saveCaption.error} />
        </div>
      </div>
    </article>
  );
}

export default function ReviewPage() {
  return (
    <div>
      <PageHeader
        title="Review & approval"
        subtitle="Approve videos for export, reject the ones that miss. Approval here only unlocks the download — nothing is posted anywhere."
      />
      <Suspense fallback={<Spinner />}>
        <ReviewQueue />
      </Suspense>
    </div>
  );
}
