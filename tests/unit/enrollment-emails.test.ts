import { describe, expect, it } from "vitest";
import { escapeHtml } from "@/lib/emails/layout";
import {
  renderEnrollmentEmail,
  type EnrollmentEmailData,
} from "@/lib/emails/enrollment";

const data: EnrollmentEmailData = {
  studentFirstName: "Lucia",
  studentLastName: "Vasquez",
  className: "Ballet I",
  dayOfWeek: "monday",
  startTime: "16:00:00",
  endTime: "17:00:00",
  monthlyPriceCents: 6500,
  seasonFeeCents: 5000,
};

describe("escapeHtml", () => {
  it("neutralizes markup in a name", () => {
    expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });
});

describe("renderEnrollmentEmail", () => {
  it("states both amounts and the pay-in-person rule when a seat is requested", () => {
    const email = renderEnrollmentEmail("enrollment.requested", data);

    expect(email.subject).toContain("Ballet I");
    expect(email.text).toContain("Lucia");
    expect(email.text).toContain("$65.00");
    expect(email.text).toContain("$50.00");
    expect(email.text).toContain("at the studio");
  });

  it("omits the season fee when there is none", () => {
    const email = renderEnrollmentEmail("enrollment.requested", {
      ...data,
      seasonFeeCents: 0,
    });

    expect(email.text).toContain("$65.00");
    expect(email.text).not.toContain("season fee");
  });

  it("tells a family the seat is theirs when confirmed", () => {
    const email = renderEnrollmentEmail("enrollment.confirmed", data);

    expect(email.subject).toContain("Ballet I");
    expect(email.text).toContain("enrolled");
  });

  it("tells a family the hold is gone when released", () => {
    const email = renderEnrollmentEmail("enrollment.released", data);

    expect(email.text).toContain("released");
  });

  it("escapes the student name in the html part", () => {
    const email = renderEnrollmentEmail("enrollment.confirmed", {
      ...data,
      studentFirstName: "<script>",
    });

    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain("<script>");
  });

  it("never carries an unsubscribe link", () => {
    for (const template of [
      "enrollment.requested",
      "enrollment.confirmed",
      "enrollment.released",
    ] as const) {
      const email = renderEnrollmentEmail(template, data);
      expect(email.text.toLowerCase()).not.toContain("unsubscribe");
      expect(email.html.toLowerCase()).not.toContain("unsubscribe");
    }
  });
});
