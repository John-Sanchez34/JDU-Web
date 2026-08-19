import { studio } from "@/content/studio";

/**
 * Hours are authored as single lines ("Friday: 3:30 PM – 7:00 PM") so the
 * owner edits them as sentences, but they read better as a two-column table.
 * Splitting on the first ": " keeps the colons inside a clock time intact; a
 * line without one falls back to rendering whole.
 */
function splitHours(line: string): { days: string; time: string } {
  const at = line.indexOf(": ");
  if (at === -1) return { days: line, time: "" };
  return { days: line.slice(0, at), time: line.slice(at + 2) };
}

export function HoursList() {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
      {studio.hours.map((line) => {
        const { days, time } = splitHours(line);
        return (
          <div
            key={line}
            className="grid gap-x-8 sm:col-span-2 sm:grid-cols-subgrid"
          >
            <dt className="text-mirror">{days}</dt>
            <dd className="tabular text-chalk">{time}</dd>
          </div>
        );
      })}
    </dl>
  );
}
