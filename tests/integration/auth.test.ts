import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { families, user } from "@/db/schema";

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => undefined),
}));

describe("account provisioning", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("defaults a new user to the parent role", async () => {
    const [family] = await db.insert(families).values({ name: "Alvarez" }).returning();
    const [row] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: "Ana Alvarez",
        email: "ana@example.com",
        emailVerified: false,
        familyId: family!.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    expect(row?.role).toBe("parent");
    expect(row?.familyId).toBe(family!.id);
  });

  it("keeps the user when their family is deleted", async () => {
    const [family] = await db.insert(families).values({ name: "Brooks" }).returning();
    const id = crypto.randomUUID();
    await db.insert(user).values({
      id,
      name: "Ben Brooks",
      email: "ben@example.com",
      emailVerified: true,
      familyId: family!.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.delete(families).where(eq(families.id, family!.id));

    const [row] = await db.select().from(user).where(eq(user.id, id));
    expect(row).toBeDefined();
    expect(row?.familyId).toBeNull();
  });
});
