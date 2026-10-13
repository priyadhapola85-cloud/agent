import { ApiError, ValidationError } from "@fal-ai/client";
import { AppError } from "../../errors";
import { redact } from "../../logger";

/**
 * Converts anything fal.ai throws into a friendly AppError.
 * The raw provider message goes into `detail` (server log only).
 */
export function mapFalError(err: unknown, during: string): AppError {
  if (err instanceof AppError) return err;
  const detail = redact(
    err instanceof ApiError
      ? { status: err.status, message: err.message, body: err.body, requestId: err.requestId }
      : err,
  );

  if (err instanceof ValidationError) {
    const fields = err.fieldErrors.map((f) => f.msg).join("; ");
    const looksLikeSafety = /content|policy|safety|nsfw|flagged/i.test(fields + err.message);
    return new AppError(
      looksLikeSafety ? "CONTENT_REFUSED" : "PROVIDER_REJECTED",
      looksLikeSafety
        ? "fal.ai's safety filter declined this request."
        : "fal.ai rejected the request settings.",
      {
        action: looksLikeSafety
          ? "Rephrase the prompt (keep it clearly fashion-focused and non-explicit) or use a different reference image."
          : "Check the prompt and options, then try again. If it keeps failing, the model may have changed its inputs.",
        detail: `${during}: ${detail}`,
      },
    );
  }

  if (err instanceof ApiError) {
    const s = err.status;
    // fal.ai returns 403 "User is locked. Reason: Exhausted balance" when credit runs out.
    const bodyText = JSON.stringify(err.body ?? "") + err.message;
    if (s === 402 || ((s === 401 || s === 403) && /balance|billing|credit|locked|payment/i.test(bodyText)))
      return new AppError("PROVIDER_REJECTED", "Your fal.ai account is out of credit (balance exhausted).", {
        action: "Top up at fal.ai → Dashboard → Billing. Your API key is fine — no need to change it. Then press Retry.",
        detail: `${during}: ${detail}`,
        retryable: false,
      });
    if (s === 401 || s === 403)
      return new AppError("PROVIDER_AUTH", "fal.ai did not accept the API key.", {
        action: "Check FAL_KEY in .env.local (Settings shows whether it is set), make sure your fal.ai account has credit, then restart the app.",
        detail: `${during}: ${detail}`,
      });
    if (s === 429)
      return new AppError("PROVIDER_RATE_LIMIT", "fal.ai is rate-limiting requests right now.", {
        action: "Wait a minute and try again.",
        detail: `${during}: ${detail}`,
      });
    if (s === 408 || s === 504)
      return new AppError("PROVIDER_TIMEOUT", "fal.ai took too long to respond.", {
        action: "Try again in a moment.",
        detail: `${during}: ${detail}`,
      });
    if (s === 422 || s === 400)
      return new AppError("PROVIDER_REJECTED", "fal.ai could not process this request.", {
        action: "The prompt or image may have been declined by the provider. Adjust it and try again.",
        detail: `${during}: ${detail}`,
      });
    if (s >= 500)
      return new AppError("PROVIDER_UNAVAILABLE", "fal.ai is having problems right now.", {
        action: "Try again in a few minutes. Check status.fal.ai if it continues.",
        detail: `${during}: ${detail}`,
      });
  }

  // Network failures (no internet, DNS, connection reset)
  if (err instanceof TypeError || (err instanceof Error && /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|network/i.test(err.message)))
    return new AppError("PROVIDER_UNAVAILABLE", "Could not reach fal.ai.", {
      action: "Check your internet connection and try again.",
      detail: `${during}: ${detail}`,
    });

  return new AppError("PROVIDER_INVALID_RESPONSE", "Something unexpected happened while talking to fal.ai.", {
    action: "Try again. If it keeps happening, check the server log for details.",
    detail: `${during}: ${detail}`,
  });
}
