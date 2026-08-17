import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { families } from "@/db/schema";
import {
  createStudent,
  getStudent,
  listStudents,
  updateStudent,
} from "@/db/queries/students";

async function seedFamily(db: TestDb, name: string): Promise<string> {
  const [row] = await db.insert(families).values({ name }).returning();
  if (!row) throw new Error("failed to seed family");
  return row.id;
}

describe("student queries", () => {
  let db: TestDb;
  let familyA: string;
  let familyB: string;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
    familyA = await seedFamily(db, "Alvarez");
    familyB = await seedFamily(db, "Brooks");
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("creates a student under the given family", async () => {
    const student = await createStudent(db, familyA, {
      firstName: "Maya",
      lastName: "Alvarez",
      birthdate: "2015-04-12",
    });

    expect(student.familyId).toBe(familyA);
    expect(student.firstName).toBe("Maya");
    expect(student.active).toBe(true);
  });

  it("lists only the requesting family's students", async () => {
    await createStudent(db, familyA, {
      firstName: "Maya",
      lastName: "Alvarez",
      birthdate: "2015-04-12",
    });
    await createStudent(db, familyB, {
      firstName: "Theo",
      lastName: "Brooks",
      birthdate: "2016-09-02",
    });

    const listed = await listStudents(db, familyA);

    expect(listed).toHaveLength(1);
    expect(listed[0]?.firstName).toBe("Maya");
  });

  it("refuses to fetch another family's student by id", async () => {
    const theo = await createStudent(db, familyB, {
      firstName: "Theo",
      lastName: "Brooks",
      birthdate: "2016-09-02",
    });

    expect(await getStudent(db, familyA, theo.id)).toBeNull();
    expect(await getStudent(db, familyB, theo.id)).not.toBeNull();
  });

  it("refuses to update another family's student", async () => {
    const theo = await createStudent(db, familyB, {
      firstName: "Theo",
      lastName: "Brooks",
      birthdate: "2016-09-02",
    });

    const attempted = await updateStudent(db, familyA, theo.id, {
      firstName: "Hacked",
    });

    expect(attempted).toBeNull();
    const untouched = await getStudent(db, familyB, theo.id);
    expect(untouched?.firstName).toBe("Theo");
  });

  it("deletes students when their family is deleted", async () => {
    await createStudent(db, familyA, {
      firstName: "Maya",
      lastName: "Alvarez",
      birthdate: "2015-04-12",
    });

    await db.delete(families);

    expect(await listStudents(db, familyA)).toHaveLength(0);
  });
});
