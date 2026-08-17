import { Resend } from "resend";
import { env } from "@/lib/env";

const resend = new Resend(env.RESEND_API_KEY);

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

/**
 * Sends a transactional email. Failures are logged and rethrown — the caller
 * decides whether a send failure should fail the surrounding operation.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });

  if (error) {
    console.error("sendEmail failed", { to: message.to, error });
    throw new Error(`Failed to send email: ${error.message}`);
  }
}
