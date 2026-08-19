import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { user } from "@/db/schema";
import type { Role } from "@/lib/roles";

type Database = NodePgDatabase<typeof schema>;

export type RoleAssignment = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/**
 * Sets an account's role, identified by email.
 *
 * Unlike the family-scoped queries in this directory, this one is deliberately
 * global: it is an operator action run from the command line, and the operator
 * is acting on behalf of the studio rather than on behalf of a family. There
 * is no signed-in user to scope it to.
 *
 * Returns null when no account has that email, so the caller can tell "no such
 * user" apart from "role already set".
 */
export async function setUserRole(
  db: Database,
  email: string,
  role: Role,
): Promise<RoleAssignment | null> {
  const [updated] = await db
    .update(user)
    .set({ role, updatedAt: new Date() })
    .where(eq(user.email, email))
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });

  return updated ?? null;
}

/** Looks up an account by email, so a caller can report its current role. */
export async function findUserByEmail(
  db: Database,
  email: string,
): Promise<RoleAssignment | null> {
  const [found] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    })
    .from(user)
    .where(eq(user.email, email));

  return found ?? null;
}
