/**
 * Sets an account's role from the command line.
 *
 *   npm run set-role -- someone@example.com admin
 *
 * This exists because `role` defaults to "parent" for every signup and the
 * application never lets an account change its own role, so the studio's first
 * staff and admin accounts have to be created out of band.
 *
 * All of the logic lives in `db/queries/users.ts` and `lib/roles.ts`, which are
 * covered by tests; this file is argument parsing and reporting.
 */
import { db } from "@/db";
import { findUserByEmail, setUserRole } from "@/db/queries/users";
import { ROLES, isRole } from "@/lib/roles";

function usage(message: string): never {
  console.error(`Error: ${message}`);
  console.error();
  console.error("Usage: npm run set-role -- <email> <role>");
  console.error(`Roles: ${ROLES.join(", ")}`);
  console.error("Example: npm run set-role -- owner@example.com admin");
  process.exit(1);
}

async function main(): Promise<void> {
  const [email, role] = process.argv.slice(2);

  if (!email) usage("an email address is required");
  if (!role) usage("a role is required");
  if (!isRole(role)) usage(`"${role}" is not a valid role`);

  const before = await findUserByEmail(db, email);
  if (!before) usage(`no account found with email "${email}"`);

  if (before.role === role) {
    console.log(`${before.email} is already ${role}. Nothing to do.`);
    process.exit(0);
  }

  const after = await setUserRole(db, email, role);
  if (!after) usage(`no account found with email "${email}"`);

  console.log(`${after.name} <${after.email}>: ${before.role} -> ${after.role}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Failed to set the role:", error);
  process.exit(1);
});
