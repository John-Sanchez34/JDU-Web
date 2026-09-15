import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailSendError, sendEmail } from "@/lib/email";

describe("sendEmail with the capture transport", () => {
  const original = process.env.EMAIL_TRANSPORT;

  beforeEach(() => {
    process.env.EMAIL_TRANSPORT = "capture";
  });

  afterEach(() => {
    process.env.EMAIL_TRANSPORT = original;
  });

  it("returns a synthetic provider id without calling the provider", async () => {
    const result = await sendEmail({
      to: "parent@example.com",
      subject: "Your seat is held",
      text: "text body",
      html: "<p>html body</p>",
    });

    expect(result.providerMessageId).toMatch(/^capture-/);
  });

  describe("in production", () => {
    // `NODE_ENV` is typed read-only, so it is stubbed rather than assigned.
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("throws naming EMAIL_TRANSPORT rather than discarding mail silently", async () => {
      // The one failure mode the delivery table cannot detect on its own: a
      // leaked capture transport would otherwise mark every row `sent` while
      // discarding the message, and /admin/emails would stay empty.
      await expect(
        sendEmail({
          to: "parent@example.com",
          subject: "Your seat is held",
          text: "text body",
          html: "<p>html body</p>",
        }),
      ).rejects.toThrow(/EMAIL_TRANSPORT/);
    });
  });
});

describe("EmailSendError", () => {
  it("recognises a 429 as a rate limit", () => {
    expect(new EmailSendError("slow down", 429, null).isRateLimited).toBe(true);
  });

  it("recognises the provider's named rate-limit error without a status", () => {
    expect(
      new EmailSendError("slow down", null, "rate_limit_exceeded").isRateLimited,
    ).toBe(true);
  });

  it("treats a rejected address as an ordinary failure", () => {
    expect(new EmailSendError("invalid recipient", 422, "validation_error").isRateLimited).toBe(
      false,
    );
  });
});
