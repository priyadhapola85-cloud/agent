"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { Card, ErrorNote, Notice, PageHeader, Spinner } from "@/components/ui";
import { useApiData } from "@/lib/client/hooks";
import type { getProviderStatus } from "@/lib/services/overview";

type Status = ReturnType<typeof getProviderStatus>;

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      {ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" /> : <XCircle className="mt-0.5 h-5 w-5 text-danger" />}
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted">{detail}</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { data, error, loading } = useApiData<Status>("/api/status");
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return null;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Settings & provider configuration"
        subtitle="API keys are read only on the server from .env.local. This page shows whether they are set — never their values."
      />

      <Card title="Status">
        <div className="divide-y divide-line">
          <Row ok={data.login.configured} label="Studio login" detail={data.login.problem ?? "APP_PASSWORD and SESSION_SECRET are set."} />
          <Row
            ok={data.generation.configured}
            label="Image & video generation"
            detail={
              data.generation.problem ??
              `Ready. Default image model: ${data.generation.imageModelLabel} · Default video model: ${data.generation.videoModelLabel}. You can pick another model on each Generate button.`
            }
          />
          <Row
            ok={!data.huggingface.problem}
            label="Hugging Face — FREE models (no payment)"
            detail={
              data.huggingface.problem ??
              (data.huggingface.tokenSet
                ? "HF_TOKEN is set — you get your account's full free daily GPU allowance."
                : "Works without any account (small shared daily allowance). Optional: add a free HF_TOKEN for more free minutes per day.")
            }
          />
          <Row
            ok={data.fal.configured}
            label="fal.ai — PAID models (optional)"
            detail={
              data.fal.configured
                ? "FAL_KEY is set. Paid models are available in the model pickers (your fal.ai account needs credit)."
                : (data.fal.problem ?? "Not set — that's fine. Paid models stay disabled; free models work.")
            }
          />
          <Row
            ok={data.anthropic.configured}
            label="Anthropic Claude — reference analysis & storyboard planning"
            detail={
              data.anthropic.configured
                ? `ANTHROPIC_API_KEY is set. Model: ${data.anthropic.model}`
                : data.anthropic.problem ?? "Optional. Without it: write descriptions yourself; storyboards use the basic template planner (labelled “no AI”)."
            }
          />
          <Row ok label="Database" detail={data.database} />
          <Row ok label="Media storage" detail={data.storage} />
        </div>
      </Card>

      <Card title="How to add or change API keys">
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          <li>
            In the project folder, copy <code>.env.example</code> to a new file named <code>.env.local</code> (if you haven&apos;t already).
          </li>
          <li>
            <strong>Hugging Face (free, optional — more daily free minutes):</strong> create a free account at <code>huggingface.co</code> →
            Settings → <em>Access Tokens</em> → <em>Create new token</em> (type &ldquo;Read&rdquo;). Paste it after <code>HF_TOKEN=</code> in{" "}
            <code>.env.local</code>. No payment details needed.
          </li>
          <li>
            <strong>fal.ai (paid, optional):</strong> fal.ai → Dashboard → <em>Keys</em> → create a key, and add credit under Billing. Paste it
            after <code>FAL_KEY=</code>.
          </li>
          <li>
            <strong>Anthropic (optional):</strong> sign in at <code>platform.claude.com</code> → Settings → <em>API keys</em> → create a key.
            Paste it after <code>ANTHROPIC_API_KEY=</code>.
          </li>
          <li>Save the file, stop the app (Ctrl + C in the terminal) and start it again with <code>npm run dev</code>.</li>
          <li>Reload this page — the status above should turn green.</li>
        </ol>
        <div className="mt-4">
          <Notice tone="warning">
            Never paste keys into chat, screenshots, issues or code files. <code>.env.local</code> is excluded from Git automatically.
          </Notice>
        </div>
      </Card>

      <Card title="If a key leaks: rotate or revoke it">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Create a new key in the provider dashboard (fal.ai → Keys, or Anthropic Console → API keys).</li>
          <li>Replace the old value in <code>.env.local</code> and restart the app.</li>
          <li>Delete/revoke the old key in the same dashboard so it stops working immediately.</li>
          <li>Check the provider&apos;s usage/billing page for unexpected activity.</li>
          <li>
            To invalidate everyone&apos;s login sessions too, change <code>SESSION_SECRET</code> (and <code>APP_PASSWORD</code> if it may have
            leaked) and restart.
          </li>
        </ol>
      </Card>

      <Card title="Supported models">
        <div className="space-y-4 text-sm">
          <div>
            <p className="label">Image</p>
            <ul className="list-disc pl-5">
              {data.imageModels.map((m) => (
                <li key={m.id}>
                  <strong>{m.label}</strong> — {m.note}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label">Video (image-to-video)</p>
            <ul className="list-disc pl-5">
              {data.videoModels.map((m) => (
                <li key={m.id}>
                  <strong>{m.label}</strong> — <code>{m.id}</code> · {m.durations.length > 3 ? `${m.durations[0]}–${m.durations.at(-1)}` : m.durations.join("/")}s · {m.priceNote}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted">
            Change the defaults with <code>IMAGE_MODEL</code>, <code>VIDEO_MODEL</code> or <code>ANTHROPIC_MODEL</code> in <code>.env.local</code> (use the model IDs: {" "}
            {data.defaults.image}, {data.defaults.video}).
          </p>
        </div>
      </Card>

      <Card title="Not included in this version">
        <p className="text-sm text-muted">
          Instagram publishing, posting schedules, payments/subscriptions and cost dashboards are intentionally not built yet. Approved
          videos are exported as MP4 files for you to post manually.
        </p>
      </Card>
    </div>
  );
}
