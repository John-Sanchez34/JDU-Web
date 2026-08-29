"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestEnrollmentAction } from "@/app/portal/actions";
import { idleState } from "@/lib/action-state";
import type { Student } from "@/db/schema";

export function EnrollmentRequestForm({
  offeringId,
  students,
}: {
  offeringId: string;
  students: Student[];
}) {
  const [state, formAction, pending] = useActionState(
    requestEnrollmentAction,
    idleState,
  );

  if (students.length === 0) {
    return (
      <p className="text-sm text-mirror">
        <Link
          href="/portal/students/new"
          className="font-medium text-maple transition-colors hover:text-chalk"
        >
          Add a student
        </Link>{" "}
        to request a seat in this class.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="offeringId" value={offeringId} />

      <label className="block">
        <span className="label">Student</span>
        <select name="studentId" required className="input">
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.firstName} {student.lastName}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="btn btn-solid disabled:opacity-50"
      >
        {pending ? "Requesting…" : "Request seat"}
      </button>

      {state.error && (
        <p role="alert" className="w-full text-sm font-medium text-alarm">
          {state.error}
        </p>
      )}
    </form>
  );
}
