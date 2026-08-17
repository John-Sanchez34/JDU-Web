import type { DayOfWeek } from "@/db/schema";

const DAY_INDEX: Record<DayOfWeek, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a YYYY-MM-DD string into a UTC-midnight Date.
 * Using Date.UTC rather than `new Date(string)` keeps schedule math
 * independent of the machine's local timezone.
 */
function parseIsoDate(value: string): Date {
  if (!ISO_DATE.test(value)) {
    throw new Error(`Expected a date in YYYY-MM-DD format, got "${value}"`);
  }
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date "${value}"`);
  }
  return date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Returns every date in [startDate, endDate] that falls on the given weekday,
 * inclusive of both endpoints, as YYYY-MM-DD strings in ascending order.
 */
export function generateOccurrenceDates(
  startDate: string,
  endDate: string,
  day: DayOfWeek,
): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (end < start) {
    throw new Error(
      `generateOccurrenceDates: end date ${endDate} precedes start date ${startDate}`,
    );
  }

  const cursor = new Date(start);
  const offset = (DAY_INDEX[day] - cursor.getUTCDay() + 7) % 7;
  cursor.setUTCDate(cursor.getUTCDate() + offset);

  const dates: string[] = [];
  while (cursor <= end) {
    dates.push(toIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return dates;
}
