import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { students, type Student } from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

export type NewStudentInput = {
  firstName: string;
  lastName: string;
  birthdate: string;
  notes?: string | null;
};

export async function listStudents(
  db: Database,
  familyId: string,
): Promise<Student[]> {
  return db
    .select()
    .from(students)
    .where(eq(students.familyId, familyId))
    .orderBy(asc(students.firstName));
}

export async function getStudent(
  db: Database,
  familyId: string,
  studentId: string,
): Promise<Student | null> {
  const [row] = await db
    .select()
    .from(students)
    .where(and(eq(students.familyId, familyId), eq(students.id, studentId)))
    .limit(1);
  return row ?? null;
}

export async function createStudent(
  db: Database,
  familyId: string,
  input: NewStudentInput,
): Promise<Student> {
  const [row] = await db
    .insert(students)
    .values({ ...input, familyId })
    .returning();
  if (!row) throw new Error("createStudent: insert returned no row");
  return row;
}

export async function updateStudent(
  db: Database,
  familyId: string,
  studentId: string,
  input: Partial<NewStudentInput>,
): Promise<Student | null> {
  const [row] = await db
    .update(students)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(students.familyId, familyId), eq(students.id, studentId)))
    .returning();
  return row ?? null;
}
