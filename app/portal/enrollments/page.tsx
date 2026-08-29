import Link from "next/link";
import { EnrollmentStatusBadge } from "@/components/enrollment-status-badge";
import { WithdrawEnrollmentButton } from "@/components/withdraw-enrollment-button";
import { db } from "@/db";
import type { FamilyEnrollment } from "@/db/queries/enrollments";
import { listFamilyEnrollments } from "@/db/queries/enrollments";
import { formatDayOfWeek } from "@/lib/dates";
import { formatCents, formatTimeRange } from "@/lib/format";
import { requireFamilyId } from "@/lib/guards";

/**
 * Groups a family's enrollments under the student they belong to, keeping the
 * newest-first order the query returns: the first time a student appears sets
 * that student's position, and their rows stay in query order within it.
 */
function groupByStudent(rows: FamilyEnrollment[]) {
  const groups = new Map<
    string,
    { studentId: string; firstName: string; rows: FamilyEnrollment[] }
  >();
  for (const row of rows) {
    const group = groups.get(row.studentId);
    if (group) {
      group.rows.push(row);
    } else {
      groups.set(row.studentId, {
        studentId: row.studentId,
        firstName: row.studentFirstName,
        rows: [row],
      });
    }
  }
  return [...groups.values()];
}

function EnrollmentRow({ enrollment }: { enrollment: FamilyEnrollment }) {
  // Withdrawn and released rows stay visible so a parent can see what
  // happened, but only a live seat can be given up.
  const canWithdraw =
    enrollment.status === "pending" || enrollment.status === "active";

  return (
    <li className="flex flex-wrap items-start justify-between gap-4 p-5">
      <div>
        <p className="font-semibold text-chalk">{enrollment.className}</p>
        <p className="tabular mt-1 text-sm text-maple">
          {formatDayOfWeek(enrollment.dayOfWeek)},{" "}
          {formatTimeRange(enrollment.startTime, enrollment.endTime)}
        </p>
        <p className="mt-2 text-sm text-mirror">
          <span className="tabular">
            {formatCents(enrollment.monthlyPriceCents)}
          </span>{" "}
          per month
          {enrollment.seasonFeeCents > 0 && (
            <>
              {" · "}
              <span className="tabular">
                {formatCents(enrollment.seasonFeeCents)}
              </span>{" "}
              season fee
            </>
          )}
        </p>
      </div>

      <div className="flex flex-col items-start gap-3 sm:items-end">
        <EnrollmentStatusBadge status={enrollment.status} />
        {canWithdraw && (
          <WithdrawEnrollmentButton enrollmentId={enrollment.enrollmentId} />
        )}
      </div>
    </li>
  );
}

export default async function EnrollmentsPage() {
  const familyId = await requireFamilyId();
  const enrollments = await listFamilyEnrollments(db, familyId);
  const groups = groupByStudent(enrollments);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">Classes</h2>

      {groups.length === 0 ? (
        <p className="mt-8 text-mirror">
          No class requests yet.{" "}
          <Link
            href="/portal"
            className="font-medium text-maple transition-colors hover:text-chalk"
          >
            Browse this season&rsquo;s classes
          </Link>
          .
        </p>
      ) : (
        <div className="mt-8 space-y-10">
          {groups.map((group) => (
            <div key={group.studentId}>
              <h3 className="eyebrow text-barre">{group.firstName}</h3>
              <ul className="panel mt-3 divide-y divide-barre/25">
                {group.rows.map((enrollment) => (
                  <EnrollmentRow
                    key={enrollment.enrollmentId}
                    enrollment={enrollment}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
