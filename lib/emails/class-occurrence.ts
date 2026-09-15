import { formatIsoDate } from "@/lib/dates";
import { formatTimeRange } from "@/lib/format";
import { escapeHtml, wrapHtml, type RenderedEmail } from "./layout";

export type ClassOccurrenceEmailTemplate = "class.cancelled" | "class.restored";

export type ClassOccurrenceEmailData = {
  className: string;
  /** The occurrence's calendar date, YYYY-MM-DD. */
  date: string;
  startTime: string;
  endTime: string;
  /** Staff's reason for cancelling. Null on a restoration. */
  reason: string | null;
};

/** "Monday, 12 October 2026, 4:00 PM – 5:00 PM" */
function whenLine(data: ClassOccurrenceEmailData): string {
  return `${formatIsoDate(data.date)}, ${formatTimeRange(data.startTime, data.endTime)}`;
}

/*
 * Both messages are transactional: they carry no unsubscribe link and reach
 * every family on the roster regardless of the broadcast preference. A family
 * cannot opt out of being told their own class is not happening.
 *
 * Neither mentions money. The studio takes payment in person and this system
 * tracks no balances, so it is in no position to promise a credit or a
 * make-up class — that conversation happens at the desk.
 */
function body(
  template: ClassOccurrenceEmailTemplate,
  data: ClassOccurrenceEmailData,
): { heading: string; subject: string; paragraphs: string[] } {
  switch (template) {
    case "class.cancelled":
      return {
        subject: `${data.className} is cancelled on ${formatIsoDate(data.date)}`,
        heading: "One class is cancelled",
        paragraphs: [
          `${data.className} on ${whenLine(data)} will not take place.`,
          ...(data.reason ? [data.reason] : []),
          "Every other week runs as normal. If you have a question, call the studio and we will sort it out.",
        ],
      };
    case "class.restored":
      return {
        subject: `${data.className} is going ahead on ${formatIsoDate(data.date)}`,
        heading: "That class is back on",
        paragraphs: [
          `We told you ${data.className} on ${whenLine(data)} was cancelled. It is going ahead after all.`,
          "Sorry for the confusion — please come as usual.",
        ],
      };
  }
}

/** Renders one occurrence email. Pure, like the enrollment templates. */
export function renderClassOccurrenceEmail(
  template: ClassOccurrenceEmailTemplate,
  data: ClassOccurrenceEmailData,
): RenderedEmail {
  const { heading, subject, paragraphs } = body(template, data);

  return {
    subject,
    text: `${heading}\n\n${paragraphs.join("\n\n")}\n`,
    html: wrapHtml(escapeHtml(heading), paragraphs.map(escapeHtml)),
  };
}
