/**
 * The role vocabulary, in ascending order of privilege.
 *
 * This module is deliberately free of any Next.js or environment imports so
 * that command-line tooling can validate a role without pulling in the web
 * application. `user.role` is a plain text column with no CHECK constraint, so
 * a value that never passes through `isRole` can lock an account out of
 * everything.
 */
export const ROLES = ["parent", "staff", "admin"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
