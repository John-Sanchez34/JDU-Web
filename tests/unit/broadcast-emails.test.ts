import { describe, expect, it } from "vitest";
import { renderAnnouncementEmail } from "@/lib/emails/announcement";
import { renderClassOccurrenceEmail } from "@/lib/emails/class-occurrence";
import { toParagraphs } from "@/lib/emails/layout";

const UNSUB = "https://studio.example/unsubscribe?u=token";

const occurrence = {
  className: "Ballet I",
  date: "2026-10-12",
  dayOfWeek: "monday" as const,
  startTime: "16:00:00",
  endTime: "17:00:00",
  reason: "The instructor is unwell.",
};

describe("toParagraphs", () => {
  it("splits on blank lines and drops empty ones", () => {
    expect(toParagraphs("One.\n\nTwo.\n\n\n  \n\nThree.")).toEqual(["One.", "Two.", "Three."]);
  });

  it("keeps a single newline inside one paragraph", () => {
    expect(toParagraphs("Line one\nline two")).toEqual(["Line one\nline two"]);
  });
});

describe("renderAnnouncementEmail", () => {
  it("uses the title as the subject and renders the body as paragraphs", () => {
    const rendered = renderAnnouncementEmail({
      title: "Recital tickets",
      body: "Tickets are available at the desk.\n\nBring exact change.",
      unsubscribeUrl: UNSUB,
    });

    expect(rendered.subject).toBe("Recital tickets");
    expect(rendered.text).toContain("Tickets are available at the desk.");
    expect(rendered.text).toContain("Bring exact change.");
    expect(rendered.html).toContain("<p style=");
  });

  it("carries the unsubscribe link in both parts", () => {
    const rendered = renderAnnouncementEmail({
      title: "Recital tickets",
      body: "Tickets are available at the desk.",
      unsubscribeUrl: UNSUB,
    });

    expect(rendered.text).toContain(UNSUB);
    expect(rendered.html).toContain(`href="${UNSUB}"`);
  });

  it("renders a script tag in the body inert", () => {
    const rendered = renderAnnouncementEmail({
      title: "Hi <script>alert(1)</script>",
      body: "Careful: <script>alert(2)</script> & co.",
      unsubscribeUrl: UNSUB,
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("&amp; co.");
  });
});

describe("renderClassOccurrenceEmail", () => {
  it("names the class, the date and the reason when cancelling", () => {
    const rendered = renderClassOccurrenceEmail("class.cancelled", occurrence);

    expect(rendered.subject).toContain("Ballet I");
    expect(rendered.text).toContain("Monday, 12 October 2026");
    expect(rendered.text).toContain("The instructor is unwell.");
  });

  it("says the class is back on when restoring", () => {
    const rendered = renderClassOccurrenceEmail("class.restored", {
      ...occurrence,
      reason: null,
    });

    expect(rendered.text).toContain("Ballet I");
    expect(rendered.text).toContain("Monday, 12 October 2026");
    expect(rendered.text.toLowerCase()).toContain("going ahead");
  });

  it("carries no unsubscribe link — a cancellation is transactional", () => {
    for (const template of ["class.cancelled", "class.restored"] as const) {
      const rendered = renderClassOccurrenceEmail(template, occurrence);
      expect(rendered.text.toLowerCase()).not.toContain("unsubscribe");
      expect(rendered.html.toLowerCase()).not.toContain("unsubscribe");
    }
  });

  it("mentions no money, because nothing here tracks any", () => {
    for (const template of ["class.cancelled", "class.restored"] as const) {
      const rendered = renderClassOccurrenceEmail(template, occurrence);
      for (const word of ["$", "refund", "credit", "make-up", "makeup"]) {
        expect(rendered.text.toLowerCase()).not.toContain(word);
      }
    }
  });
});
