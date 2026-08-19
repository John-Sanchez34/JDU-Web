import type { Metadata } from "next";
import Link from "next/link";
import { WeeklySchedule } from "@/components/weekly-schedule";
import { studio } from "@/content/studio";
import { db } from "@/db";
import { listOccurrencesBetween } from "@/db/queries/class-occurrences";
import { todayIso } from "@/lib/dates";
import { addDaysIso, weekBounds } from "@/lib/week";

export const metadata: Metadata = {
  title: "Schedule",
  description: `The week-by-week class schedule at ${studio.name}.`,
};

export const revalidate = 300;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const RANGE = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function formatRange(from: string, to: string): string {
  return `${RANGE.format(new Date(`${from}T00:00:00Z`))} – ${RANGE.format(
    new Date(`${to}T00:00:00Z`),
  )}`;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const today = todayIso();
  /* An unparseable ?week= falls back to this week rather than erroring. */
  const anchor = params.week && ISO_DATE.test(params.week) ? params.week : today;
  const { from, to } = weekBounds(anchor);

  const classes = await listOccurrencesBetween(db, from, to);

  return (
    <main className="mx-auto max-w-6xl px-6 py-20">
      <p className="eyebrow">Week of</p>
      <h1 className="display mt-3 text-4xl uppercase text-chalk sm:text-5xl">
        Schedule
      </h1>

      <nav
        aria-label="Week"
        className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm"
      >
        <Link
          href={`/schedule?week=${addDaysIso(from, -7)}`}
          className="font-medium text-maple transition-colors hover:text-chalk"
        >
          ← Previous week
        </Link>
        <span className="tabular text-mirror">{formatRange(from, to)}</span>
        <Link
          href={`/schedule?week=${addDaysIso(from, 7)}`}
          className="font-medium text-maple transition-colors hover:text-chalk"
        >
          Next week →
        </Link>
        {from !== weekBounds(today).from && (
          <Link
            href="/schedule"
            className="text-mirror transition-colors hover:text-chalk"
          >
            Back to this week
          </Link>
        )}
      </nav>

      <span aria-hidden className="barre mt-8 opacity-40" />

      <WeeklySchedule classes={classes} from={from} today={today} />
    </main>
  );
}
