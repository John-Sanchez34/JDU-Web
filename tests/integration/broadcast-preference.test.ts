import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { setBroadcastOptOut } from "@/db/queries/users";
import { user } from "@/db/schema";

describe("setBroadcastOptOut", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
    await db.insert(user).values({ id: "u1", name: "One", email: "one@example.com" });
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function optedOutAt() {
    const [row] = await db.select().from(user).where(eq(user.id, "u1"));
    return row!.broadcastOptedOutAt;
  }

  it("records when somebody opted out", async () => {
    expect(await setBroadcastOptOut(db, "u1", true)).toBe(true);
    expect(await optedOutAt()).toBeInstanceOf(Date);
  });

  it("is idempotent — opting out twice is not an error", async () => {
    await setBroadcastOptOut(db, "u1", true);
    const first = await optedOutAt();

    expect(await setBroadcastOptOut(db, "u1", true)).toBe(true);
    // The original timestamp stands: the fact recorded is when they asked,
    // not when they last pressed the button.
    expect(await optedOutAt()).toEqual(first);
  });

  it("clears the flag when opting back in", async () => {
    await setBroadcastOptOut(db, "u1", true);
    await setBroadcastOptOut(db, "u1", false);
    expect(await optedOutAt()).toBeNull();
  });

  it("reports an unknown user rather than pretending", async () => {
    expect(await setBroadcastOptOut(db, "nobody", true)).toBe(false);
  });
});
