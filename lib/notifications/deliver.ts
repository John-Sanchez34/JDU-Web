import { EmailSendError, sendEmail } from "@/lib/email";
import {
  claimForSend,
  listQueuedForSource,
  markFailed,
  markSent,
  releaseToQueued,
} from "@/db/queries/email-deliveries";
import type { Database } from "@/db/queries/executor";
import type { EmailCategory, EmailSourceType } from "@/db/schema";
import { unsubscribePostUrl } from "@/lib/unsubscribe-token";

/** What happened to one delivery. */
export type DeliveryOutcome = "sent" | "failed" | "skipped" | "rate-limited";

/**
 * How many rows one press sends.
 *
 * Fifty paced sends is about twenty-eight seconds, which sits comfortably
 * inside `after()`. A longer batch buys fewer presses at the cost of a much
 * larger window in which a dying process strands work.
 */
export const BROADCAST_BATCH_SIZE = 50;

/**
 * The floor between two sends.
 *
 * Resend's default allowance is about two requests a second. Fifty unpaced
 * sends would collect 429s and mark perfectly good addresses `failed`, which
 * then have to be retried by hand one at a time — the expensive failure.
 */
export const SEND_INTERVAL_MS = 550;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * RFC 8058 one-click headers, for broadcast mail only.
 *
 * These are what make Gmail and Apple Mail show their own unsubscribe button
 * next to the sender — the highest-leverage deliverability item available to a
 * studio sending from a young domain, and far likelier to be used than a link
 * buried in a footer.
 *
 * Attached here rather than at render time because the header is a property of
 * the *send*, not of the message body, and because this is the one place that
 * sees both the category and the recipient. A row with no `recipientUserId`
 * (the account was deleted) gets no header rather than a broken link.
 */
export function unsubscribeHeaders(delivery: {
  category: EmailCategory;
  recipientUserId: string | null;
}): { headers?: Record<string, string> } {
  if (delivery.category !== "broadcast" || !delivery.recipientUserId) return {};

  return {
    headers: {
      "List-Unsubscribe": `<${unsubscribePostUrl(delivery.recipientUserId)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/**
 * Sends a batch of queued deliveries, one row at a time.
 *
 * Runs after the response — from `after()` in a server action, or from the
 * Retry action — so nothing here may throw into a caller that has already
 * returned. A failure is recorded on its own row and the next row still goes
 * out; one bad address must not silence the rest of a family's mail.
 *
 * Returns a per-id outcome so a caller that IS waiting — `retryDeliveryAction`
 * — can tell a real failure from "already handled." The `after()` callers
 * ignore the return value; that's fine, nobody is watching there.
 */
export async function deliverQueued(
  db: Database,
  deliveryIds: string[],
  opts: { minIntervalMs?: number } = {},
): Promise<Record<string, DeliveryOutcome>> {
  const minIntervalMs = opts.minIntervalMs ?? SEND_INTERVAL_MS;
  const outcomes: Record<string, DeliveryOutcome> = {};
  let sentSomething = false;

  for (const deliveryId of deliveryIds) {
    try {
      // Pace before the send, not after, so a batch of one costs nothing.
      if (sentSomething && minIntervalMs > 0) await sleep(minIntervalMs);

      // Claiming is what makes a double Retry safe: a row already sent, or
      // already in flight elsewhere, comes back null and is skipped.
      const delivery = await claimForSend(db, deliveryId);
      if (!delivery) {
        outcomes[deliveryId] = "skipped";
        continue;
      }

      try {
        const result = await sendEmail({
          to: delivery.recipientEmail,
          subject: delivery.subject,
          text: delivery.bodyText,
          html: delivery.bodyHtml,
          ...unsubscribeHeaders(delivery),
        });
        sentSomething = true;
        await markSent(db, delivery.id, result.providerMessageId);
        outcomes[deliveryId] = "sent";
      } catch (error) {
        /*
         * A rate limit is not this row's fault. Hand the claim back and stop
         * the batch: marking it failed would put a healthy address on the
         * retry page, and pressing on would do the same to every row after it.
         */
        if (error instanceof EmailSendError && error.isRateLimited) {
          await releaseToQueued(db, delivery.id);
          outcomes[deliveryId] = "rate-limited";
          break;
        }

        const message = error instanceof Error ? error.message : String(error);
        // Provider rejected; record the failure and move to the next delivery.
        // lib/email.ts already logs the provider error, so we don't duplicate.
        await markFailed(db, delivery.id, message);
        outcomes[deliveryId] = "failed";
      }
    } catch (error) {
      // Bookkeeping failed, not the send. Leave the row where it is rather
      // than claiming to know the outcome, and keep going with the rest of
      // the batch.
      console.error("deliverQueued: could not record a delivery outcome", { deliveryId, error });
      outcomes[deliveryId] = "skipped";
    }
  }

  return outcomes;
}

export type BatchOutcome = {
  sent: number;
  failed: number;
  skipped: number;
  /** True when the provider asked us to slow down and the batch stopped early. */
  rateLimited: boolean;
  /** Rows still queued for this source afterwards — what "Send the rest" would take. */
  remaining: number;
};

/**
 * Sends one bounded batch for a single source, then reports what is left.
 *
 * This is the whole fan-out mechanism: `after()` runs the first batch, and the
 * announcement page's resume button runs the next. Nothing sweeps on a timer,
 * so `remaining` is the number a person needs to see.
 */
export async function deliverBatchForSource(
  db: Database,
  input: {
    sourceType: EmailSourceType;
    sourceId: string;
    limit?: number;
    minIntervalMs?: number;
  },
): Promise<BatchOutcome> {
  const limit = input.limit ?? BROADCAST_BATCH_SIZE;
  const ids = await listQueuedForSource(db, input.sourceType, input.sourceId, limit);
  const outcomes = await deliverQueued(db, ids, { minIntervalMs: input.minIntervalMs });
  const values = Object.values(outcomes);

  const remaining = await listQueuedForSource(
    db,
    input.sourceType,
    input.sourceId,
    // One more than a batch, so a full batch still reports honestly that there
    // is more rather than reporting exactly the limit.
    limit + 1,
  );

  return {
    sent: values.filter((v) => v === "sent").length,
    failed: values.filter((v) => v === "failed").length,
    skipped: values.filter((v) => v === "skipped").length,
    rateLimited: values.includes("rate-limited"),
    remaining: remaining.length,
  };
}
