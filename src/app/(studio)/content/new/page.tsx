"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BriefForm, EMPTY_BRIEF } from "@/components/brief-form";
import { Button, ButtonLink, Card, EmptyState, ErrorNote, Field, Notice, PageHeader, Spinner, Steps } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useAction, useApiData } from "@/lib/client/hooks";
import type { ContentBrief } from "@/lib/db/schema";
import type { CharacterListItem } from "@/lib/services/characters";

function NewContentForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { data, loading } = useApiData<{ characters: CharacterListItem[] }>("/api/characters");
  const active = data?.characters.filter((c) => c.status === "active") ?? [];
  const [chosenId, setCharacterId] = useState(params.get("characterId") ?? "");
  // With only one ready character, pre-select it.
  const characterId = chosenId || (active.length === 1 ? active[0].id : "");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState<ContentBrief>(EMPTY_BRIEF);
  const create = useAction();

  if (loading && !data) return <Spinner />;
  if (data && active.length === 0)
    return (
      <EmptyState title="No character is ready yet" action={<ButtonLink href="/characters">Open the character library</ButtonLink>}>
        Content needs a character with an approved <strong>master reference</strong>. Upload a reference, generate candidates and approve
        one first.
      </EmptyState>
    );

  const selected = active.find((c) => c.id === characterId);
  return (
    <div className="max-w-4xl space-y-6">
      <Steps steps={["Brief", "Storyboard", "Scene images", "Video", "Review & export"]} current={0} />
      <Notice>Saving the brief does not generate anything. You&apos;ll review and edit the storyboard before any paid generation.</Notice>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Character *" error={create.error?.fields?.characterId}>
            <select className="input" value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
              <option value="">Choose a character…</option>
              {active.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Project title *" error={create.error?.fields?.title}>
            <input className="input" maxLength={120} placeholder="e.g. Autumn Luxe Reel #1" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        {selected?.thumbnailUrl && (
          <div className="mt-4 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selected.thumbnailUrl} alt={selected.name} className="h-16 w-12 rounded-md object-cover" />
            <p className="text-sm text-muted">The approved master reference of {selected.name} will be used for every scene.</p>
          </div>
        )}
        <div className="mt-6">
          <BriefForm value={brief} onChange={setBrief} errors={create.error?.fields} />
        </div>
        <div className="mt-6 space-y-3">
          <Button
            busy={create.busy}
            disabled={!characterId || !title.trim() || !brief.theme.trim()}
            onClick={() =>
              create.run(async () => {
                const res = await api<{ project: { id: string } }>("/api/projects", {
                  method: "POST",
                  body: { characterId, title, brief: Object.fromEntries(Object.entries(brief).filter(([, v]) => v !== "")) },
                });
                router.push(`/content/${res.project.id}`);
              })
            }
          >
            Save brief & continue to storyboard
          </Button>
          <ErrorNote error={create.error} />
        </div>
      </Card>
    </div>
  );
}

export default function NewContentPage() {
  return (
    <div>
      <PageHeader title="Create fashion content" subtitle="Describe the Reel you want. The planner turns this into an editable storyboard." />
      <Suspense fallback={<Spinner />}>
        <NewContentForm />
      </Suspense>
    </div>
  );
}
