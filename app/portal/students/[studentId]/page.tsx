import { notFound } from "next/navigation";
import { updateStudentAction } from "@/app/portal/actions";
import { StudentForm } from "@/components/student-form";
import { db } from "@/db";
import { getStudent } from "@/db/queries/students";
import { requireFamilyId } from "@/lib/guards";

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const familyId = await requireFamilyId();
  const student = await getStudent(db, familyId, studentId);

  // A student belonging to another family returns null, so this is a 404 —
  // not "forbidden", which would confirm the record exists.
  if (!student) notFound();

  // Binding the ID server-side means the browser never supplies it, so a
  // tampered form cannot retarget the update at another student.
  const action = updateStudentAction.bind(null, student.id);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">
        Edit {student.firstName} {student.lastName}
      </h2>
      <StudentForm
        action={action}
        student={student}
        submitLabel="Save changes"
      />
    </section>
  );
}
