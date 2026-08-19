import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { families, user } from "@/db/schema";
import { findUserByEmail, setUserRole } from "@/db/queries/users";

async function insertUser(db: TestDb, name: string, email: string): Promise<string> {
  const [family] = await db.insert(families).values({ name }).returning();
  const id = crypto.randomUUID();
  await db.insert(user).values({
    id,
    name,
    email,
    emailVerified: true,
    familyId: family!.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

describe("setUserRole", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("promotes a parent to admin and returns the updated user", async () => {
    await insertUser(db, "Ana Alvarez", "ana@example.com");

    const updated = await setUserRole(db, "ana@example.com", "admin");

    expect(updated?.role).toBe("admin");
    expect(updated?.email).toBe("ana@example.com");
  });

  it("persists the new role", async () => {
    const id = await insertUser(db, "Ben Brooks", "ben@example.com");

    await setUserRole(db, "ben@example.com", "staff");

    const [row] = await db.select().from(user).where(eq(user.id, id));
    expect(row?.role).toBe("staff");
  });

  it("demotes a staff member back to parent", async () => {
    await insertUser(db, "Cara Cruz", "cara@example.com");
    await setUserRole(db, "cara@example.com", "staff");

    const updated = await setUserRole(db, "cara@example.com", "parent");

    expect(updated?.role).toBe("parent");
  });

  it("returns null when no account has that email", async () => {
    const updated = await setUserRole(db, "nobody@example.com", "admin");

    expect(updated).toBeNull();
  });

  it("leaves other accounts untouched", async () => {
    await insertUser(db, "Dana Diaz", "dana@example.com");
    const otherId = await insertUser(db, "Eli Estes", "eli@example.com");

    await setUserRole(db, "dana@example.com", "admin");

    const [row] = await db.select().from(user).where(eq(user.id, otherId));
    expect(row?.role).toBe("parent");
  });
});

describe("findUserByEmail", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("returns the account with that email", async () => {
    await insertUser(db, "Fay Fisher", "fay@example.com");

    const found = await findUserByEmail(db, "fay@example.com");

    expect(found?.email).toBe("fay@example.com");
    expect(found?.role).toBe("parent");
  });

  it("returns null when no account has that email", async () => {
    const found = await findUserByEmail(db, "nobody@example.com");

    expect(found).toBeNull();
  });
});
