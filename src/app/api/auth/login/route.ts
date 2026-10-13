import { NextResponse, type NextRequest } from "next/server";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createSessionToken, passwordMatches, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { authConfigProblem, env } from "@/lib/config/env";
import { AppError } from "@/lib/errors";
import { loginSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

// Simple brute-force protection: max 10 failed attempts per 10 minutes per client.
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export const POST = apiRoute(
  async (req) => {
    const problem = authConfigProblem();
    if (problem) throw new AppError("NOT_CONFIGURED", "Login is not configured yet.", { action: `${problem} Then restart the app.` });

    const key = clientKey(req);
    const now = Date.now();
    const entry = attempts.get(key);
    if (entry && entry.resetAt > now && entry.count >= 10)
      throw new AppError("RATE_LIMITED", "Too many failed login attempts.", { action: "Wait 10 minutes and try again." });

    const { password } = await readJson(req, loginSchema);
    if (!(await passwordMatches(password, env.appPassword()!))) {
      const e = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + 10 * 60_000 };
      e.count++;
      attempts.set(key, e);
      throw new AppError("UNAUTHORIZED", "Incorrect password.");
    }
    attempts.delete(key);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, await createSessionToken(env.sessionSecret()!), {
      httpOnly: true,
      sameSite: "lax",
      secure: env.isProduction(),
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  },
  { public: true },
);

/** Tells the login page whether login is configured (no secrets). */
export const GET = apiRoute(async () => ({ configured: authConfigProblem() === null, problem: authConfigProblem() }), {
  public: true,
});
