import type { ScheduledClass } from "@/db/queries/class-occurrences";
import { formatTimeRange } from "@/lib/format";
import { addDaysIso } from "@/lib/week";

const WEEKDAY = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  timeZone: "UTC",
});

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function asUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function WeeklySchedule({
  classes,
  from,
  today,
}: {
  classes: ScheduledClass[];
  from: string;
  today?: string;
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDaysIso(from, index));
  const byDate = new Map<string, ScheduledClass[]>();
  for (const entry of classes) {
    const bucket = byDate.get(entry.occurrence.date) ?? [];
    bucket.push(entry);
    byDate.set(entry.occurrence.date, bucket);
  }

  return (
    <div className="mt-10 grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {days.map((date) => {
        const entries = byDate.get(date) ?? [];
        const isToday = date === today;
        const day = asUtcDate(date);

        return (
          <section key={date} aria-label={`${WEEKDAY.format(day)}, ${MONTH_DAY.format(day)}`}>
            <h2 className={isToday ? "eyebrow" : "eyebrow text-barre"}>
              {WEEKDAY.format(day)}
            </h2>
            <p className="tabular mt-1 text-sm text-mirror">
              {MONTH_DAY.format(day)}
            </p>
            {/* The day's barre carries the accent when it is today. */}
            <span
              aria-hidden
              className={`barre mt-3 ${isToday ? "bg-maple" : "opacity-40"}`}
            />

            {entries.length === 0 ? (
              <p className="mt-4 text-sm text-barre">No classes</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {entries.map(({ occurrence, offering }) => {
                  const cancelled = occurrence.status === "cancelled";
                  return (
                    <li key={occurrence.id} className="panel p-3 text-sm">
                      <p
                        className={
                          cancelled
                            ? "font-semibold text-mirror line-through"
                            : "font-semibold text-chalk"
                        }
                      >
                        {offering.name}
                      </p>
                      <p
                        className={
                          cancelled
                            ? "tabular mt-1 text-mirror line-through"
                            : "tabular mt-1 text-maple"
                        }
                      >
                        {formatTimeRange(offering.startTime, offering.endTime)}
                      </p>
                      {offering.room && !cancelled && (
                        <p className="mt-1 text-mirror">{offering.room}</p>
                      )}
                      {cancelled && (
                        <p className="mt-2 font-semibold text-alarm">
                          Cancelled
                          {occurrence.note ? (
                            <span className="block font-normal text-mirror">
                              {occurrence.note}
                            </span>
                          ) : null}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
