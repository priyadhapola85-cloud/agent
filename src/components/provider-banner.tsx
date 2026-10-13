"use client";

import Link from "next/link";
import { useApiData } from "@/lib/client/hooks";
import type { getProviderStatus } from "@/lib/services/overview";
import { Notice } from "./ui";

type Status = ReturnType<typeof getProviderStatus>;

/** Shows a clear "not configured" notice instead of letting buttons silently fail. */
export function ProviderBanner({ need }: { need: ("generation" | "anthropic")[] }) {
  const { data } = useApiData<Status>("/api/status");
  if (!data) return null;
  const missing = need.filter((n) => !data[n].configured);
  if (missing.length === 0) return null;
  return (
    <div className="mb-6">
      <Notice tone={missing.includes("generation") ? "warning" : "info"}>
        {missing.includes("generation") && (
          <p>
            <strong>Image &amp; video generation can&apos;t run with the current settings</strong> — {data.generation.problem}
          </p>
        )}
        {missing.includes("anthropic") && (
          <p>
            <strong>Optional: Claude is not connected</strong> — {data.anthropic.problem ? `${data.anthropic.problem} ` : ""}
            &ldquo;Analyze reference&rdquo; is unavailable (write the description yourself) and storyboards use the basic template
            planner. Image and video generation work without it.
          </p>
        )}
        <p className="mt-1">
          See{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>{" "}
          for details.
        </p>
      </Notice>
    </div>
  );
}

export function useProviderStatus() {
  return useApiData<Status>("/api/status").data;
}
