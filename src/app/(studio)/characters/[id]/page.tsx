"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Archive, ChevronDown, Columns2, Crown, ImagePlus, Plus, ScanSearch, Sparkles, Trash2, Undo2, Upload, X } from "lucide-react";
import { CharacterProfileForm, cleanProfile, type ProfileDraft } from "@/components/character-profile-form";
import { JobProgress, JobStatusBadge, isActiveJob } from "@/components/jobs";
import { ModelSelect, pickDefaultModel, type ModelOption } from "@/components/model-select";
import { ProviderBanner, useProviderStatus } from "@/components/provider-banner";
import { Badge, Button, ButtonLink, Card, ConfirmDialog, ErrorNote, Field, Notice, PageHeader, Spinner, Steps, cx } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useAction, useApiData } from "@/lib/client/hooks";
import { CHARACTER_STATUS, timeAgo } from "@/lib/client/labels";
import type { CharacterDetail } from "@/lib/services/characters";

const STEP_INDEX: Record<string, number> = { draft: 1, reference_uploaded: 2, ready_to_generate: 3, active: 5, archived: 5 };

export default function DesignStudioPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload, setData } = useApiData<CharacterDetail>(`/api/characters/${id}`, {
    pollMs: 3000,
    shouldPoll: (d) => d.jobs.some(isActiveJob),
  });
  const providers = useProviderStatus();

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return null;

  const c = data.character;
  const status = CHARACTER_STATUS[c.status];
  const hasCandidates = data.candidates.length > 0;
  const step = c.status === "ready_to_generate" && hasCandidates ? 4 : STEP_INDEX[c.status];

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>{status.hint}</span>
            <span className="font-mono text-xs">{c.id}</span>
          </span>
        }
        actions={
          c.status === "active" && (
            <ButtonLink href={`/content/new?characterId=${c.id}`}>
              <Plus className="h-4 w-4" /> Create content with {c.name}
            </ButtonLink>
          )
        }
      />
      <Steps steps={["Create profile", "Upload reference", "Review description", "Generate candidates", "Approve master"]} current={step} />
      <ProviderBanner need={["generation", "anthropic"]} />

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-2">
          <ReferenceUpload detail={data} onChanged={setData} />
          <ReferencesPanel detail={data} onChanged={setData} />
        </div>
        <div className="space-y-6 xl:col-span-3">
          <ProfileEditor detail={data} onChanged={setData} analyzerReady={!!providers?.anthropic.configured} />
          {providers && (
            <GeneratePanel detail={data} onChanged={reload} models={providers.imageModels} defaultModel={providers.generation.imageModel} />
          )}
        </div>
      </div>

      <CandidatesGallery detail={data} onChanged={setData} />
      <HistoryPanel detail={data} onChanged={reload} />
      <DangerZone detail={data} onChanged={setData} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — upload the reference
// ---------------------------------------------------------------------------

function ReferenceUpload({ detail, onChanged }: { detail: CharacterDetail; onChanged: (d: CharacterDetail) => void }) {
  const source = detail.references.find((r) => r.role === "source");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rights, setRights] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const upload = useAction();

  // Free the temporary preview URL when it is replaced or the page closes.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function choose(f: File | null) {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  function pick(f: File | undefined) {
    setLocalError(null);
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return setLocalError("Please choose a JPG, PNG or WebP image.");
    if (f.size > 5 * 1024 * 1024) return setLocalError("That image is over 5 MB. Please resize or compress it first.");
    choose(f);
  }

  return (
    <Card title="1 · Reference image" actions={source && <Badge tone="success">Uploaded</Badge>}>
      {source && !file && (
        <div className="mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={source.asset.url} alt="Uploaded reference" className="max-h-80 w-full rounded-xl bg-paper object-contain" />
          <p className="mt-2 text-xs text-muted">
            {source.asset.width}×{source.asset.height} · uploaded {timeAgo(source.asset.createdAt)} · stored privately
          </p>
        </div>
      )}

      <label
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-paper px-4 py-6 text-center text-sm text-muted hover:border-accent"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files?.[0]);
        }}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Selected" className="mb-2 max-h-64 rounded-lg object-contain" />
        ) : (
          <ImagePlus className="mb-2 h-8 w-8" />
        )}
        <span>{file ? file.name : source ? "Replace the reference — drop an image or click" : "Drop an image here or click to choose"}</span>
        <span className="mt-1 text-xs">JPG, PNG or WebP · max 5 MB · at least 256 px · clear, well-lit face works best</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      </label>

      {file && (
        <div className="mt-4 space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={rights} onChange={(e) => setRights(e.target.checked)} />
            <span>
              I own this image or have permission to use it. If it shows a real person, I have their consent to create a character
              from their likeness.
            </span>
          </label>
          <div className="flex gap-2">
            <Button
              busy={upload.busy}
              disabled={!rights}
              onClick={() =>
                upload.run(async () => {
                  const form = new FormData();
                  form.set("file", file);
                  form.set("rightsConfirmed", String(rights));
                  const d = await api<CharacterDetail>(`/api/characters/${detail.character.id}/reference-upload`, { method: "POST", form });
                  choose(null);
                  setRights(false);
                  onChanged(d);
                })
              }
            >
              <Upload className="h-4 w-4" /> Upload reference
            </Button>
            <Button variant="ghost" onClick={() => choose(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {localError && <ErrorNote error={{ message: localError }} />}
        <ErrorNote error={upload.error} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — analysis + editable description
// ---------------------------------------------------------------------------

function toDraft(d: CharacterDetail): ProfileDraft {
  return { name: d.character.name, description: d.character.description, identity: d.character.identity, style: d.character.style };
}

function ProfileEditor({
  detail,
  onChanged,
  analyzerReady,
}: {
  detail: CharacterDetail;
  onChanged: (d: CharacterDetail) => void;
  analyzerReady: boolean;
}) {
  const [draft, setDraft] = useState<ProfileDraft>(() => toDraft(detail));
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(detail.character.status !== "active");
  const [overwrite, setOverwrite] = useState(false);
  const save = useAction();
  const analyze = useAction();
  const hasSource = detail.references.some((r) => r.role === "source");
  const reviewed = !!detail.character.descriptionReviewedAt;

  // Pick up server changes (e.g. after analysis) unless the user is mid-edit.
  const serverVersion = detail.character.updatedAt;
  const [seenVersion, setSeenVersion] = useState(serverVersion);
  if (serverVersion !== seenVersion) {
    setSeenVersion(serverVersion);
    if (!dirty) setDraft(toDraft(detail));
  }

  async function doSave(markReviewed: boolean) {
    await save.run(async () => {
      const d = await api<CharacterDetail>(`/api/characters/${detail.character.id}`, {
        method: "PATCH",
        body: { ...cleanProfile(draft), markReviewed },
      });
      setDirty(false);
      setDraft(toDraft(d));
      onChanged(d);
    });
  }

  const a = detail.character.analysis;
  return (
    <Card
      title="2 · Character description"
      actions={
        <div className="flex items-center gap-2">
          {reviewed && <Badge tone="success">Reviewed</Badge>}
          <button className="text-muted" onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"}>
            <ChevronDown className={cx("h-4 w-4 transition", open && "rotate-180")} />
          </button>
        </div>
      }
    >
      {!open ? (
        <p className="text-sm text-muted">{detail.character.description || "No description yet."}</p>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl bg-paper p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <ScanSearch className="h-4 w-4" /> Analyze the reference with Claude
                </p>
                <p className="text-xs text-muted">
                  {analyzerReady
                    ? "Describes only what's visible (face, hair, styling, light). You review everything before generating."
                    : "Unavailable — ANTHROPIC_API_KEY is not set. Write the description yourself instead."}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Overwrite my text
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  busy={analyze.busy}
                  disabled={!analyzerReady || !hasSource || dirty}
                  title={dirty ? "Save your edits first" : !hasSource ? "Upload a reference first" : undefined}
                  onClick={() =>
                    analyze.run(async () => {
                      const d = await api<CharacterDetail>(`/api/characters/${detail.character.id}/analyze`, {
                        method: "POST",
                        body: { mode: overwrite ? "overwrite" : "fill_empty" },
                      });
                      onChanged(d);
                      setDraft(toDraft(d));
                    })
                  }
                >
                  {analyze.busy ? "Analyzing…" : "Analyze reference"}
                </Button>
              </div>
            </div>
            {a && (
              <p className="mt-3 text-xs text-muted">
                Last analysis by {a.model}, {timeAgo(a.analyzedAt)}.{a.notes ? ` Notes: ${a.notes}` : ""}
              </p>
            )}
            <div className="mt-2">
              <ErrorNote error={analyze.error} />
            </div>
          </div>

          <CharacterProfileForm
            value={draft}
            onChange={(v) => {
              setDraft(v);
              setDirty(true);
            }}
            fieldErrors={save.error?.fields}
          />

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button variant="secondary" busy={save.busy} disabled={!dirty} onClick={() => doSave(false)}>
              Save draft
            </Button>
            <Button busy={save.busy} disabled={!hasSource || !draft.name.trim()} onClick={() => doSave(true)}>
              Save & mark reviewed
            </Button>
            {!hasSource && <span className="text-xs text-muted">Upload a reference image before marking reviewed.</span>}
          </div>
          <ErrorNote error={save.error} />
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — generate candidates (only when the user clicks)
// ---------------------------------------------------------------------------

function GeneratePanel({
  detail,
  onChanged,
  models,
  defaultModel,
}: {
  detail: CharacterDetail;
  onChanged: () => void;
  models: (ModelOption & { aspectRatios: string[]; resolutions: string[]; maxReferences: number })[];
  defaultModel: string;
}) {
  const [modelId, setModelId] = useState(() => pickDefaultModel(models, defaultModel));
  const model = models.find((m) => m.id === modelId);
  const [numImages, setNumImages] = useState(2);
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [resolution, setResolution] = useState("1K");
  const [revisionNotes, setRevisionNotes] = useState("");
  const gen = useAction();
  const active = detail.jobs.filter((j) => j.purpose === "character_candidate" && (isActiveJob(j) || j.status === "failed")).slice(0, 3);
  const enabledRefs = detail.references.filter((r) => r.useForGeneration).length;

  const blocked = !model?.ready
    ? "This model needs a fal.ai key with credit — choose a free model."
    : !detail.canGenerate
      ? detail.character.status === "draft"
        ? "Upload a reference image first."
        : 'Review the description and press "Save & mark reviewed" first.'
      : enabledRefs === 0
        ? 'Turn on "Use for generation" for at least one reference.'
        : null;

  return (
    <Card title={detail.character.status === "active" ? "Generate more reference images" : "3 · Generate candidates"}>
      <p className="mb-4 text-sm text-muted">
        Sends {model && model.maxReferences < enabledRefs ? `your top reference image (master first)` : `your enabled reference images (${enabledRefs})`} plus
        the description to <strong>{model?.label}</strong>.{" "}
        {model?.free
          ? "Free models share a small daily GPU allowance on Hugging Face — start with 1–2 images."
          : "Each click is a paid generation."}{" "}
        Identity consistency is good but not guaranteed — compare results and reject any that drift.
      </p>
      <div className="mb-4">
        <ModelSelect label="Image model" models={models} value={modelId} onChange={setModelId} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Images">
          <select className="input" value={numImages} onChange={(e) => setNumImages(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        {model && model.aspectRatios.length > 0 && (
          <Field label="Aspect ratio">
            <select className="input" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
              {["3:4", "4:5", "9:16", "1:1", "16:9"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
        )}
        {model && model.resolutions.length > 1 && (
          <Field label="Resolution" hint="Higher costs more">
            <select className="input" value={resolution} onChange={(e) => setResolution(e.target.value)}>
              {model.resolutions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <div className="mt-4">
        <Field label="Revision instructions (optional)" hint="e.g. 'slightly shorter hair, softer smile, studio grey background'">
          <textarea className="input min-h-16" maxLength={1000} value={revisionNotes} onChange={(e) => setRevisionNotes(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          busy={gen.busy}
          disabled={!!blocked}
          onClick={() =>
            gen.run(async (idempotencyKey) => {
              await api(`/api/characters/${detail.character.id}/candidates`, {
                method: "POST",
                body: {
                  model: modelId,
                  numImages,
                  aspectRatio,
                  resolution: model && model.resolutions.includes(resolution) ? resolution : "1K",
                  revisionNotes: revisionNotes || undefined,
                  idempotencyKey,
                },
              });
              onChanged();
            })
          }
        >
          <Sparkles className="h-4 w-4" /> {revisionNotes ? "Regenerate with revisions" : "Generate candidates"}
        </Button>
        {blocked && <span className="text-xs text-muted">{blocked}</span>}
      </div>
      <div className="mt-4 space-y-3">
        <ErrorNote error={gen.error} />
        {active.map((j) => (
          <JobProgress key={j.id} job={j} onChanged={onChanged} />
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Candidates — approve master / extra references, reject, compare
// ---------------------------------------------------------------------------

function CandidatesGallery({ detail, onChanged }: { detail: CharacterDetail; onChanged: (d: CharacterDetail) => void }) {
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [compare, setCompare] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const act = useAction();
  const master = detail.references.find((r) => r.role === "master");
  const source = detail.references.find((r) => r.role === "source");

  const list = useMemo(
    () => detail.candidates.filter((c) => filter === "all" || c.reviewStatus === filter),
    [detail.candidates, filter],
  );
  const comparing = detail.candidates.find((c) => c.id === compare);

  async function refresh() {
    onChanged(await api<CharacterDetail>(`/api/characters/${detail.character.id}`));
  }

  if (detail.candidates.length === 0)
    return (
      <Card title="Candidates">
        <p className="text-sm text-muted">Generated candidate images will appear here for you to compare and approve.</p>
      </Card>
    );

  return (
    <Card
      title={`Candidates (${detail.candidates.length})`}
      actions={
        <div className="flex gap-1 text-xs">
          {(["all", "pending", "approved", "rejected"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cx("rounded-full px-3 py-1", filter === f ? "bg-ink text-white" : "bg-paper text-muted hover:text-ink")}
            >
              {f}
            </button>
          ))}
        </div>
      }
    >
      <ErrorNote error={act.error} />
      <div className="mt-2 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {list.map((img) => (
          <div key={img.id} className={cx("overflow-hidden rounded-xl border", img.referenceRole === "master" ? "border-accent ring-2 ring-accent/30" : "border-line")}>
            <a href={img.url} target="_blank" rel="noreferrer" className="block bg-paper">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="Candidate" className={cx("aspect-[3/4] w-full object-cover", img.reviewStatus === "rejected" && "opacity-40 grayscale")} />
            </a>
            <div className="space-y-2 p-2">
              <div className="flex flex-wrap gap-1">
                {img.referenceRole === "master" && <Badge tone="accent"><Crown className="h-3 w-3" /> Master</Badge>}
                {img.referenceRole === "approved" && <Badge tone="success">Reference</Badge>}
                {img.reviewStatus === "rejected" && <Badge tone="danger">Rejected</Badge>}
                <span className="text-[11px] text-muted">{timeAgo(img.createdAt)}</span>
              </div>
              {img.reviewNote && <p className="text-xs text-muted">“{img.reviewNote}”</p>}
              <div className="flex flex-wrap gap-1">
                {img.reviewStatus !== "rejected" && img.referenceRole !== "master" && (
                  <Button
                    size="sm"
                    busy={act.busy}
                    onClick={() =>
                      act.run(async () =>
                        onChanged(await api<CharacterDetail>(`/api/characters/${detail.character.id}/references`, { method: "POST", body: { assetId: img.id, role: "master" } })),
                      )
                    }
                  >
                    <Crown className="h-3 w-3" /> Approve as master
                  </Button>
                )}
                {img.reviewStatus !== "rejected" && !img.referenceRole && (
                  <Button
                    size="sm"
                    variant="secondary"
                    busy={act.busy}
                    onClick={() =>
                      act.run(async () =>
                        onChanged(await api<CharacterDetail>(`/api/characters/${detail.character.id}/references`, { method: "POST", body: { assetId: img.id, role: "approved" } })),
                      )
                    }
                  >
                    Add as reference
                  </Button>
                )}
                {(master || source) && (
                  <Button size="sm" variant="ghost" onClick={() => setCompare(img.id)}>
                    <Columns2 className="h-3 w-3" /> Compare
                  </Button>
                )}
                {!img.referenceRole && img.reviewStatus !== "rejected" && (
                  <Button size="sm" variant="danger" onClick={() => { setRejecting(img.id); setNote(""); }}>
                    Reject
                  </Button>
                )}
                {img.reviewStatus === "rejected" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => act.run(async () => { await api(`/api/assets/${img.id}/review`, { method: "POST", body: { decision: "pending" } }); await refresh(); })}
                  >
                    <Undo2 className="h-3 w-3" /> Undo reject
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!rejecting}
        title="Reject this image?"
        confirmLabel="Reject"
        danger
        busy={act.busy}
        onCancel={() => setRejecting(null)}
        onConfirm={() =>
          act.run(async () => {
            await api(`/api/assets/${rejecting}/review`, { method: "POST", body: { decision: "rejected", note } });
            setRejecting(null);
            await refresh();
          })
        }
      >
        <p className="mb-2">Rejected images are kept in history but can&apos;t be used as references or start frames.</p>
        <input className="input" placeholder="Why? (optional) e.g. face shape drifted" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </ConfirmDialog>

      {comparing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4" onClick={() => setCompare(null)}>
          <div className="max-h-full w-full max-w-5xl overflow-auto rounded-2xl bg-surface p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Compare with approved references</h3>
              <button onClick={() => setCompare(null)} aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: "This candidate", url: comparing.url },
                ...(master ? [{ label: "Master reference", url: master.asset.url }] : []),
                ...(source ? [{ label: "Your uploaded reference", url: source.asset.url }] : []),
              ].map((x) => (
                <figure key={x.label}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={x.url} alt={x.label} className="max-h-[70vh] w-full rounded-xl bg-paper object-contain" />
                  <figcaption className="mt-1 text-center text-xs text-muted">{x.label}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Approved references
// ---------------------------------------------------------------------------

function ReferencesPanel({ detail, onChanged }: { detail: CharacterDetail; onChanged: (d: CharacterDetail) => void }) {
  const act = useAction();
  const [removing, setRemoving] = useState<string | null>(null);
  const refs = [...detail.references].sort((a, b) => ({ master: 0, source: 1, approved: 2 })[a.role] - ({ master: 0, source: 1, approved: 2 })[b.role]);
  const path = (refId: string) => `/api/characters/${detail.character.id}/references/${refId}`;

  return (
    <Card title="Reference set">
      <p className="mb-3 text-xs text-muted">
        Images marked <em>use for generation</em> are sent with every new image request (master first, max 4).
      </p>
      {refs.length === 0 ? (
        <p className="text-sm text-muted">No references yet.</p>
      ) : (
        <ul className="space-y-3">
          {refs.map((r) => (
            <li key={r.id} className="flex gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.asset.url} alt={r.role} className="h-20 w-16 shrink-0 rounded-lg bg-paper object-cover" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.role === "master" ? "accent" : r.role === "source" ? "info" : "success"}>
                    {r.role === "master" ? "Master" : r.role === "source" ? "Uploaded source" : "Approved"}
                  </Badge>
                </div>
                <label className="mt-1 flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={r.useForGeneration}
                    disabled={act.busy}
                    onChange={(e) => act.run(async () => onChanged(await api<CharacterDetail>(path(r.id), { method: "PATCH", body: { useForGeneration: e.target.checked } })))}
                  />
                  Use for generation
                </label>
                <div className="mt-1 flex gap-1">
                  {r.role === "approved" && (
                    <Button size="sm" variant="ghost" onClick={() => act.run(async () => onChanged(await api<CharacterDetail>(path(r.id), { method: "PATCH", body: { makeMaster: true } })))}>
                      <Crown className="h-3 w-3" /> Make master
                    </Button>
                  )}
                  {r.role !== "source" && (
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(r.id)}>
                      <Trash2 className="h-3 w-3" /> Remove
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <ErrorNote error={act.error} />
      </div>
      <ConfirmDialog
        open={!!removing}
        title="Remove from references?"
        confirmLabel="Remove"
        danger
        busy={act.busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          act.run(async () => {
            onChanged(await api<CharacterDetail>(path(removing!), { method: "DELETE" }));
            setRemoving(null);
          })
        }
      >
        The image stays in the candidate history. If it is the master, the character returns to &quot;Ready to generate&quot; until you
        approve a new master.
      </ConfirmDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// History + danger zone
// ---------------------------------------------------------------------------

function HistoryPanel({ detail, onChanged }: { detail: CharacterDetail; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (detail.jobs.length === 0) return null;
  return (
    <Card title="Generation history" actions={<Link href={`/history?characterId=${detail.character.id}`} className="text-xs underline">Full history</Link>}>
      <ul className="divide-y divide-line">
        {detail.jobs.map((j) => (
          <li key={j.id} className="py-3 text-sm">
            <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === j.id ? null : j.id)}>
              <JobStatusBadge status={j.status} />
              <span className="font-medium">{j.purpose.replace(/_/g, " ")}</span>
              <span className="text-muted">
                {j.model} · {new Date(j.createdAt).toLocaleString()} · {j.outputs.length} output(s)
              </span>
              <ChevronDown className={cx("ml-auto h-4 w-4 text-muted transition", open === j.id && "rotate-180")} />
            </button>
            {open === j.id && (
              <div className="mt-3 space-y-3">
                <pre className="whitespace-pre-wrap rounded-lg bg-paper p-3 font-mono text-xs text-ink/80">{j.prompt}</pre>
                <p className="text-xs text-muted">
                  Provider: {j.provider} · references sent: {j.referenceAssetIds.length} · options: {JSON.stringify(j.params)}
                </p>
                {j.outputs.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {j.outputs.map((o) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={o.id} src={o.url} alt="" className="h-24 w-18 rounded-md object-cover" />
                    ))}
                  </div>
                )}
                {(j.status === "failed" || isActiveJob(j)) && <JobProgress job={j} onChanged={onChanged} />}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DangerZone({ detail, onChanged }: { detail: CharacterDetail; onChanged: (d: CharacterDetail) => void }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"delete" | null>(null);
  const act = useAction();
  const archived = detail.character.status === "archived";
  return (
    <Card title="Manage character">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          busy={act.busy}
          onClick={() =>
            act.run(async () =>
              onChanged(await api<CharacterDetail>(`/api/characters/${detail.character.id}`, { method: "PATCH", body: { archived: !archived } })),
            )
          }
        >
          <Archive className="h-4 w-4" /> {archived ? "Restore" : "Archive"}
        </Button>
        <Button variant="danger" onClick={() => setConfirm("delete")}>
          <Trash2 className="h-4 w-4" /> Delete permanently
        </Button>
      </div>
      <div className="mt-3">
        <ErrorNote error={act.error} />
      </div>
      <ConfirmDialog
        open={confirm === "delete"}
        title={`Delete ${detail.character.name}?`}
        confirmLabel="Delete forever"
        danger
        busy={act.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          act.run(async () => {
            await api(`/api/characters/${detail.character.id}`, { method: "DELETE" });
            router.push("/characters");
          })
        }
      >
        This permanently deletes the profile, the uploaded reference and every generated image for this character. This cannot be undone.
        Characters used by content projects can&apos;t be deleted — archive them instead.
      </ConfirmDialog>
      {act.error && confirm && <Notice tone="warning">{act.error.message}</Notice>}
    </Card>
  );
}
