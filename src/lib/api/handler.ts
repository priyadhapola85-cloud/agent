import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { authConfigProblem } from "../config/env";
import { getContext, type AppContext } from "../context";
import { AppError, isAppError } from "../errors";
import { log } from "../logger";
import { SESSION_COOKIE, verifySessionToken } from "../auth/session";
import { ensureWorkerStarted } from "../jobs/worker";

/**
 * Every API route is wrapped with `apiRoute(...)`. It:
 *   1. checks the login configuration and the session cookie,
 *   2. blocks cross-site form posts (Origin check),
 *   3. converts errors into friendly JSON — never raw provider errors or file paths.
 */

type Params = Record<string, string | string[]>;
type RouteCtx = { params: Promise<Params> };
type Handler<P extends Params> = (
  req: NextRequest,
  args: { params: P; app: AppContext },
) => Promise<Response | unknown>;

/** "identity.fictionalAge" → "Fictional age" (friendlier than the internal field path). */
function humanize(path: string) {
  const last = path.split(".").filter((p) => Number.isNaN(Number(p))).pop() ?? path;
  const words = last.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function zodToAppError(err: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = Object.entries(fields)[0];
  return new AppError("VALIDATION", first ? `${first[0] === "_" ? "" : `${humanize(first[0])}: `}${first[1]}` : "Invalid input.", {
    fields,
    action: "Fix the highlighted fields and try again.",
  });
}

export function errorResponse(err: unknown): NextResponse {
  const appErr = isAppError(err)
    ? err
    : err instanceof ZodError
      ? zodToAppError(err)
      : new AppError("INTERNAL", "Something went wrong on the server.", {
          action: "Try again. If it keeps happening, check the terminal running the app for details.",
          detail: err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err),
        });
  if (appErr.code === "NOT_CONFIGURED") log.warn(`Not configured: ${appErr.message}`);
  else if (appErr.status >= 500 || appErr.detail) log.error(`API error ${appErr.code}: ${appErr.message}`, appErr.detail);
  return NextResponse.json({ error: appErr.toJSON() }, { status: appErr.status });
}

async function checkAuth(req: NextRequest) {
  const problem = authConfigProblem();
  if (problem)
    throw new AppError("NOT_CONFIGURED", "Login is not configured yet.", {
      action: `${problem} Then restart the app.`,
    });
  const ok = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET?.trim());
  if (!ok) throw new AppError("UNAUTHORIZED", "Please log in first.", { action: "Reload the page and log in." });
}

/** Rejects state-changing requests that come from another website (CSRF protection). */
export function checkSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // same-origin fetches from older browsers / tools may omit it
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (!host || originHost !== host)
    throw new AppError("FORBIDDEN", "This request came from another website and was blocked.");
}

export function apiRoute<P extends Params = Params>(handler: Handler<P>, opts: { public?: boolean } = {}) {
  return async (req: NextRequest, routeCtx: RouteCtx): Promise<Response> => {
    try {
      if (!opts.public) await checkAuth(req);
      checkSameOrigin(req);
      const app = await getContext();
      ensureWorkerStarted();
      const params = ((await routeCtx?.params) ?? {}) as P;
      const result = await handler(req, { params, app });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

const MAX_JSON_BYTES = 256 * 1024;

/** Reads and validates a JSON body. */
export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json"))
    throw new AppError("UNSUPPORTED_MEDIA", "Expected a JSON request body.");
  const raw = await req.text();
  if (raw.length > MAX_JSON_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Request body is too large.");
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new AppError("VALIDATION", "Request body is not valid JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw zodToAppError(parsed.error);
  return parsed.data;
}
