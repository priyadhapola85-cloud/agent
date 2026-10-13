"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Search, UserRound } from "lucide-react";
import { Badge, ButtonLink, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { useApiData } from "@/lib/client/hooks";
import { CHARACTER_STATUS, timeAgo } from "@/lib/client/labels";
import type { CharacterListItem } from "@/lib/services/characters";

export default function CharacterLibraryPage() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const qs = new URLSearchParams({ ...(debounced ? { search: debounced } : {}), ...(archived ? { archived: "1" } : {}) });
  const { data, error, loading } = useApiData<{ characters: CharacterListItem[] }>(`/api/characters?${qs}`);

  return (
    <div>
      <PageHeader
        title="Character library"
        subtitle="Your saved AI fashion models. Open one to manage references or reuse it for new content."
        actions={
          <ButtonLink href="/characters/new">
            <Plus className="h-4 w-4" /> New character
          </ButtonLink>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input className="input pl-9" placeholder="Search by name, description or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived
        </label>
      </div>
      <ErrorNote error={error} />
      {loading && !data ? (
        <Spinner />
      ) : data && data.characters.length === 0 ? (
        <EmptyState
          icon={<UserRound className="h-8 w-8" />}
          title={debounced ? "No characters match your search" : "No characters yet"}
          action={!debounced && <ButtonLink href="/characters/new">Create your first character</ButtonLink>}
        >
          {!debounced && "Create a profile, upload a reference image, and approve a master look."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {data?.characters.map((c) => {
            const s = CHARACTER_STATUS[c.status];
            return (
              <Link key={c.id} href={`/characters/${c.id}`} className="card group overflow-hidden transition hover:border-ink/30">
                <div className="aspect-[3/4] bg-accent-soft">
                  {c.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbnailUrl} alt={c.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-accent/50">
                      <UserRound className="h-12 w-12" />
                    </div>
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{c.name}</p>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted">
                    {c.niche ? `${c.niche} · ` : ""}updated {timeAgo(c.updatedAt)}
                  </p>
                  <p className="font-mono text-[10px] text-muted/80">{c.id}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
