import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sendEmail } from "@/lib/email";

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
});
