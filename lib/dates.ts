import type { DayOfWeek } from "@/db/schema";

/** Returns a date as YYYY-MM-DD in UTC. Defaults to now. */
export function todayIso(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function formatDayOfWeek(day: DayOfWeek): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}
