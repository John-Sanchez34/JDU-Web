import Link from "next/link";
import { db } from "@/db";
import { listStudents } from "@/db/queries/students";
import { requireFamilyId } from "@/lib/guards";

export default async function StudentsPage() {
  const familyId = await requireFamilyId();
  const students = await listStudents(db, familyId);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-chalk">Students</h2>
        <Link href="/portal/students/new" className="btn btn-solid">
          Add a student
        </Link>
      </div>

      {students.length === 0 ? (
        <p className="mt-8 text-mirror">
          Add each dancer in your family to get started.
        </p>
      ) : (
        <ul className="panel mt-8 divide-y divide-barre/25">
          {students.map((student) => (
            <li
              key={student.id}
              className="flex flex-wrap items-center justify-between gap-4 p-5"
            >
              <div>
                <p className="font-semibold text-chalk">
                  {student.firstName} {student.lastName}
                </p>
                <p className="tabular mt-1 text-sm text-mirror">
                  Born {student.birthdate}
                </p>
              </div>
              <Link
                href={`/portal/students/${student.id}`}
                className="text-sm font-medium text-maple transition-colors hover:text-chalk"
              >
                Edit
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
