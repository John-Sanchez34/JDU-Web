const dollarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * Formats an integer count of cents as US dollars.
 * Throws on non-integer input, because a fractional cent means money
 * arithmetic has leaked into floating point somewhere upstream.
 */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatCents: amount must be an integer, got ${cents}`);
  }
  return dollarFormatter.format(cents / 100);
}

/** Formats a Postgres `time` value (HH:MM:SS) as a 12-hour clock time. */
function formatTime(time: string): string {
  const parts = time.split(":");
  const hour24 = Number(parts[0]);
  const minute = parts[1] ?? "00";
  if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) {
    throw new Error(`formatTime: invalid time ${time}`);
  }
  const period = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${period}`;
}

/** Formats a class start and end time as a display range. */
export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}
