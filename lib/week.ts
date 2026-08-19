const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parse(value: string): Date {
  if (!ISO_DATE.test(value)) {
    throw new Error(`Expected a date in YYYY-MM-DD format, got "${value}"`);
  }
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day));
}

/** Shifts a YYYY-MM-DD date by a signed number of days, in UTC. */
export function addDaysIso(date: string, days: number): string {
  const shifted = parse(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Returns the Sunday-to-Saturday week containing the given date. */
export function weekBounds(date: string): { from: string; to: string } {
  const parsed = parse(date);
  const from = addDaysIso(date, -parsed.getUTCDay());
  return { from, to: addDaysIso(from, 6) };
}
