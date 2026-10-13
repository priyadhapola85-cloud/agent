import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "../../errors";
import { redact } from "../../logger";

/** Shared helpers for the Claude-based analyzer and planner. */

let cached: { key: string; client: Anthropic } | null = null;

export function anthropicClient(getKey: () => string | undefined): Anthropic {
  const key = getKey();
  if (!key)
    throw new AppError("NOT_CONFIGURED", "Claude (Anthropic) is not configured.", {
      action: "Add ANTHROPIC_API_KEY to .env.local and restart the app. See Settings for instructions.",
    });
  if (!cached || cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key, timeout: 180_000 }) };
  return cached.client;
}

/**
 * Server-side refusal fallback: if Claude's safety classifier declines, the API
 * retries on Anthropic's recommended fallback model inside the same call.
 */
export const FALLBACK_OPTIONS: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

export function mapAnthropicError(err: unknown, during: string): AppError {
  if (err instanceof AppError) return err;
  const detail = `${during}: ${redact(err)}`;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new AppError("PROVIDER_AUTH", "Anthropic did not accept the API key.", {
      action: "Check ANTHROPIC_API_KEY in .env.local and restart the app.",
      detail,
    });
  if (err instanceof Anthropic.RateLimitError)
    return new AppError("PROVIDER_RATE_LIMIT", "Claude is rate-limiting requests right now.", {
      action: "Wait a minute and try again.",
      detail,
    });
  if (err instanceof Anthropic.BadRequestError)
    return new AppError("PROVIDER_REJECTED", "Claude could not process this request.", {
      action: "If you uploaded an image, make sure it is a normal JPG/PNG/WebP under 5 MB.",
      detail,
    });
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return new AppError("PROVIDER_TIMEOUT", "Claude took too long to respond.", { action: "Try again.", detail });
  if (err instanceof Anthropic.APIConnectionError)
    return new AppError("PROVIDER_UNAVAILABLE", "Could not reach Anthropic.", {
      action: "Check your internet connection and try again.",
      detail,
    });
  if (err instanceof Anthropic.APIError)
    return new AppError("PROVIDER_UNAVAILABLE", "Anthropic's API returned an error.", {
      action: "Try again in a few minutes.",
      detail,
    });
  return new AppError("INTERNAL", "Unexpected error while talking to Claude.", { detail });
}
