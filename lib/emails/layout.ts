/**
 * Escapes text for interpolation into an HTML email body.
 *
 * Names, class names, and notes are all user- or staff-supplied, and an email
 * body is the one place in this system where such text is assembled into
 * markup by hand rather than by React.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const STUDIO = "Jodi&rsquo;s Dance Unlimited";

export type RenderedEmail = { subject: string; text: string; html: string };

/**
 * Splits a plain-text body into paragraphs on blank lines.
 *
 * A single newline stays inside its paragraph — the studio owner writing an
 * address or a list of times means those lines to stay together.
 */
export function toParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/** Escaped text with its single newlines turned into line breaks. */
export function escapeParagraph(paragraph: string): string {
  return escapeHtml(paragraph).replaceAll("\n", "<br />");
}

/**
 * Wraps rendered paragraphs in the shared shell.
 *
 * Inline styles and a table-free single column on purpose: email clients strip
 * stylesheets, and anything more elaborate degrades worse than it gains.
 * Callers pass HTML that is already escaped.
 */
export function wrapHtml(
  heading: string,
  paragraphs: string[],
  footerHtml = "",
): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;">${p}</p>`)
    .join("");

  return [
    `<div style="background:#f6f5f3;padding:24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#14161a;">`,
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e1dc;padding:32px;">`,
    `<p style="margin:0 0 24px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#b57a33;">${STUDIO}</p>`,
    `<h1 style="margin:0 0 20px;font-size:20px;">${heading}</h1>`,
    body,
    footerHtml,
    `</div></div>`,
  ].join("");
}

const UNSUB_NOTE =
  "You are receiving this because your family is enrolled at Jodi&rsquo;s Dance Unlimited.";

/**
 * The broadcast shell: the transactional one plus a footer.
 *
 * Only broadcast mail gets this. A family cannot opt out of being told what
 * happened to their own request or their own class, so a transactional
 * `wrapHtml` call must never pass a footer.
 */
export function wrapBroadcastHtml(
  heading: string,
  paragraphs: string[],
  unsubscribeUrl: string,
): string {
  const footer = [
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e1dc;font-size:12px;line-height:1.5;color:#6f6a63;">`,
    UNSUB_NOTE,
    ` <a href="${unsubscribeUrl}" style="color:#b57a33;">Unsubscribe from studio news</a>.`,
    `</p>`,
  ].join("");

  return wrapHtml(heading, paragraphs, footer);
}

/** The same footer for the text part. */
export function broadcastTextFooter(unsubscribeUrl: string): string {
  return [
    "--",
    "You are receiving this because your family is enrolled at Jodi's Dance Unlimited.",
    `Unsubscribe from studio news: ${unsubscribeUrl}`,
  ].join("\n");
}
