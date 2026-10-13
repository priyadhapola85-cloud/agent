"use client";

import Link from "next/link";
import { CheckCircle2, Circle, Clapperboard, Sparkles, Users } from "lucide-react";
import { JobRow, isActiveJob } from "@/components/jobs";
import { ProviderBanner } from "@/components/provider-banner";
import { ButtonLink, Card, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { useApiData } from "@/lib/client/hooks";
import type { getOverview, getProviderStatus } from "@/lib/services/overview";

type Overview = Awaited<ReturnType<typeof getOverview>> & { status: ReturnType<typeof getProviderStatus> };

export default function DashboardPage() {
  const { data, error, loading } = useApiData<Overview>("/api/overview", {
    pollMs: 5000,
    shouldPoll: (d) => d.recentJobs.some(isActiveJob),
  });

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return null;
  const c = data.counts;

  const steps = [
    { done: data.status.generation.configured, label: "Image & video generation ready (free models by default)", href: "/settings" },
    { done: c.characterCount > 0, label: "Create a character profile", href: "/characters/new" },
    { done: c.activeCharacters > 0, label: "Upload a reference & approve a master image", href: "/characters" },
    { done: c.projectCount > 0, label: "Write a content brief & storyboard", href: "/content/new" },
    { done: c.approved > 0, label: "Generate, review and approve a video", href: "/review" },
  ];

  return (
    <div>
      <PageHeader
        title="Studio overview"
        subtitle="Create fictional AI fashion models, keep them consistent, and turn approved looks into short Reels-ready clips."
        actions={
          <>
            <ButtonLink href="/characters/new" variant="secondary">
              <Sparkles className="h-4 w-4" /> New character
            </ButtonLink>
            <ButtonLink href="/content/new">
              <Clapperboard className="h-4 w-4" /> New content
            </ButtonLink>
          </>
        }
      />
      <ProviderBanner need={["generation", "anthropic"]} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Characters", value: c.characterCount, sub: `${c.activeCharacters} active`, href: "/characters" },
          { label: "Generating now", value: c.generating, sub: "jobs in progress", href: "/history" },
          { label: "Ready for review", value: c.review, sub: "videos waiting", href: "/review" },
          { label: "Approved videos", value: c.approved, sub: "ready to export", href: "/review?status=approved" },
        ].map((s) => (
          <Link key={s.label} href={s.href} className="card p-4 transition hover:border-ink/30">
            <p className="text-xs uppercase tracking-wide text-muted">{s.label}</p>
            <p className="mt-1 font-display text-3xl">{s.value}</p>
            <p className="text-xs text-muted">{s.sub}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Getting started" className="lg:col-span-3">
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={s.label}>
                <Link href={s.href} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-paper">
                  {s.done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5 text-line" />}
                  <span className={s.done ? "text-muted line-through" : ""}>
                    {i + 1}. {s.label}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Recent generations" className="lg:col-span-2" actions={<Link href="/history" className="text-xs underline">View all</Link>}>
          {data.recentJobs.length === 0 ? (
            <EmptyState icon={<Users className="h-6 w-6" />} title="Nothing generated yet">
              Generations appear here once you start one.
            </EmptyState>
          ) : (
            <div className="-mx-2">
              {data.recentJobs.map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
