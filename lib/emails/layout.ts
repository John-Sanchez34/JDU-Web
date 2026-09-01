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

/**
 * Wraps rendered paragraphs in the shared shell.
 *
 * Inline styles and a table-free single column on purpose: email clients strip
 * stylesheets, and anything more elaborate degrades worse than it gains.
 * Callers pass HTML that is already escaped.
 */
export function wrapHtml(heading: string, paragraphs: string[]): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;">${p}</p>`)
    .join("");

  return [
    `<div style="background:#f6f5f3;padding:24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#14161a;">`,
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e1dc;padding:32px;">`,
    `<p style="margin:0 0 24px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#b57a33;">${STUDIO}</p>`,
    `<h1 style="margin:0 0 20px;font-size:20px;">${heading}</h1>`,
    body,
    `</div></div>`,
  ].join("");
}
