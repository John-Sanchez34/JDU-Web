import Link from "next/link";
import { db } from "@/db";
import { listStudents } from "@/db/queries/students";
import { requireFamilyId } from "@/lib/guards";

export default async function PortalHome() {
  const familyId = await requireFamilyId();
  const students = await listStudents(db, familyId);

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

      <div className="panel mt-12 p-5 text-sm leading-relaxed text-mirror">
        Online class enrollment arrives in a future update. To enroll now,
        please contact the studio. Payment is always handled in person at the
        studio.
      </div>
    </section>
  );
}
