import type { ClassOffering } from "@/db/schema";
import { formatCents, formatTimeRange } from "@/lib/format";
import { formatDayOfWeek } from "@/lib/dates";

function ageRange(offering: ClassOffering): string | null {
  const { minAge, maxAge } = offering;
  if (minAge !== null && maxAge !== null) return `${minAge}–${maxAge}`;
  if (minAge !== null) return `${minAge}+`;
  if (maxAge !== null) return `up to ${maxAge}`;
  return null;
}

/**
 * Seats are shown as a state, not a number, until the room is nearly full —
 * an exact count only helps a parent when it is small enough to act on.
 */
function availability(seatsLeft: number): { label: string; full: boolean } {
  if (seatsLeft <= 0) return { label: "Full", full: true };
  if (seatsLeft <= 3) {
    return {
      label: `${seatsLeft} ${seatsLeft === 1 ? "spot" : "spots"} left`,
      full: false,
    };
  }
  return { label: "Space available", full: false };
}

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-4 sm:col-span-2 sm:grid-cols-subgrid">
      <dt className="eyebrow pt-0.5 text-barre">{term}</dt>
      <dd className="text-chalk">{children}</dd>
    </div>
  );
}

export function ClassCard({ offering }: { offering: ClassOffering }) {
  const seatsLeft = offering.capacity - offering.seatsTaken;
  const ages = ageRange(offering);
  const seats = availability(seatsLeft);

  return (
    <article className="panel flex flex-col p-6">
      <h3 className="text-xl font-semibold text-chalk">{offering.name}</h3>
      <p className="tabular mt-2 text-sm text-maple">
        {formatDayOfWeek(offering.dayOfWeek)},{" "}
        {formatTimeRange(offering.startTime, offering.endTime)}
      </p>

      {offering.description && (
        <p className="mt-4 leading-relaxed text-mirror">
          {offering.description}
        </p>
      )}

      <dl className="mt-6 grid gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        {offering.level && <Detail term="Level">{offering.level}</Detail>}
        {ages && (
          /* Advisory only — enrollment does not enforce this. */
          <Detail term="Ages">
            {ages} <span className="text-mirror">(suggested)</span>
          </Detail>
        )}
        {offering.instructor && (
          <Detail term="With">{offering.instructor}</Detail>
        )}
        <Detail term="Tuition">
          <span className="tabular">{formatCents(offering.monthlyPriceCents)}</span>{" "}
          <span className="text-mirror">per month</span>
        </Detail>
        {offering.seasonFeeCents > 0 && (
          <Detail term="Season fee">
            <span className="tabular">{formatCents(offering.seasonFeeCents)}</span>{" "}
            <span className="text-mirror">once</span>
          </Detail>
        )}
      </dl>

      {/* Sits on the card's floor so availability lines up across a row. */}
      <p
        className={`mt-auto pt-6 text-sm font-semibold ${
          seats.full ? "text-alarm" : "text-chalk"
        }`}
      >
        {seats.label}
      </p>
    </article>
  );
}
