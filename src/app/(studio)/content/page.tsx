"use client";

import Link from "next/link";
import { Clapperboard, Plus } from "lucide-react";
import { Badge, ButtonLink, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { useApiData } from "@/lib/client/hooks";
import { timeAgo } from "@/lib/client/labels";
import type { ProjectListItem } from "@/lib/services/content";

export default function ContentListPage() {
  const { data, error, loading } = useApiData<{ projects: ProjectListItem[] }>("/api/projects");
  return (
    <div>
      <PageHeader
        title="Fashion content"
        subtitle="Each project is one Reel: a brief, a storyboard, scene images and video clips."
        actions={
          <ButtonLink href="/content/new">
            <Plus className="h-4 w-4" /> New content
          </ButtonLink>
        }
      />
      <ErrorNote error={error} />
      {loading && !data ? (
        <Spinner />
      ) : !data?.projects.length ? (
        <EmptyState icon={<Clapperboard className="h-8 w-8" />} title="No content projects yet" action={<ButtonLink href="/content/new">Create a content brief</ButtonLink>}>
          You need a character with an approved master reference first.
        </EmptyState>
      ) : (
        <div className="card divide-y divide-line">
          {data.projects.map((p) => (
            <Link key={p.id} href={`/content/${p.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-paper">
              <div className="min-w-0">
                <p className="font-medium">{p.title}</p>
                <p className="truncate text-sm text-muted">
                  {p.characterName} · {p.brief.theme} · updated {timeAgo(p.updatedAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{p.sceneCount} scenes</Badge>
                {p.generatingCount > 0 && <Badge tone="accent" pulse>{p.generatingCount} generating</Badge>}
                {p.reviewCount > 0 && <Badge tone="info">{p.reviewCount} to review</Badge>}
                {p.approvedCount > 0 && <Badge tone="success">{p.approvedCount} approved</Badge>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
