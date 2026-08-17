import { config } from "dotenv";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "@/db/schema";

config({ path: ".env" });

export type TestDb = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let testDb: TestDb | undefined;
let migrated = false;

/**
 * Returns a Drizzle client bound to the test database, running migrations
 * once per process on first use.
 */
export async function getTestDb(): Promise<TestDb> {
  if (testDb) return testDb;

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set — see .env.example");
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL must differ from DATABASE_URL — the harness truncates it",
    );
  }

  pool = new Pool({ connectionString: url });
  testDb = drizzle(pool, { schema });

  if (!migrated) {
    await migrate(testDb, { migrationsFolder: "./drizzle" });
    migrated = true;
  }
  return testDb;
}

/**
 * Empties every application table, leaving the schema and migration history
 * intact. Call this in beforeEach so tests never depend on each other's rows.
 */
export async function resetDatabase(): Promise<void> {
  const database = await getTestDb();
  const result = await database.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> '__drizzle_migrations'
  `);

  const tables = result.rows.map((row) => `"public"."${row.tablename}"`);
  if (tables.length === 0) return;

  await database.execute(
    sql.raw(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`),
  );
}

/** Closes the pool so Vitest can exit cleanly. */
export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  testDb = undefined;
  migrated = false;
}
