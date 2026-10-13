"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { JobHistory } from "@/components/job-history";
import { PageHeader, Spinner } from "@/components/ui";
import { useApiData } from "@/lib/client/hooks";
import type { CharacterListItem } from "@/lib/services/characters";

function HistoryFilters() {
  const params = useSearchParams();
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [characterId, setCharacterId] = useState(params.get("characterId") ?? "");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const { data } = useApiData<{ characters: CharacterListItem[] }>("/api/characters?archived=1");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const query = new URLSearchParams(Object.entries({ kind, status, characterId, search: debounced }).filter(([, v]) => v)).toString();

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {["queued", "generating", "completed", "failed"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={characterId} onChange={(e) => setCharacterId(e.target.value)} aria-label="Character">
          <option value="">All characters</option>
          {data?.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="input" placeholder="Search prompts" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <JobHistory query={query} emptyText="No generations match these filters." />
    </>
  );
}

export default function HistoryPage() {
  return (
    <div>
      <PageHeader
        title="Generation history"
        subtitle="Every request with its character, prompt, reference images, provider, model, timestamp, outputs and status history."
      />
      <Suspense fallback={<Spinner />}>
        <HistoryFilters />
      </Suspense>
    </div>
  );
}
