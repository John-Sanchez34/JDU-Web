import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
// `user` is the Better Auth table generated in Step 4; aliased so it does not
// shadow the `user` argument in the hook below.
import { families, user as userTable } from "@/db/schema";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),

  emailAndPassword: {
    enabled: true,
    // Verification is always required outside the E2E suite. The flag is set
    // only by playwright.config.ts, never in .env.
    requireEmailVerification:
      process.env.E2E_SKIP_EMAIL_VERIFICATION !== "true",
    minPasswordLength: 10,
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      if (process.env.E2E_SKIP_EMAIL_VERIFICATION === "true") return;
      await sendEmail({
        to: user.email,
        subject: "Confirm your email address",
        text:
          `Welcome to the studio!\n\n` +
          `Confirm your email address to finish setting up your account:\n${url}\n\n` +
          `If you did not create this account, you can ignore this message.`,
      });
    },
  },

  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "parent",
        // Only an administrator changes roles, never the account holder.
        input: false,
      },
      familyId: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        // Every new parent account gets its own family. Joining an existing
        // family (a second parent) is an invite flow, added in a later phase.
        //
        // This writes to the user table directly rather than going through
        // auth.api.updateUser, which needs a session that does not exist yet
        // during signup.
        after: async (createdUser) => {
          const [family] = await db
            .insert(families)
            .values({ name: createdUser.name || createdUser.email })
            .returning();
          if (!family) {
            throw new Error(`failed to create family for user ${createdUser.id}`);
          }

          await db
            .update(userTable)
            .set({ familyId: family.id })
            .where(eq(userTable.id, createdUser.id));
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
