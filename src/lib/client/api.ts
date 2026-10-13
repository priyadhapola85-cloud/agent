"use client";

/**
 * Browser-side helper for calling our own API.
 * Errors from the server arrive as { error: { code, message, action, fields } }
 * and are turned into an ApiClientError the UI can display.
 */

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly action?: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method: init.method ?? (body ? "POST" : "GET"), headers, body, cache: "no-store" });
  } catch {
    throw new ApiClientError("Could not reach the app server.", "NETWORK", 0, "Check that `npm run dev` is still running.");
  }
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
    // Full reload on purpose: session expired, so drop all client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; action?: string; fields?: Record<string, string> } } | null)?.error;
    throw new ApiClientError(e?.message ?? `Request failed (${res.status}).`, e?.code ?? "HTTP", res.status, e?.action, e?.fields);
  }
  return data as T;
}

/** A fresh key per user action; reused if the same action is re-sent (prevents duplicate jobs). */
export function newRequestKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "");
  return `${Date.now()}${Math.random().toString(36).slice(2)}`;
}
