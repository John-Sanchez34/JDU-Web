import { Resend } from "resend";
import { env } from "@/lib/env";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type SendResult = { providerMessageId: string | null };

/*
 * Constructed lazily rather than at module load, so the capture transport
 * never needs a usable API key and importing this module stays cheap.
 */
let resend: Resend | undefined;

function client(): Resend {
  resend ??= new Resend(env.RESEND_API_KEY);
  return resend;
}

/** True when this process must not reach the real provider. */
function capturing(): boolean {
  return process.env.EMAIL_TRANSPORT === "capture";
}

/**
 * Sends one transactional email.
 *
 * Failures are logged and rethrown — the caller decides whether a send failure
 * should fail the surrounding operation. In this system the caller is always
 * the delivery runner, which records the failure on the delivery row.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  if (capturing()) {
    // Deliberately not stored anywhere: the tests that care assert against the
    // delivery row, and holding messages in memory would leak across a run.
    return { providerMessageId: `capture-${crypto.randomUUID()}` };
  }

  const { data, error } = await client().emails.send({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });

  if (error) {
    console.error("sendEmail failed", { to: message.to, error });
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return { providerMessageId: data?.id ?? null };
}
