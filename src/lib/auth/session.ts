/**
 * LOGIN SESSIONS
 *
 * This is a single-user studio protected by one password (APP_PASSWORD).
 * After a correct login we set an httpOnly cookie containing
 *   "<expiry-timestamp>.<HMAC signature>"
 * signed with SESSION_SECRET. Nobody can forge it without the secret, and
 * browser JavaScript can't read it.
 *
 * Uses Web Crypto so it works in both the proxy and API route handlers.
 */

export const SESSION_COOKIE = "fas_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Compares two strings in constant time (prevents timing attacks). */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const expires = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${expires}.${await hmac(secret, `session:${expires}`)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string | undefined, now = Date.now()) {
  if (!token || !secret) return false;
  const [expiresRaw, signature] = token.split(".");
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || !signature) return false;
  if (expires * 1000 < now) return false;
  const expected = await hmac(secret, `session:${expires}`);
  return safeEqual(signature, expected);
}

/** Password check that does not leak the length or content through timing. */
export async function passwordMatches(input: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(input)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return safeEqual(toBase64Url(a), toBase64Url(b));
}
