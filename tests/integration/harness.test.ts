import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase } from "@/tests/setup/db";

describe("test database harness", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("connects to the test database", async () => {
    const db = await getTestDb();
    const result = await db.execute<{ ok: number }>(sql`SELECT 1 AS ok`);
    expect(result.rows[0]?.ok).toBe(1);
  });

  it("refuses to run against the development database", async () => {
    expect(process.env.TEST_DATABASE_URL).not.toBe(process.env.DATABASE_URL);
  });
});
