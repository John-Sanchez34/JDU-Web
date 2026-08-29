import { EnrollmentQueueActions } from "@/components/enrollment-queue-actions";
import { db } from "@/db";
import { listPendingRequests } from "@/db/queries/enrollments";
import { daysSince } from "@/lib/dates";
import { formatCents } from "@/lib/format";
import { requireStaff } from "@/lib/guards";

/*
 * A pending request holds a real seat and nothing expires it automatically,
 * so the only thing keeping a forgotten hold from starving a class is staff
 * seeing it. The queue is ordered oldest first and anything past this many
 * days is called out, which is the mitigation the spec relies on in place of
 * automatic expiry.
 */
const STALE_AFTER_DAYS = 14;

function formatAge(days: number): string {
  if (days === 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

export default async function AdminEnrollmentsPage() {
  await requireStaff();
  const requests = await listPendingRequests(db);
  // One clock for the whole render, so two rows requested a minute apart can
  // never be aged against different "now"s.
  const now = new Date();

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">Requests</h2>
      <p className="hint mt-2">
        Confirm a request once the family has paid at the studio. Releasing one
        returns its seat to the class.
      </p>

      {requests.length === 0 ? (
        <p className="mt-8 text-mirror">No requests waiting.</p>
      ) : (
        <ul className="panel mt-8 divide-y divide-barre/25">
          {requests.map((request) => {
            const studentName = `${request.studentFirstName} ${request.studentLastName}`;
            const age = daysSince(request.requestedAt, now);
            const stale = age >= STALE_AFTER_DAYS;

            return (
              <li
                key={request.enrollmentId}
                className="flex flex-wrap items-start justify-between gap-4 p-5"
              >
                <div>
                  <p className="font-semibold text-chalk">
                    {studentName}
                    <span className="ml-3 text-sm font-normal text-mirror">
                      {request.familyName}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-maple">{request.className}</p>
                  <p className="mt-2 text-sm text-mirror">
                    <span className="tabular">
                      {formatCents(request.monthlyPriceCents)}
                    </span>{" "}
                    per month
                    {request.seasonFeeCents > 0 && (
                      <>
                        {" · "}
                        <span className="tabular">
                          {formatCents(request.seasonFeeCents)}
                        </span>{" "}
                        season fee
                      </>
                    )}
                  </p>
                  <p
                    data-stale={stale ? "true" : undefined}
                    className={`tabular mt-2 text-sm ${stale ? "font-semibold text-alarm" : "text-barre"}`}
                  >
                    Waiting {formatAge(age)}
                    {stale && " — follow up"}
                  </p>
                </div>

                <EnrollmentQueueActions
                  enrollmentId={request.enrollmentId}
                  studentName={studentName}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
