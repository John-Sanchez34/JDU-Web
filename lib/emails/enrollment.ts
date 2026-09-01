import type { DayOfWeek } from "@/db/schema";
import { formatDayOfWeek } from "@/lib/dates";
import { formatCents, formatTimeRange } from "@/lib/format";
import { escapeHtml, wrapHtml } from "./layout";

export type EnrollmentEmailTemplate =
  | "enrollment.requested"
  | "enrollment.confirmed"
  | "enrollment.released";

export type EnrollmentEmailData = {
  studentFirstName: string;
  studentLastName: string;
  className: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  monthlyPriceCents: number;
  seasonFeeCents: number;
};

export type RenderedEmail = { subject: string; text: string; html: string };

/** "Ballet I — Monday, 4:00 PM – 5:00 PM" */
function whenLine(data: EnrollmentEmailData): string {
  return `${data.className} — ${formatDayOfWeek(data.dayOfWeek)}, ${formatTimeRange(
    data.startTime,
    data.endTime,
  )}`;
}

/**
 * The money paragraph. Phrased as what to bring to the studio, never as an
 * amount owed to this website — the site takes no payment.
 */
function costLines(data: EnrollmentEmailData): string[] {
  const lines = [`Tuition is ${formatCents(data.monthlyPriceCents)} per month.`];
  if (data.seasonFeeCents > 0) {
    lines.push(`There is also a one-time season fee of ${formatCents(data.seasonFeeCents)}.`);
  }
  lines.push("Payment is taken in person at the studio — we never collect it online.");
  return lines;
}

/*
 * `data.className` is staff-supplied and lands in `subject` below. It reaches
 * Resend as a JSON string value over HTTPS, never as a raw SMTP header, so a
 * CR/LF in a class name cannot inject a header here — no sanitisation needed
 * *by this transport*. That is a property of the transport, not of the data:
 * a future SMTP transport would have to add that sanitisation itself.
 */
function body(
  template: EnrollmentEmailTemplate,
  data: EnrollmentEmailData,
): { heading: string; subject: string; paragraphs: string[] } {
  const student = `${data.studentFirstName} ${data.studentLastName}`;

  switch (template) {
    case "enrollment.requested":
      return {
        subject: `We're holding a seat in ${data.className}`,
        heading: "Your request is in",
        paragraphs: [
          `We are holding a seat for ${student} in ${whenLine(data)}.`,
          ...costLines(data),
          "The seat is held until a member of staff confirms it. Nothing else is needed from you online.",
        ],
      };
    case "enrollment.confirmed":
      return {
        subject: `${data.className} is confirmed`,
        heading: "You're enrolled",
        paragraphs: [
          `${student} is now enrolled in ${whenLine(data)}.`,
          "We have recorded your payment at the studio. See you in class.",
        ],
      };
    case "enrollment.released":
      return {
        subject: `The seat in ${data.className} has been released`,
        heading: "The hold has been released",
        paragraphs: [
          `The seat we were holding for ${student} in ${whenLine(data)} has been released, so it is no longer reserved.`,
          "If this is not what you expected, reply to this message or call the studio and we will sort it out.",
        ],
      };
  }
}

/**
 * Renders one enrollment email. Pure: no database, no clock, no environment —
 * which is what makes the wording unit-testable.
 */
export function renderEnrollmentEmail(
  template: EnrollmentEmailTemplate,
  data: EnrollmentEmailData,
): RenderedEmail {
  const { heading, subject, paragraphs } = body(template, data);

  return {
    subject,
    text: `${heading}\n\n${paragraphs.join("\n\n")}\n`,
    html: wrapHtml(escapeHtml(heading), paragraphs.map(escapeHtml)),
  };
}
