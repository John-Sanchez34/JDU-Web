import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

/*
 * Where the footer link lands. It explains and offers a button; it never opts
 * anybody out by being visited.
 *
 * The form posts to /api/unsubscribe rather than calling a server action:
 * plain, cross-origin-safe, and the same endpoint a mailbox provider's
 * one-click button uses, so there is one code path to get right.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string }>;
}) {
  const { u } = await searchParams;
  const valid = u ? verifyUnsubscribeToken(u) !== null : false;

  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <h1 className="display text-2xl uppercase text-chalk">Studio news</h1>

      {!valid ? (
        <p className="mt-6 text-mirror">
          That unsubscribe link is not valid — it may have been cut short by your
          email program. Call the studio and we will take you off the list.
        </p>
      ) : (
        <>
          <p className="mt-6 text-mirror">
            Press the button and we will stop sending you studio news. You will
            still get messages about your own enrollment requests and about a
            class being cancelled — those are not something we can stop.
          </p>
          <form method="post" action={`/api/unsubscribe?u=${encodeURIComponent(u!)}`} className="mt-8">
            <button type="submit" className="btn btn-solid">
              Unsubscribe from studio news
            </button>
          </form>
        </>
      )}
    </main>
  );
}
