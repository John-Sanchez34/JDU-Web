import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type * as schema from "@/db/schema";

/**
 * A Drizzle client bound to the pool.
 */
export type Database = NodePgDatabase<typeof schema>;

/**
 * The handle Drizzle passes to a `db.transaction(async (tx) => ...)` callback.
 */
export type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Either of the above. Query functions that may run inside a transaction take
 * this, so a caller can compose them into one atomic unit. Existing query
 * modules declare their own local `Database` alias; leave them alone — only new
 * code needs to be transaction-aware.
 */
export type Executor = Database | Transaction;
