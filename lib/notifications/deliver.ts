import { claimForSend, markFailed, markSent } from "@/db/queries/email-deliveries";
import type { Database } from "@/db/queries/executor";
import { sendEmail } from "@/lib/email";

/**
 * Sends a batch of queued deliveries, one row at a time.
 *
 * Runs after the response — from `after()` in a server action, or from the
 * Retry action — so nothing here may throw into a caller that has already
 * returned. A failure is recorded on its own row and the next row still goes
 * out; one bad address must not silence the rest of a family's mail.
 */
export async function deliverQueued(
  db: Database,
  deliveryIds: string[],
): Promise<void> {
  for (const deliveryId of deliveryIds) {
    // Claiming is what makes a double Retry safe: a row already sent, or
    // already in flight elsewhere, comes back null and is skipped.
    const delivery = await claimForSend(db, deliveryId);
    if (!delivery) continue;

    try {
      const { providerMessageId } = await sendEmail({
        to: delivery.recipientEmail,
        subject: delivery.subject,
        text: delivery.bodyText,
        html: delivery.bodyHtml,
      });
      await markSent(db, delivery.id, providerMessageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("deliverQueued failed", { deliveryId, message });
      await markFailed(db, delivery.id, message);
    }
  }
}
