import {
  broadcastTextFooter,
  escapeHtml,
  escapeParagraph,
  toParagraphs,
  wrapBroadcastHtml,
  type RenderedEmail,
} from "./layout";

/** The one template this phase's announcements use. */
export const ANNOUNCEMENT_TEMPLATE = "announcement.posted";

export type AnnouncementEmailData = {
  title: string;
  body: string;
  /** This recipient's own link — which is why rendering happens per row. */
  unsubscribeUrl: string;
};

/**
 * Renders one announcement. Pure: no database, no clock, no environment.
 *
 * The title becomes the subject verbatim. Staff wrote it for a person to read
 * in their inbox, and inventing a prefix around it would only make the studio
 * sound like a mailing list.
 */
export function renderAnnouncementEmail(data: AnnouncementEmailData): RenderedEmail {
  const paragraphs = toParagraphs(data.body);

  return {
    subject: data.title,
    text: [data.title, "", paragraphs.join("\n\n"), "", broadcastTextFooter(data.unsubscribeUrl)]
      .join("\n")
      .concat("\n"),
    html: wrapBroadcastHtml(
      escapeHtml(data.title),
      paragraphs.map(escapeParagraph),
      data.unsubscribeUrl,
    ),
  };
}
