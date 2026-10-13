/**
 * AppError is the one error type the API sends back to the browser.
 *
 * - `message` is safe, friendly text for the user.
 * - `action` is an optional practical next step ("Add FAL_KEY to .env.local").
 * - `detail` is internal information (raw provider errors, file paths).
 *   It is written to the server log but NEVER sent to the browser.
 */
export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "NOT_CONFIGURED"
  | "PROVIDER_AUTH"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_INVALID_RESPONSE"
  | "CONTENT_REFUSED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  NOT_CONFIGURED: 503,
  PROVIDER_AUTH: 502,
  PROVIDER_RATE_LIMIT: 429,
  PROVIDER_REJECTED: 422,
  PROVIDER_UNAVAILABLE: 502,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_INVALID_RESPONSE: 502,
  CONTENT_REFUSED: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly action?: string;
  readonly detail?: string;
  readonly fields?: Record<string, string>;
  /** Whether trying the same thing again later might succeed. */
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { action?: string; detail?: string; fields?: Record<string, string>; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.action = opts.action;
    this.detail = opts.detail;
    this.fields = opts.fields;
    this.retryable =
      opts.retryable ??
      ["PROVIDER_RATE_LIMIT", "PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT"].includes(code);
  }

  /** The shape sent to the browser — no internal detail. */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.action ? { action: this.action } : {}),
      ...(this.fields ? { fields: this.fields } : {}),
    };
  }
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} was not found.`);

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
