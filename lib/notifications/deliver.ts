import { claimForSend, markFailed, markSent } from "@/db/queries/email-deliveries";
import type { Database } from "@/db/queries/executor";
import { sendEmail } from "@/lib/email";

/** What happened to one delivery: sent, recorded as failed, or not claimed at all. */
export type DeliveryOutcome = "sent" | "failed" | "skipped";

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
): Promise<Record<string, DeliveryOutcome>> {
  const outcomes: Record<string, DeliveryOutcome> = {};

  for (const deliveryId of deliveryIds) {
    try {
      // Claiming is what makes a double Retry safe: a row already sent, or
      // already in flight elsewhere, comes back null and is skipped.
      const delivery = await claimForSend(db, deliveryId);
      if (!delivery) {
        outcomes[deliveryId] = "skipped";
        continue;
      }

      let result;
      try {
        // If the provider rejects this address, we own recording that failure
        // and moving to the next delivery.
        result = await sendEmail({
          to: delivery.recipientEmail,
          subject: delivery.subject,
          text: delivery.bodyText,
          html: delivery.bodyHtml,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Provider rejected; record the failure and move to the next delivery.
        // lib/email.ts already logs the provider error, so we don't duplicate.
        await markFailed(db, delivery.id, message);
        outcomes[deliveryId] = "failed";
        continue;
      }

      // Send succeeded; record the provider's message id.
      await markSent(db, delivery.id, result.providerMessageId);
      outcomes[deliveryId] = "sent";
    } catch (error) {
      // Bookkeeping failed, not the send. Leave the row where it is rather than
      // claiming to know the outcome, and keep going with the rest of the batch.
      console.error("deliverQueued: could not record a delivery outcome", { deliveryId, error });
      outcomes[deliveryId] = "skipped";
    }
  }

  return outcomes;
}
