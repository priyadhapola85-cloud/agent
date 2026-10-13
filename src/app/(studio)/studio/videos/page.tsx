"use client";

import Link from "next/link";
import { JobHistory } from "@/components/job-history";
import { ProviderBanner } from "@/components/provider-banner";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { useApiData } from "@/lib/client/hooks";
import type { ProjectListItem } from "@/lib/services/content";

/** Video Generation Studio — overview of all video jobs plus a jump into each project's scenes. */
export default function VideoStudioPage() {
  const projects = useApiData<{ projects: ProjectListItem[] }>("/api/projects", {
    pollMs: 5000,
    shouldPoll: (d) => d.projects.some((p) => p.generatingCount > 0),
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Video generation studio"
        subtitle="Image-to-video: each clip is animated from an approved start frame of your character. Jobs run in the background — you can close this page."
      />
      <ProviderBanner need={["generation"]} />
      <Card title="Projects" actions={<ButtonLink href="/content/new" variant="secondary">New content</ButtonLink>}>
        {projects.loading && !projects.data ? (
          <Spinner />
        ) : !projects.data?.projects.length ? (
          <EmptyState title="No content projects yet">Create a brief and storyboard first, then generate videos per scene.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {projects.data.projects.map((p) => (
              <li key={p.id}>
                <Link href={`/content/${p.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-paper">
                  <span>
                    <span className="font-medium">{p.title}</span>
                    <span className="block text-xs text-muted">{p.characterName} · {p.sceneCount} scenes</span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {p.generatingCount > 0 && <Badge tone="accent" pulse>{p.generatingCount} generating</Badge>}
                    {p.reviewCount > 0 && <Badge tone="info">{p.reviewCount} to review</Badge>}
                    {p.approvedCount > 0 && <Badge tone="success">{p.approvedCount} approved</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div>
        <h2 className="mb-3 text-base font-semibold">Video jobs</h2>
        <JobHistory query="kind=video&limit=50" emptyText="No video generations yet." />
      </div>
    </div>
  );
}
