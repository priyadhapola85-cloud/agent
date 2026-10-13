"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError, newRequestKey } from "./api";

/**
 * Loads data from an API path.
 * `pollMs` re-fetches automatically while `shouldPoll(data)` is true —
 * that's how job progress updates on screen without reloading the page.
 */
export function useApiData<T>(path: string | null, opts: { pollMs?: number; shouldPoll?: (data: T) => boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const shouldPollRef = useRef(opts.shouldPoll);
  useEffect(() => {
    shouldPollRef.current = opts.shouldPoll;
  });

  useEffect(() => {
    if (!path) return;
    let cancelled = false; // ignore answers for an old path (e.g. a previous search)
    api<T>(path)
      .then(
        (d) => {
          if (cancelled) return;
          setData(d);
          setError(null);
        },
        (e: ApiClientError) => {
          if (!cancelled) setError(e);
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!opts.pollMs || !data || !shouldPollRef.current?.(data)) return;
    const t = setTimeout(reload, opts.pollMs);
    return () => clearTimeout(t);
  }, [data, opts.pollMs, reload]);

  return { data, setData, error, loading, reload };
}

/**
 * Wraps a button action: tracks "busy", stores the error, and keeps a stable
 * idempotency key until the action succeeds (double clicks can't create two jobs).
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const keyRef = useRef<string | null>(null);

  const run = useCallback(
    async <R,>(fn: (idempotencyKey: string) => Promise<R>): Promise<R | undefined> => {
      if (busy) return;
      setBusy(true);
      setError(null);
      keyRef.current ??= newRequestKey();
      try {
        const result = await fn(keyRef.current);
        keyRef.current = null; // next click = a new, separate request
        return result;
      } catch (e) {
        // A 4xx means nothing was created → safe to use a fresh key next time.
        // On network/5xx errors we keep the key, so re-clicking can't create a duplicate.
        if (e instanceof ApiClientError && e.status >= 400 && e.status < 500) keyRef.current = null;
        setError(e as ApiClientError);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  return { busy, error, setError, run };
}
