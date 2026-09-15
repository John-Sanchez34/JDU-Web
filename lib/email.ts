import { Resend } from "resend";
import { env } from "@/lib/env";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * Extra provider headers. Broadcast mail uses this for `List-Unsubscribe`
   * and `List-Unsubscribe-Post`; transactional mail passes nothing.
   */
  headers?: Record<string, string>;
};

export type SendResult = { providerMessageId: string | null };

/**
 * A send the provider refused, carrying enough to tell *why* apart from *that*.
 *
 * The batch runner has to distinguish a rate limit — stop, try the rest later —
 * from a rejected address — record it and move on. Matching on the message
 * string would work until Resend rewords anything, so the status code and the
 * provider's error name travel on the error itself.
 */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
    readonly providerErrorName: string | null,
  ) {
    super(message);
    this.name = "EmailSendError";
  }

  get isRateLimited(): boolean {
    return this.statusCode === 429 || this.providerErrorName === "rate_limit_exceeded";
  }
}

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
    // A leaked EMAIL_TRANSPORT=capture in production is the one failure mode
    // the delivery table cannot detect on its own: the row still reads `sent`
    // with a plausible-looking id, and /admin/emails stays empty because
    // nothing ever failed. Refuse outright rather than silently discard mail.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "EMAIL_TRANSPORT=capture is set in a production environment — refusing to discard mail silently.",
      );
    }
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
    ...(message.headers ? { headers: message.headers } : {}),
  });

  if (error) {
    console.error("sendEmail failed", { to: message.to, error });
    /*
     * No cast and no fallbacks: Resend 6.20 types its `ErrorResponse` as
     * `{ message: string; statusCode: number | null; name: RESEND_ERROR_CODE_KEY }`,
     * and `rate_limit_exceeded` is one of that union's members — so the
     * rate-limit test below is reading a documented value, not guessing at an
     * undocumented shape. Verified in `node_modules/resend/dist/index.d.mts`.
     */
    throw new EmailSendError(
      `Failed to send email: ${error.message}`,
      error.statusCode,
      error.name,
    );
  }

  return { providerMessageId: data?.id ?? null };
}
