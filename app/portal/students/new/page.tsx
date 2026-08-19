import { createStudentAction } from "@/app/portal/actions";
import { StudentForm } from "@/components/student-form";

export default function NewStudentPage() {
  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">Add a student</h2>
      <StudentForm action={createStudentAction} submitLabel="Save student" />
    </section>
  );
}
