import type { DayOfWeek } from "@/db/schema";

/** Returns a date as YYYY-MM-DD in UTC. Defaults to now. */
export function todayIso(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function formatDayOfWeek(day: DayOfWeek): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole days elapsed since `date`, counted between UTC calendar days so the
 * answer matches what `todayIso` would print and never drifts by an hour.
 * A future date counts as 0 rather than going negative.
 */
export function daysSince(date: Date, now: Date = new Date()): number {
  const from = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((to - from) / MS_PER_DAY));
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * "2026-10-12" becomes "Monday, 12 October 2026".
 *
 * Formatted in UTC so it agrees with `todayIso` and with the `date` columns,
 * which are calendar dates with no zone of their own — reading one in local
 * time is how a Monday class becomes a Sunday class for anyone west of here.
 */
export function formatIsoDate(iso: string): string {
  return DATE_FORMAT.format(new Date(`${iso}T00:00:00Z`));
}
