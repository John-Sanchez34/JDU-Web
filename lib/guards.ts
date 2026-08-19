import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { Role } from "@/lib/roles";

export type { Role };

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  familyId: string | null;
};

const ROLE_RANK: Record<Role, number> = { parent: 0, staff: 1, admin: 2 };

/** True when `actual` meets or exceeds the privilege of `required`. */
export function hasAtLeastRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const raw = session.user as typeof session.user & {
    role?: string | null;
    familyId?: string | null;
  };

  return {
    id: raw.id,
    email: raw.email,
    name: raw.name,
    role: (raw.role as Role | undefined) ?? "parent",
    familyId: raw.familyId ?? null,
  };
}

/** Redirects to sign-in when there is no session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  return user;
}

/**
 * Returns the signed-in user's family ID, which every family-scoped query
 * needs. A parent account without a family is a provisioning bug, not a
 * normal state, so it fails loudly rather than showing an empty portal.
 */
export async function requireFamilyId(): Promise<string> {
  const user = await requireUser();
  if (!user.familyId) {
    throw new Error(`User ${user.id} has no family — account provisioning failed`);
  }
  return user.familyId;
}

export async function requireStaff(): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasAtLeastRole(user.role, "staff")) forbidden();
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasAtLeastRole(user.role, "admin")) forbidden();
  return user;
}
