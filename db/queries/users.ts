import { and, eq, isNull } from "drizzle-orm";
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

/**
 * Sets or clears the broadcast opt-out. Returns false when no such account
 * exists.
 *
 * Opting out twice keeps the original timestamp: the fact recorded is when
 * somebody asked to stop receiving studio news, not when they last pressed a
 * button. That is the date you want if a complaint ever has to be answered.
 *
 * Deliberately not family-scoped. The caller is either the account itself
 * through the portal, or an unauthenticated one-click unsubscribe whose only
 * credential is a signed token naming this exact user.
 */
export async function setBroadcastOptOut(
  db: Database,
  userId: string,
  optedOut: boolean,
): Promise<boolean> {
  if (!optedOut) {
    const cleared = await db
      .update(user)
      .set({ broadcastOptedOutAt: null, updatedAt: new Date() })
      .where(eq(user.id, userId))
      .returning({ id: user.id });
    return cleared.length > 0;
  }

  const updated = await db
    .update(user)
    .set({ broadcastOptedOutAt: new Date(), updatedAt: new Date() })
    .where(and(eq(user.id, userId), isNull(user.broadcastOptedOutAt)))
    .returning({ id: user.id });
  if (updated.length > 0) return true;

  // Nothing changed: either they were already opted out, or there is no such
  // account. Only the second is a failure.
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return existing !== undefined;
}

/** One account by id, for reading its own preferences back. */
export async function findUserById(
  db: Database,
  userId: string,
): Promise<{ id: string; broadcastOptedOutAt: Date | null } | null> {
  const [row] = await db
    .select({ id: user.id, broadcastOptedOutAt: user.broadcastOptedOutAt })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row ?? null;
}
