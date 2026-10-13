"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/client/api";
import { Button, ErrorNote, Notice } from "@/components/ui";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [config, setConfig] = useState<{ configured: boolean; problem: string | null } | null>(null);

  useEffect(() => {
    api<{ configured: boolean; problem: string | null }>("/api/auth/login").then(setConfig).catch(setError);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { password } });
      const next = params.get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError(err as ApiClientError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-4xl">Atelier</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.25em] text-muted">Fashion AI Studio</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          {config && !config.configured && (
            <Notice tone="warning">
              <p className="font-medium">Login isn&apos;t set up yet.</p>
              <p className="mt-1">{config.problem}</p>
              <p className="mt-1">
                Copy <code>.env.example</code> to <code>.env.local</code>, set <code>APP_PASSWORD</code> and{" "}
                <code>SESSION_SECRET</code>, then restart <code>npm run dev</code>.
              </p>
            </Notice>
          )}
          <label className="block">
            <span className="label">Studio password</span>
            <input
              type="password"
              className="input"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <ErrorNote error={error} />
          <Button type="submit" busy={busy} className="w-full" disabled={!password || config?.configured === false}>
            Log in
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
