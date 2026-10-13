/**
 * Tiny logger that scrubs anything that looks like a secret before printing.
 * Use this instead of console.log in server code.
 */

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_\-]+/g, // Anthropic keys
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{20,}\b/gi, // fal "id:secret" keys
  /(Key|Bearer)\s+[A-Za-z0-9._:\-]{12,}/g, // auth headers
  /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{40,}/gi, // huge data URIs
];

function knownSecrets(): string[] {
  return [process.env.FAL_KEY, process.env.ANTHROPIC_API_KEY, process.env.APP_PASSWORD, process.env.SESSION_SECRET]
    .filter((v): v is string => !!v && v.trim().length >= 6)
    .map((v) => v.trim());
}

export function redact(input: unknown): string {
  let text: string;
  if (typeof input === "string") text = input;
  else if (input instanceof Error) text = `${input.name}: ${input.message}`;
  else {
    try {
      text = JSON.stringify(input);
    } catch {
      text = String(input);
    }
  }
  for (const secret of knownSecrets()) text = text.split(secret).join("[REDACTED]");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[REDACTED]");
  return text.length > 2000 ? `${text.slice(0, 2000)}…[truncated]` : text;
}

function write(level: "info" | "warn" | "error", message: string, extra?: unknown) {
  if (process.env.VITEST && level !== "error") return; // keep test output readable
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${redact(message)}${
    extra === undefined ? "" : ` ${redact(extra)}`
  }`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (message: string, extra?: unknown) => write("info", message, extra),
  warn: (message: string, extra?: unknown) => write("warn", message, extra),
  error: (message: string, extra?: unknown) => write("error", message, extra),
};
