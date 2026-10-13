"use client";

import Link from "next/link";
import { JobHistory } from "@/components/job-history";
import { ProviderBanner } from "@/components/provider-banner";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { useApiData } from "@/lib/client/hooks";
import { CHARACTER_STATUS } from "@/lib/client/labels";
import type { CharacterListItem } from "@/lib/services/characters";
import type { ProjectListItem } from "@/lib/services/content";

/**
 * Image Generation Studio — a hub. Image generation always happens in context
 * (a character's Design Studio for references, a project scene for first
 * frames) so every image is tied to a character and saved with its metadata.
 */
export default function ImageStudioPage() {
  const chars = useApiData<{ characters: CharacterListItem[] }>("/api/characters");
  const projects = useApiData<{ projects: ProjectListItem[] }>("/api/projects");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Image generation studio"
        subtitle="Generate character reference candidates or scene first-frames. Every image uses the character's approved reference images."
      />
      <ProviderBanner need={["generation"]} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Character references" actions={<ButtonLink href="/characters/new" variant="secondary">New character</ButtonLink>}>
          {chars.loading && !chars.data ? (
            <Spinner />
          ) : !chars.data?.characters.length ? (
            <EmptyState title="No characters yet">Create a character to generate reference candidates.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {chars.data.characters.map((c) => (
                <li key={c.id}>
                  <Link href={`/characters/${c.id}`} className="flex items-center gap-3 py-2 hover:bg-paper">
                    {c.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumbnailUrl} alt="" className="h-12 w-9 rounded object-cover" />
                    ) : (
                      <div className="h-12 w-9 rounded bg-accent-soft" />
                    )}
                    <span className="flex-1 font-medium">{c.name}</span>
                    <Badge tone={CHARACTER_STATUS[c.status].tone}>{CHARACTER_STATUS[c.status].label}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Scene first-frames" actions={<ButtonLink href="/content/new" variant="secondary">New content</ButtonLink>}>
          {projects.loading && !projects.data ? (
            <Spinner />
          ) : !projects.data?.projects.length ? (
            <EmptyState title="No content projects yet">Create a content brief to generate scene images.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {projects.data.projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/content/${p.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-paper">
                    <span>
                      <span className="font-medium">{p.title}</span>
                      <span className="block text-xs text-muted">{p.characterName} · {p.sceneCount} scenes</span>
                    </span>
                    <span className="text-xs underline">Open scenes</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div>
        <h2 className="mb-3 text-base font-semibold">Recent image generations</h2>
        <JobHistory query="kind=image&limit=30" emptyText="No image generations yet." />
      </div>
    </div>
  );
}
