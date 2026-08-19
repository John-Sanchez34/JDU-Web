import { StudioWordmark } from "@/components/studio-wordmark";

/**
 * Auth pages stand outside the public shell — no nav to wander into
 * mid-signup — but they still need a way back to the site, so the wordmark
 * doubles as the exit.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mirror-glare flex min-h-screen flex-col">
      <header className="mx-auto w-full max-w-5xl px-6 py-6">
        <StudioWordmark href="/" priority />
      </header>

      {/* The form hangs off the same left axis as the wordmark and as every
          heading on the public site, rather than floating dead centre. */}
      <div className="mx-auto flex w-full max-w-5xl flex-1 items-start px-6 pb-24 pt-8 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
