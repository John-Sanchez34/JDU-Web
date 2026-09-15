import { db } from "@/db";
import { setBroadcastOptOut } from "@/db/queries/users";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

/*
 * The opt-out endpoint. POST only, on purpose.
 *
 * Corporate mail scanners and link prefetchers follow every GET in a message,
 * so a GET that unsubscribes would quietly unsubscribe people who never
 * clicked anything. The footer link points at /unsubscribe, a page; this is
 * where its button — and RFC 8058 one-click, from the List-Unsubscribe-Post
 * header — actually lands.
 *
 * A route handler rather than a server action because it must accept an
 * unauthenticated cross-origin POST from a mailbox provider. The signed token
 * in the query string is the authentication.
 */
function page(message: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Studio news</title></head>` +
      `<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;` +
      `background:#14161a;color:#f2f0ec;padding:48px;line-height:1.6;">` +
      `<p>${message}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("u");
  const userId = token ? verifyUnsubscribeToken(token) : null;

  /*
   * One message for a bad token and for an unknown account. A different
   * response for each would turn this endpoint into an oracle for whether a
   * given token names a live account.
   */
  if (!userId || !(await setBroadcastOptOut(db, userId, true))) {
    return page("That unsubscribe link is not valid. Call the studio and we will sort it out.", 400);
  }

  return page(
    "You have been unsubscribed from studio news. You will still receive messages about your own enrollments and class cancellations.",
    200,
  );
}
