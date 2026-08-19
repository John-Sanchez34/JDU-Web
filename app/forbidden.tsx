import Link from "next/link";

/**
 * Shown when a signed-in account lacks the role a page requires — a parent
 * reaching the backoffice, for instance. It offers the two places such a
 * visitor actually wants, rather than leaving them on a dead end.
 */
export default function Forbidden() {
  return (
    <div className="mirror-glare flex min-h-screen items-center justify-center px-6 py-24">
      <main className="w-full max-w-sm">
        <p className="eyebrow tabular">403</p>
        <h1 className="display mt-3 text-4xl uppercase text-chalk">
          Not allowed
        </h1>
        <span aria-hidden className="barre mt-6 opacity-40" />

        <p className="mt-8 leading-relaxed text-mirror">
          Your account does not have access to this page. If you think it
          should, ask the studio to update your role.
        </p>

        <div className="mt-10 flex flex-wrap gap-4">
          <Link href="/portal" className="btn btn-solid">
            Go to my account
          </Link>
          <Link href="/" className="btn btn-ghost">
            Back to site
          </Link>
        </div>
      </main>
    </div>
  );
}
