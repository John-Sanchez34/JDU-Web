import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/*
 * An opt-out token is an HMAC of the user id, not a stored secret. There is no
 * table to write, nothing to expire, and nothing to clean up when an account is
 * deleted — and because the secret is the one already signing sessions, a
 * rotated secret invalidates outstanding links, which for an unsubscribe link
 * is a fair trade for having no state at all.
 *
 * Server-only: `lib/env.ts` must never reach the browser bundle.
 */
function digest(userId: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(userId).digest("base64url");
}

export function signUnsubscribeToken(userId: string): string {
  const encodedId = Buffer.from(userId, "utf8").toString("base64url");
  return `${encodedId}.${digest(userId)}`;
}

/**
 * Returns the user id a token vouches for, or null.
 *
 * Every rejection returns null rather than throwing: this runs on an endpoint
 * anyone can POST to, and a thrown error there is a 500 that tells a prober
 * their input was interesting.
 */
export function verifyUnsubscribeToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedId, signature] = parts;
  if (!encodedId || !signature) return null;

  const userId = Buffer.from(encodedId, "base64url").toString("utf8");
  if (!userId) return null;

  const expected = Buffer.from(digest(userId), "utf8");
  const actual = Buffer.from(signature, "utf8");
  // timingSafeEqual throws on a length mismatch, so the length is checked
  // first — and a wrong length is already a wrong signature.
  if (expected.length !== actual.length) return null;

  return timingSafeEqual(expected, actual) ? userId : null;
}

/** Where the footer link in a broadcast email points: a page, never an action. */
export function unsubscribeUrl(userId: string): string {
  return `${env.BETTER_AUTH_URL}/unsubscribe?u=${signUnsubscribeToken(userId)}`;
}

/** Where `List-Unsubscribe-Post` points: the endpoint that actually opts out. */
export function unsubscribePostUrl(userId: string): string {
  return `${env.BETTER_AUTH_URL}/api/unsubscribe?u=${signUnsubscribeToken(userId)}`;
}
