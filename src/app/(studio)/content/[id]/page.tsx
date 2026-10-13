"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Bot, Check, ChevronDown, Download, FileText, Film, ImagePlus, Plus, Save, Trash2, Wand2, X } from "lucide-react";
import { BriefForm } from "@/components/brief-form";
import { JobProgress, isActiveJob } from "@/components/jobs";
import { ModelSelect, pickDefaultModel } from "@/components/model-select";
import { ProviderBanner } from "@/components/provider-banner";
import { Badge, Button, Card, ConfirmDialog, ErrorNote, Field, Notice, PageHeader, Spinner, Steps, cx } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useAction, useApiData } from "@/lib/client/hooks";
import { VIDEO_STATUS, timeAgo } from "@/lib/client/labels";
import type { ContentBrief } from "@/lib/db/schema";
import type { ProjectDetail } from "@/lib/services/content";

type Scene = ProjectDetail["scenes"][number];

export default function ProjectWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload, setData } = useApiData<ProjectDetail>(`/api/projects/${id}`, {
    pollMs: 3000,
    shouldPoll: (d) => d.scenes.some((s) => s.jobs.some(isActiveJob)),
  });

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return null;

  const scenes = data.scenes;
  const step = !scenes.length
    ? 1
    : scenes.every((s) => s.videoStatus === "approved")
      ? 5
      : scenes.some((s) => s.currentVideo)
        ? 4
        : scenes.some((s) => s.selectedImage)
          ? 3
          : 2;

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.project.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/characters/${data.character.id}`} className="flex items-center gap-2 underline-offset-2 hover:underline">
              {data.character.masterUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.character.masterUrl} alt="" className="h-7 w-6 rounded object-cover" />
              )}
              {data.character.name}
            </Link>
            · {data.project.brief.aspectRatio} · ~{data.project.brief.durationSeconds}s
          </span>
        }
      />
      <Steps steps={["Brief", "Storyboard", "Scene images", "Video", "Review & export"]} current={step} />
      <ProviderBanner need={["generation"]} />

      <BriefCard detail={data} onChanged={setData} />
      <PlanCard detail={data} onChanged={setData} />
      {scenes.length > 0 && <ConceptCard detail={data} onChanged={setData} />}

      {scenes.map((s, i) => (
        <SceneCard key={s.id} index={i} scene={s} detail={data} reload={reload} />
      ))}
      {data.project.plannedAt || scenes.length ? <AddSceneCard projectId={data.project.id} onChanged={setData} /> : null}
      <DeleteProject detail={data} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function BriefCard({ detail, onChanged }: { detail: ProjectDetail; onChanged: (d: ProjectDetail) => void }) {
  const [open, setOpen] = useState(!detail.scenes.length);
  const [brief, setBrief] = useState<ContentBrief>(detail.project.brief);
  const save = useAction();
  return (
    <Card
      title={<span className="flex items-center gap-2"><FileText className="h-4 w-4" /> Brief</span>}
      actions={
        <button className="text-muted" onClick={() => setOpen(!open)} aria-label="Toggle brief">
          <ChevronDown className={cx("h-4 w-4 transition", open && "rotate-180")} />
        </button>
      }
    >
      {!open ? (
        <p className="text-sm text-muted">
          {detail.project.brief.theme}
          {detail.project.brief.outfit ? ` · ${detail.project.brief.outfit}` : ""}
          {detail.project.brief.scene ? ` · ${detail.project.brief.scene}` : ""}
        </p>
      ) : (
        <>
          <BriefForm value={brief} onChange={setBrief} errors={save.error?.fields} />
          <div className="mt-4 flex items-center gap-3">
            <Button
              variant="secondary"
              busy={save.busy}
              onClick={() =>
                save.run(async () =>
                  onChanged(
                    await api<ProjectDetail>(`/api/projects/${detail.project.id}`, {
                      method: "PATCH",
                      body: { brief: Object.fromEntries(Object.entries(brief).filter(([, v]) => v !== "")) },
                    }),
                  ),
                )
              }
            >
              <Save className="h-4 w-4" /> Save brief
            </Button>
            <span className="text-xs text-muted">Changing the brief doesn&apos;t change existing scenes — re-plan or edit them.</span>
          </div>
          <div className="mt-3"><ErrorNote error={save.error} /></div>
        </>
      )}
    </Card>
  );
}

function PlanCard({ detail, onChanged }: { detail: ProjectDetail; onChanged: (d: ProjectDetail) => void }) {
  const plan = useAction();
  const [confirm, setConfirm] = useState<"claude" | "template" | null>(null);
  const has = detail.scenes.length > 0;
  const src = detail.project.plannerSource;

  const run = (planner: "claude" | "template") =>
    plan.run(async () => {
      onChanged(
        await api<ProjectDetail>(`/api/projects/${detail.project.id}/plan`, { method: "POST", body: { planner, replaceExisting: has } }),
      );
      setConfirm(null);
    });

  return (
    <Card title={<span className="flex items-center gap-2"><Wand2 className="h-4 w-4" /> Storyboard planner</span>}>
      {src && (
        <p className="mb-3 text-sm">
          Current storyboard:{" "}
          <Badge tone={src === "claude" ? "accent" : "neutral"}>
            {src === "claude" ? `AI-written (${detail.project.plannerModel})` : src === "template" ? "Template (no AI)" : "Edited manually"}
          </Badge>
        </p>
      )}
      <p className="mb-4 text-sm text-muted">
        Writes the concept, scene-by-scene storyboard, image and video prompts, transitions, caption and hashtags. This is text only — no
        images or videos are generated.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button busy={plan.busy && confirm !== "template"} disabled={!detail.planners.claude || plan.busy} onClick={() => (has ? setConfirm("claude") : run("claude"))}>
          <Bot className="h-4 w-4" /> {has ? "Re-plan with Claude" : "Plan with Claude (AI)"}
        </Button>
        <Button variant="secondary" busy={plan.busy && confirm === "template"} disabled={plan.busy} onClick={() => (has ? setConfirm("template") : run("template"))}>
          {has ? "Re-plan with basic template" : "Use basic template (no AI)"}
        </Button>
      </div>
      {!detail.planners.claude && (
        <p className="mt-2 text-xs text-muted">Claude planning is unavailable: ANTHROPIC_API_KEY is not set (see Settings).</p>
      )}
      <div className="mt-3"><ErrorNote error={plan.error} /></div>
      <ConfirmDialog
        open={!!confirm}
        title="Replace the current storyboard?"
        confirmLabel="Replace scenes"
        danger
        busy={plan.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && run(confirm)}
      >
        All existing scenes — including their generated images and videos — will be removed and replaced with a new plan.
      </ConfirmDialog>
    </Card>
  );
}

function ConceptCard({ detail, onChanged }: { detail: ProjectDetail; onChanged: (d: ProjectDetail) => void }) {
  const p = detail.project;
  const [concept, setConcept] = useState(p.concept);
  const [caption, setCaption] = useState(p.caption);
  const [hashtags, setHashtags] = useState(p.hashtags.join(" "));
  const [transitions, setTransitions] = useState(p.transitions.join("\n"));
  const [notes, setNotes] = useState(p.notes);
  const save = useAction();
  // When the project changes on the server (re-plan, caption edited in Review), show the new values.
  const [seen, setSeen] = useState(p.updatedAt);
  if (p.updatedAt !== seen) {
    setSeen(p.updatedAt);
    setConcept(p.concept);
    setCaption(p.caption);
    setHashtags(p.hashtags.join(" "));
    setTransitions(p.transitions.join("\n"));
    setNotes(p.notes);
  }

  return (
    <Card title="Concept, caption & hashtags">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Concept">
          <textarea className="input min-h-24" value={concept} onChange={(e) => setConcept(e.target.value)} />
        </Field>
        <Field label="Caption">
          <textarea className="input min-h-24" value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <Field label="Hashtags" hint="Separate with spaces">
          <input className="input" value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
        </Field>
        <Field label="Suggested transitions" hint="One per line">
          <textarea className="input min-h-16" value={transitions} onChange={(e) => setTransitions(e.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Content notes">
            <textarea className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="secondary"
          busy={save.busy}
          onClick={() =>
            save.run(async () =>
              onChanged(
                await api<ProjectDetail>(`/api/projects/${p.id}`, {
                  method: "PATCH",
                  body: {
                    concept,
                    caption,
                    notes,
                    hashtags: hashtags.split(/\s+/).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)),
                    transitions: transitions.split("\n").map((t) => t.trim()).filter(Boolean),
                  },
                }),
              ),
            )
          }
        >
          <Save className="h-4 w-4" /> Save
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(`${caption}\n\n${hashtags}`)}>
          Copy caption + hashtags
        </Button>
      </div>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Scene card: text → images → start frame → video → review
// ---------------------------------------------------------------------------

function SceneCard({
  scene,
  index,
  detail,
  reload,
}: {
  scene: Scene;
  index: number;
  detail: ProjectDetail;
  reload: () => void;
}) {
  const st = VIDEO_STATUS[scene.videoStatus];
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-display text-lg">Scene {index + 1}</span> <span className="text-muted">· {scene.title}</span>
          <Badge tone={st.tone} pulse={scene.videoStatus === "generating"}>{st.label}</Badge>
        </span>
      }
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <SceneTextEditor scene={scene} detail={detail} onSaved={reload} />
        <div className="space-y-6">
          <SceneImages scene={scene} detail={detail} reload={reload} />
          <SceneVideo scene={scene} detail={detail} reload={reload} />
        </div>
      </div>
    </Card>
  );
}

function SceneTextEditor({ scene, detail, onSaved }: { scene: Scene; detail: ProjectDetail; onSaved: () => void }) {
  const [f, setF] = useState(() => pickText(scene));
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useAction();
  const del = useAction();
  const [seen, setSeen] = useState(scene.updatedAt);
  if (scene.updatedAt !== seen) {
    setSeen(scene.updatedAt);
    if (!dirty) setF(pickText(scene));
  }
  const set = (k: keyof ReturnType<typeof pickText>, v: string | number) => {
    setF({ ...f, [k]: v });
    setDirty(true);
  };
  const durations = [...new Set(detail.videoModels.flatMap((m) => m.durations))].sort((a, b) => a - b);

  return (
    <div className="space-y-3">
      <Field label="Scene title">
        <input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} />
      </Field>
      <Field label="What happens">
        <textarea className="input min-h-16" value={f.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label="Image prompt (first frame)" hint="Pose, outfit, location, lighting. Identity is added automatically from the character.">
        <textarea className="input min-h-20" value={f.imagePrompt} onChange={(e) => set("imagePrompt", e.target.value)} />
      </Field>
      <Field label="Video prompt (motion)">
        <textarea className="input min-h-16" value={f.videoPrompt} onChange={(e) => set("videoPrompt", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Camera movement">
          <input className="input" value={f.cameraMovement} onChange={(e) => set("cameraMovement", e.target.value)} />
        </Field>
        <Field label="Clip length (s)">
          <select className="input" value={f.durationSeconds} onChange={(e) => set("durationSeconds", Number(e.target.value))}>
            {durations.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Transition to next">
          <input className="input" value={f.transition} onChange={(e) => set("transition", e.target.value)} />
        </Field>
        <Field label="On-screen text">
          <input className="input" value={f.onScreenText} onChange={(e) => set("onScreenText", e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <input className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          busy={save.busy}
          disabled={!dirty}
          onClick={() =>
            save.run(async () => {
              await api(`/api/scenes/${scene.id}`, { method: "PATCH", body: f });
              setDirty(false);
              onSaved();
            })
          }
        >
          <Save className="h-3.5 w-3.5" /> Save scene
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="h-3.5 w-3.5" /> Delete scene
        </Button>
        {dirty && <span className="self-center text-xs text-amber-700">Unsaved changes</span>}
      </div>
      <ErrorNote error={save.error ?? del.error} />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this scene?"
        confirmLabel="Delete"
        danger
        busy={del.busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          del.run(async () => {
            await api(`/api/scenes/${scene.id}`, { method: "DELETE" });
            setConfirmDelete(false);
            onSaved();
          })
        }
      >
        Its images and videos will be deleted too.
      </ConfirmDialog>
    </div>
  );
}

function pickText(s: Scene) {
  return {
    title: s.title,
    description: s.description,
    imagePrompt: s.imagePrompt,
    videoPrompt: s.videoPrompt,
    cameraMovement: s.cameraMovement,
    durationSeconds: s.durationSeconds,
    transition: s.transition,
    onScreenText: s.onScreenText,
    notes: s.notes,
  };
}

function SceneImages({ scene, detail, reload }: { scene: Scene; detail: ProjectDetail; reload: () => void }) {
  const [modelId, setModelId] = useState(() => pickDefaultModel(detail.imageModels, detail.defaultImageModel));
  const imageModel = detail.imageModels.find((m) => m.id === modelId);
  const [numImages, setNumImages] = useState(1);
  const [revision, setRevision] = useState("");
  const gen = useAction();
  const act = useAction();
  const imageJobs = scene.jobs.filter((j) => j.kind === "image" && (isActiveJob(j) || j.status === "failed")).slice(0, 2);
  const options = [
    ...scene.images.map((a) => ({ asset: a, label: "Scene image" })),
    ...detail.references.map((r) => ({ asset: r.asset, label: r.role === "master" ? "Master reference" : "Approved reference" })),
  ];

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ImagePlus className="h-4 w-4" /> First frame</h3>
      <p className="mb-3 text-xs text-muted">
        Generate scene images with the character&apos;s approved references, or start directly from the master reference. The selected
        image becomes the video&apos;s first frame.
      </p>
      <div className="mb-2">
        <ModelSelect label="Image model" models={detail.imageModels} value={modelId} onChange={setModelId} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <select className="input w-auto" value={numImages} onChange={(e) => setNumImages(Number(e.target.value))} aria-label="Number of images">
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} image{n > 1 ? "s" : ""}</option>)}
        </select>
        <input className="input min-w-40 flex-1" placeholder="Revision notes (optional)" value={revision} onChange={(e) => setRevision(e.target.value)} />
        <Button
          size="sm"
          busy={gen.busy}
          disabled={!imageModel?.ready}
          title={!imageModel?.ready ? "This model needs a fal.ai key with credit — choose a free model" : undefined}
          onClick={() =>
            gen.run(async (idempotencyKey) => {
              await api(`/api/scenes/${scene.id}/images`, {
                method: "POST",
                body: { model: modelId, numImages, resolution: "1K", revisionNotes: revision || undefined, idempotencyKey },
              });
              reload();
            })
          }
        >
          Generate scene images
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        <ErrorNote error={gen.error ?? act.error} />
        {imageJobs.map((j) => <JobProgress key={j.id} job={j} onChanged={reload} />)}
      </div>
      {options.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {options.map(({ asset, label }) => {
            const selected = scene.selectedImageAssetId === asset.id;
            const rejected = asset.reviewStatus === "rejected" && label === "Scene image";
            return (
              <div key={`${label}-${asset.id}`} className={cx("overflow-hidden rounded-lg border", selected ? "border-accent ring-2 ring-accent/40" : "border-line")}>
                <a href={asset.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.url} alt={label} className={cx("aspect-[9/16] w-full bg-paper object-cover", rejected && "opacity-40 grayscale")} />
                </a>
                <div className="space-y-1 p-1.5">
                  <p className="truncate text-[10px] text-muted">{label}</p>
                  {selected ? (
                    <Badge tone="accent"><Check className="h-3 w-3" /> Start frame</Badge>
                  ) : rejected ? (
                    <Badge tone="danger">Rejected</Badge>
                  ) : (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="px-1.5"
                        busy={act.busy}
                        onClick={() => act.run(async () => { await api(`/api/scenes/${scene.id}/select-image`, { method: "POST", body: { assetId: asset.id } }); reload(); })}
                      >
                        Use
                      </Button>
                      {label === "Scene image" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-1.5"
                          aria-label="Reject image"
                          onClick={() => act.run(async () => { await api(`/api/assets/${asset.id}/review`, { method: "POST", body: { decision: "rejected" } }); reload(); })}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SceneVideo({ scene, detail, reload }: { scene: Scene; detail: ProjectDetail; reload: () => void }) {
  const [model, setModel] = useState(() => pickDefaultModel(detail.videoModels, detail.defaultVideoModel));
  const [audio, setAudio] = useState(false);
  const [revision, setRevision] = useState("");
  const [note, setNote] = useState("");
  const [confirmRegen, setConfirmRegen] = useState(false);
  const gen = useAction();
  const review = useAction();
  const m = detail.videoModels.find((x) => x.id === model);
  const durationOk = !!m?.durations.includes(scene.durationSeconds);
  const videoJobs = scene.jobs.filter((j) => j.kind === "video" && (isActiveJob(j) || (j.status === "failed" && scene.videoStatus === "failed"))).slice(0, 1);
  const busyGenerating = scene.videoStatus === "generating";
  const hasVideo = !!scene.currentVideo;

  const start = () =>
    gen.run(async (idempotencyKey) => {
      await api(`/api/scenes/${scene.id}/video`, {
        method: "POST",
        body: { model, generateAudio: audio, revisionNotes: revision || undefined, idempotencyKey },
      });
      setConfirmRegen(false);
      setRevision("");
      reload();
    });

  const blocked = !m?.ready
    ? "This model needs a fal.ai key with credit — choose the free model."
    : !scene.selectedImageAssetId
      ? "Choose a start frame first."
      : !durationOk
        ? `${m?.label} supports ${m?.durations.join("/")}s clips — change the scene's clip length.`
        : busyGenerating
          ? "A video is generating."
          : null;

  return (
    <div className="border-t border-line pt-5">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Film className="h-4 w-4" /> Video</h3>

      {hasVideo && (
        <div className="mb-4">
          <video key={scene.currentVideo!.id} src={scene.currentVideo!.url} controls playsInline className="max-h-[480px] w-full rounded-xl bg-ink" />
          <p className="mt-1 text-xs text-muted">Generated {timeAgo(scene.currentVideo!.createdAt)}</p>
          {(scene.videoStatus === "ready_for_review" || scene.videoStatus === "approved" || scene.videoStatus === "rejected") && (
            <div className="mt-3 space-y-2 rounded-xl bg-paper p-3">
              <input className="input" placeholder="Review note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
              <div className="flex flex-wrap gap-2">
                {scene.videoStatus !== "approved" && (
                  <Button size="sm" variant="success" busy={review.busy} onClick={() => review.run(async () => { await api(`/api/scenes/${scene.id}/review`, { method: "POST", body: { decision: "approved", note } }); setNote(""); reload(); })}>
                    <Check className="h-3.5 w-3.5" /> Approve for export
                  </Button>
                )}
                {scene.videoStatus !== "rejected" && (
                  <Button size="sm" variant="danger" busy={review.busy} onClick={() => review.run(async () => { await api(`/api/scenes/${scene.id}/review`, { method: "POST", body: { decision: "rejected", note } }); setNote(""); reload(); })}>
                    <X className="h-3.5 w-3.5" /> Reject
                  </Button>
                )}
                {scene.exportable && (
                  <a href={`/api/scenes/${scene.id}/export`} className="inline-flex items-center gap-2 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white hover:bg-ink/85">
                    <Download className="h-3.5 w-3.5" /> Download MP4
                  </a>
                )}
              </div>
              <ErrorNote error={review.error} />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <ModelSelect label="Video model" models={detail.videoModels} value={model} onChange={setModel} />
        <Field label="Revision notes (optional)">
          <input className="input" placeholder="e.g. slower walk, less camera shake" value={revision} onChange={(e) => setRevision(e.target.value)} />
        </Field>
      </div>
      {m && <p className="mt-1 text-xs text-muted">{scene.durationSeconds}s clip · {m.priceNote}</p>}
      {m?.supportsAudio && (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Generate native audio (costs more; most Reels use music added later)
        </label>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" busy={gen.busy} disabled={!!blocked} onClick={() => (scene.videoStatus === "approved" ? setConfirmRegen(true) : start())}>
          <Film className="h-3.5 w-3.5" /> {hasVideo ? "Regenerate video" : "Generate video"}
        </Button>
        {blocked && <span className="text-xs text-muted">{blocked}</span>}
      </div>
      <div className="mt-3 space-y-2">
        <ErrorNote error={gen.error} />
        {videoJobs.map((j) => <JobProgress key={j.id} job={j} onChanged={reload} />)}
      </div>
      {scene.approvals.length > 0 && (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer">Approval history ({scene.approvals.length})</summary>
          <ul className="mt-2 space-y-1">
            {scene.approvals.map((a) => (
              <li key={a.id}>
                <strong className="text-ink">{a.decision}</strong> · {new Date(a.createdAt).toLocaleString()} {a.note ? `· “${a.note}”` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ConfirmDialog
        open={confirmRegen}
        title="Regenerate an approved video?"
        confirmLabel="Regenerate"
        busy={gen.busy}
        onCancel={() => setConfirmRegen(false)}
        onConfirm={start}
      >
        This starts a new paid generation and <strong>clears the current approval</strong>. The new version must be reviewed again before
        export.
      </ConfirmDialog>
      {!hasVideo && !busyGenerating && scene.videoStatus === "draft" && scene.selectedImageAssetId && (
        <div className="mt-3">
          <Notice>Videos take about 1–5 minutes. You can keep working — the status updates automatically.</Notice>
        </div>
      )}
    </div>
  );
}

function AddSceneCard({ projectId, onChanged }: { projectId: string; onChanged: (d: ProjectDetail) => void }) {
  const [title, setTitle] = useState("");
  const add = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="input max-w-xs" placeholder="New scene title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Button
        variant="secondary"
        busy={add.busy}
        disabled={!title.trim()}
        onClick={() =>
          add.run(async () => {
            onChanged(await api<ProjectDetail>(`/api/projects/${projectId}/scenes`, { method: "POST", body: { title } }));
            setTitle("");
          })
        }
      >
        <Plus className="h-4 w-4" /> Add scene manually
      </Button>
      <ErrorNote error={add.error} />
    </div>
  );
}

function DeleteProject({ detail }: { detail: ProjectDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const del = useAction();
  return (
    <div className="border-t border-line pt-6">
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" /> Delete project
      </Button>
      <ErrorNote error={del.error} />
      <ConfirmDialog
        open={open}
        title={`Delete "${detail.project.title}"?`}
        confirmLabel="Delete forever"
        danger
        busy={del.busy}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          del.run(async () => {
            await api(`/api/projects/${detail.project.id}`, { method: "DELETE" });
            router.push("/content");
          })
        }
      >
        The brief, storyboard, scene images and videos (including approved ones) will be permanently deleted. Download anything you need
        first.
      </ConfirmDialog>
    </div>
  );
}
