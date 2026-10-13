import "server-only";
import path from "node:path";

/**
 * Central place for reading environment variables.
 *
 * Everything here runs ONLY on the server ("server-only" makes the build fail
 * if a browser component ever imports this file), so API keys never reach
 * the browser.
 */

export const DEFAULT_MODELS = {
  // Free by default (Hugging Face). Set IMAGE_MODEL / VIDEO_MODEL to a paid fal.ai model to upgrade.
  image: "hf:black-forest-labs/FLUX.1-Kontext-Dev",
  video: "hf:zerogpu-aoti/wan2-2-fp8da-aoti-faster",
  anthropic: "claude-opus-5-5",
} as const;

function read(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Spots common copy-paste mistakes in an API key, e.g. copying the masked
 * preview ("abcd••••••") from a dashboard instead of the real secret.
 */
export function apiKeyProblem(name: string): string | null {
  const v = read(name);
  if (!v) return null;
  if (/[^\x21-\x7e]/.test(v))
    return `${name} contains hidden or special characters (like • or spaces). It looks like the masked preview was copied instead of the real key. Create a new key, copy the full value shown once, and paste it into .env.local.`;
  if (/^["'].*["']$/.test(v)) return `${name} is wrapped in quotes. Remove the quotes in .env.local.`;
  return null;
}

/** A key is only usable when it is present AND looks valid. */
function key(name: string) {
  return apiKeyProblem(name) ? undefined : read(name);
}

export const env = {
  appPassword: () => read("APP_PASSWORD"),
  sessionSecret: () => read("SESSION_SECRET"),
  falKey: () => key("FAL_KEY"),
  anthropicKey: () => key("ANTHROPIC_API_KEY"),
  databaseUrl: () => read("DATABASE_URL"),
  pgliteDir: () => path.resolve(/*turbopackIgnore: true*/ read("PGLITE_DIR") ?? "./data/pglite"),
  storageDir: () => path.resolve(/*turbopackIgnore: true*/ read("STORAGE_DIR") ?? "./storage"),
  hfToken: () => key("HF_TOKEN"),
  imageModel: () => read("IMAGE_MODEL") ?? read("FAL_IMAGE_MODEL") ?? DEFAULT_MODELS.image,
  videoModel: () => read("VIDEO_MODEL") ?? read("FAL_VIDEO_MODEL") ?? DEFAULT_MODELS.video,
  anthropicModel: () => read("ANTHROPIC_MODEL") ?? DEFAULT_MODELS.anthropic,
  isProduction: () => process.env.NODE_ENV === "production",
};

/** Problems with the login configuration, or null when it is usable. */
export function authConfigProblem(): string | null {
  const password = env.appPassword();
  const secret = env.sessionSecret();
  if (!password) return "APP_PASSWORD is not set in .env.local.";
  if (password === "change-me-to-a-long-password")
    return "APP_PASSWORD still has the example value. Choose your own password in .env.local.";
  if (password.length < 8) return "APP_PASSWORD must be at least 8 characters.";
  if (!secret || secret.length < 32)
    return "SESSION_SECRET must be set in .env.local and be at least 32 characters.";
  if (secret === "replace-with-64-random-hex-characters")
    return "SESSION_SECRET still has the example value. Generate a random one (see .env.example).";
  return null;
}
