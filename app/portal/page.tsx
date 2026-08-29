import Link from "next/link";
import { ClassCard } from "@/components/class-card";
import { EnrollmentRequestForm } from "@/components/enrollment-request-form";
import { db } from "@/db";
import { listPublishedOfferings } from "@/db/queries/class-offerings";
import { getCurrentSeason } from "@/db/queries/seasons";
import { listStudents } from "@/db/queries/students";
import { requireFamilyId } from "@/lib/guards";
import { todayIso } from "@/lib/dates";

export default async function PortalHome() {
  const familyId = await requireFamilyId();
  const students = await listStudents(db, familyId);
  const season = await getCurrentSeason(db, todayIso());
  const offerings = season ? await listPublishedOfferings(db, season.id) : [];

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">Overview</h2>
      <p className="mt-3 text-mirror">
        {students.length === 0
          ? "You have not added any students yet."
          : `You have ${students.length} ${
              students.length === 1 ? "student" : "students"
            } on file.`}
      </p>
      <p className="mt-6">
        <Link
          href="/portal/students"
          className="font-medium text-maple transition-colors hover:text-chalk"
        >
          Manage students
        </Link>
      </p>

      <div className="mt-12">
        <h3 className="text-lg font-semibold text-chalk">
          Request a class seat
        </h3>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-mirror">
          Requesting a seat holds it right away. A request is confirmed once
          you bring payment to the studio in person — we never collect
          payment online.
        </p>

        {!season || offerings.length === 0 ? (
          <p className="mt-6 text-sm text-mirror">
            No classes are open for requests right now.
          </p>
        ) : (
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {offerings.map((offering) => {
              // `ClassCard` already renders "Full" in place of a seat count
              // when the class is at capacity, so the form is simply omitted
              // rather than duplicating that message underneath.
              const full = offering.seatsTaken >= offering.capacity;
              return (
                <div key={offering.id} className="flex flex-col gap-3">
                  <ClassCard offering={offering} />
                  {!full && (
                    <EnrollmentRequestForm
                      offeringId={offering.id}
                      students={students}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
