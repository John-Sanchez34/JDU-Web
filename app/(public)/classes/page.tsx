import type { Metadata } from "next";
import Link from "next/link";
import { ClassCard } from "@/components/class-card";
import { studio } from "@/content/studio";
import { db } from "@/db";
import { listPublishedOfferings } from "@/db/queries/class-offerings";
import { getCurrentSeason, listSeasons } from "@/db/queries/seasons";
import { todayIso } from "@/lib/dates";

export const metadata: Metadata = {
  title: "Classes",
  description: `The current season of classes at ${studio.name}.`,
};

export const revalidate = 300;

function PageHeading({ children }: { children: React.ReactNode }) {
  return (
    <>
      <p className="eyebrow">This season</p>
      <h1 className="display mt-3 text-4xl uppercase text-chalk sm:text-5xl">
        Classes
      </h1>
      <span aria-hidden className="barre mt-8 opacity-40" />
      {children}
    </>
  );
}

export default async function ClassesPage() {
  /* Between seasons there is no current one, so fall back to the most recent. */
  const season =
    (await getCurrentSeason(db, todayIso())) ??
    (await listSeasons(db))[0] ??
    null;

  if (!season) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-20">
        <PageHeading>
          <p className="mt-8 max-w-xl leading-relaxed text-mirror">
            Our next season has not been published yet. Please check back soon,
            or{" "}
            <Link
              href="/contact"
              className="font-medium text-maple transition-colors hover:text-chalk"
            >
              get in touch
            </Link>{" "}
            and we will let you know when it opens.
          </p>
        </PageHeading>
      </main>
    );
  }

  const offerings = await listPublishedOfferings(db, season.id);

  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <PageHeading>
        <p className="mt-6 text-lg text-mirror">{season.name}</p>
      </PageHeading>

      {offerings.length === 0 ? (
        <p className="mt-10 max-w-xl leading-relaxed text-mirror">
          No classes are published for this season yet.
        </p>
      ) : (
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {offerings.map((offering) => (
            <ClassCard key={offering.id} offering={offering} />
          ))}
        </div>
      )}

      {/* Signup arrives in Phase 2; until then, enrollment happens in person. */}
      <p className="mt-16 max-w-xl text-sm leading-relaxed text-mirror">
        To enroll or ask about placement,{" "}
        <Link
          href="/contact"
          className="font-medium text-maple transition-colors hover:text-chalk"
        >
          contact the studio
        </Link>
        . Tuition is paid in person.
      </p>
    </main>
  );
}
