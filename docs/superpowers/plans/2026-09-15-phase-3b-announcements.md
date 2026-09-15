# Phase 3b — Announcements and Cancellations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the studio post an announcement to the site and mail it to a chosen audience, cancel and restore a dated class occurrence with the roster told either way, and let a family stop receiving studio news without signing in.

**Architecture:** Nothing in Phase 3a's delivery substrate changes. A new `announcements` table carries a draft → published lifecycle with a separate, once-only send whose guard is a conditional `UPDATE ... WHERE emailed_at IS NULL` running *first* inside the send transaction. Audience resolution is a query returning recipients; queueing generalises 3a's `queueEnrollmentEmails` into a `queueDeliveries` that renders per recipient, because each broadcast body carries that recipient's own unsubscribe link. Sending reuses 3a's claim/send/mark path with a paced, bounded batch and a resume button.

**Tech Stack:** Next.js 16.3.1 (App Router, server actions, `after` from `next/server`, route handlers), Drizzle ORM on Postgres, Resend, Zod, `node:crypto` HMAC, Vitest (unit + integration), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-09-15-phase-3b-announcements-design.md`

## Global Constraints

- **No money moves through this site.** No email in this phase may mention a credit, a refund, or a make-up class, because nothing in the system tracks any of those.
- **Every monetary amount is an integer count of cents.** Format with `formatCents` from `@/lib/format` at the display boundary only. Nothing in this phase does arithmetic on money.
- **Broadcast mail carries an unsubscribe link and honours `user.broadcast_opted_out_at`. Transactional mail carries neither.** Announcements are broadcast. Enrollment mail and cancellation mail are transactional.
- **The opt-out happens on POST, never on GET.** Mail scanners and link prefetchers follow every GET in a message.
- **No scheduled jobs.** Nothing sweeps on a timer; a person presses a button.
- **Query functions that may run inside a transaction take `Executor`** (`@/db/queries/executor`), not `Database`. Existing query modules declare their own local `Database` alias; leave those alone.
- **A `"use server"` module may only export async functions.** Shared constants and types live in a plain module and are imported.
- **`lib/env.ts` is server-only.** Importing it from client code leaks secrets into the browser bundle.
- **A status transition is a conditional UPDATE whose affected-row count is the decision** — never a read followed by a write.
- Tests run against `TEST_DATABASE_URL`, which the harness truncates. It must differ from `DATABASE_URL`.
- Run the full sweep before any commit that ends a task: `npm test && npm run typecheck && npm run build`.

## File structure

| File | Responsibility |
|---|---|
| `db/schema/announcements.ts` | The table, its two enums, its index and its audience check |
| `db/schema/auth.ts` (modify) | `broadcast_opted_out_at` on `user` |
| `lib/unsubscribe-token.ts` | Sign and verify an opt-out token; build the two URLs |
| `lib/dates.ts` (modify) | `formatIsoDate` for a full date in email copy |
| `lib/emails/layout.ts` (modify) | `RenderedEmail`, paragraph splitting, the broadcast shell and footer |
| `lib/emails/announcement.ts` | Pure render of `announcement.posted` |
| `lib/emails/class-occurrence.ts` | Pure render of `class.cancelled` and `class.restored` |
| `db/queries/audience.ts` | Who receives an announcement; who receives a cancellation |
| `db/queries/announcements.ts` | Draft, publish, send, and the three read paths |
| `db/queries/email-deliveries.ts` (modify) | Generic queueing, releasing a claim, per-source reads |
| `db/queries/class-occurrences.ts` (modify) | Cancel and restore, with their deliveries |
| `db/queries/users.ts` (modify) | Set and clear the broadcast opt-out |
| `lib/email.ts` (modify) | Typed send error carrying the provider status; `headers` passthrough |
| `lib/notifications/deliver.ts` (modify) | Pacing, rate-limit backoff, and the per-source batch |
| `lib/announcement-validation.ts` | Zod schemas for the announcement forms |
| `app/admin/announcements/actions.ts` | Create, edit, publish, send, resume |
| `app/admin/announcements/page.tsx` | The list and the New link |
| `app/admin/announcements/new/page.tsx` | The draft form |
| `app/admin/announcements/[announcementId]/page.tsx` | Edit, publish, send, and the delivery view |
| `app/admin/actions.ts` (modify) | Cancel and restore an occurrence |
| `app/admin/classes/[offeringId]/page.tsx` (modify) | Upcoming occurrences with Cancel / Restore |
| `app/(public)/announcements/page.tsx` | Public list — `all` audience only |
| `app/portal/announcements/page.tsx` | What this family is addressed by |
| `app/portal/preferences/page.tsx` | The opt-back-in toggle |
| `app/portal/actions.ts` (modify) | `setBroadcastPreferenceAction` |
| `app/unsubscribe/page.tsx` | The confirmation page the footer link lands on |
| `app/api/unsubscribe/route.ts` | The POST that actually opts out; RFC 8058 one-click |
| `components/announcement-form.tsx` | Client form for create and edit |
| `components/announcement-send-panel.tsx` | Publish / Send / Send the rest |
| `components/cancel-occurrence-form.tsx` | Cancel with a reason, and Restore |
| `components/broadcast-preference-form.tsx` | The portal toggle |

---

### Task 1: The schema

**Files:**
- Create: `db/schema/announcements.ts`
- Modify: `db/schema/index.ts`
- Modify: `db/schema/auth.ts`
- Create: `drizzle/0006_*.sql` (generated)
- Test: `tests/integration/announcements-schema.test.ts`

**Interfaces:**
- Produces: `announcements` table; `announcementAudienceEnum`, `announcementStatusEnum`; types `Announcement`, `AnnouncementAudience`, `AnnouncementStatus`; `user.broadcastOptedOutAt`.

- [ ] **Step 1: Write the schema module**

Create `db/schema/announcements.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { classOfferings } from "./class-offerings";

export const announcementAudienceEnum = pgEnum("announcement_audience", [
  "all",
  "class_offering",
]);

export type AnnouncementAudience = (typeof announcementAudienceEnum.enumValues)[number];

export const announcementStatusEnum = pgEnum("announcement_status", [
  "draft",
  "published",
]);

export type AnnouncementStatus = (typeof announcementStatusEnum.enumValues)[number];

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    /*
     * Plain text, not markdown. Blank lines separate paragraphs; the text is
     * escaped and wrapped at render time, in both the email and the page. A
     * markdown dependency would buy formatting nobody asked for and bring an
     * HTML sanitisation problem with it.
     */
    body: text("body").notNull(),
    audienceType: announcementAudienceEnum("audience_type").notNull(),
    /*
     * Cascade rather than set null: an announcement addressed to a class that
     * no longer exists has no audience, and a row claiming to target a class
     * while pointing at nothing would fail its own check constraint.
     */
    classOfferingId: uuid("class_offering_id").references(() => classOfferings.id, {
      onDelete: "cascade",
    }),
    status: announcementStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /*
     * Set when the fan-out is *queued*, not when it is sent. What must happen
     * exactly once is the queueing; sending is already exactly-once per row.
     */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    // text, not uuid: user.id is Better Auth's generated text id. "set null"
    // so deleting a staff account never destroys what they posted.
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The public list reads published rows newest first.
    index("announcements_status_published_at_idx").on(table.status, table.publishedAt),
    /*
     * The two audience columns only make sense in pairs. Enforced here rather
     * than in application code so a bad row cannot exist at all.
     */
    check(
      "announcements_audience_pairing",
      sql`(${table.audienceType} = 'all' AND ${table.classOfferingId} IS NULL)
          OR (${table.audienceType} = 'class_offering' AND ${table.classOfferingId} IS NOT NULL)`,
    ),
  ],
);

export type Announcement = typeof announcements.$inferSelect;
```

- [ ] **Step 2: Add the opt-out column**

In `db/schema/auth.ts`, add one field to the `user` table, directly after `familyId`:

```ts
  familyId: uuid("family_id").references(() => families.id, { onDelete: "set null" }),
  /*
   * Null means subscribed. A timestamp rather than a boolean because the fact
   * worth keeping is *when* somebody opted out — the question asked if a spam
   * complaint ever arrives. Timezone-aware unlike the Better Auth columns
   * above: this one is ours, and every application timestamp in this schema
   * carries a zone.
   */
  broadcastOptedOutAt: timestamp("broadcast_opted_out_at", { withTimezone: true }),
```

- [ ] **Step 3: Re-export the new module**

Append to `db/schema/index.ts`:

```ts
export * from "./announcements";
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0006_*.sql` creating both enums, the `announcements` table with its check and index, and adding `broadcast_opted_out_at` to `user`. Read the file before continuing — if it drops or renames anything, stop and work out why.

- [ ] **Step 5: Apply the migration**

Run: `npm run db:migrate`
Expected: it reports one migration applied against the development database.

- [ ] **Step 6: Write the constraint tests**

Create `tests/integration/announcements-schema.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import { isCheckViolation } from "@/db/queries/enrollments";
import { announcements, user } from "@/db/schema";

describe("announcements schema", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("defaults a new announcement to an unpublished, unsent draft", async () => {
    const [row] = await db
      .insert(announcements)
      .values({ title: "Snow day", body: "The studio is closed.", audienceType: "all" })
      .returning();

    expect(row!.status).toBe("draft");
    expect(row!.publishedAt).toBeNull();
    expect(row!.emailedAt).toBeNull();
    expect(row!.classOfferingId).toBeNull();
  });

  it("refuses an 'all' announcement that names a class", async () => {
    const { offering } = await seedTwoFamilies(db, 5);

    const insert = db.insert(announcements).values({
      title: "Snow day",
      body: "The studio is closed.",
      audienceType: "all",
      classOfferingId: offering.id,
    });

    await expect(insert).rejects.toSatisfy(isCheckViolation);
  });

  it("refuses a class announcement that names no class", async () => {
    const insert = db.insert(announcements).values({
      title: "Ballet I is moving rooms",
      body: "We are in Studio B from Monday.",
      audienceType: "class_offering",
    });

    await expect(insert).rejects.toSatisfy(isCheckViolation);
  });

  it("accepts a class announcement that names its class", async () => {
    const { offering } = await seedTwoFamilies(db, 5);

    const [row] = await db
      .insert(announcements)
      .values({
        title: "Ballet I is moving rooms",
        body: "We are in Studio B from Monday.",
        audienceType: "class_offering",
        classOfferingId: offering.id,
      })
      .returning();

    expect(row!.classOfferingId).toBe(offering.id);
  });

  it("starts every login subscribed to broadcast mail", async () => {
    await db.insert(user).values({ id: "user-1", name: "One", email: "one@example.com" });

    const [row] = await db.select().from(user).where(eq(user.id, "user-1"));
    expect(row!.broadcastOptedOutAt).toBeNull();
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/integration/announcements-schema.test.ts`
Expected: 5 passed. The test database migrates itself on first use, so no separate migrate step is needed here.

- [ ] **Step 8: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add db/schema drizzle tests/integration/announcements-schema.test.ts
git commit -m "feat: add the announcements schema and the broadcast opt-out"
```

---

### Task 2: The unsubscribe token

**Files:**
- Create: `lib/unsubscribe-token.ts`
- Test: `tests/unit/unsubscribe-token.test.ts`

**Interfaces:**
- Produces: `signUnsubscribeToken(userId: string): string`; `verifyUnsubscribeToken(token: string): string | null`; `unsubscribeUrl(userId: string): string`; `unsubscribePostUrl(userId: string): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/unsubscribe-token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  signUnsubscribeToken,
  unsubscribePostUrl,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from "@/lib/unsubscribe-token";

describe("unsubscribe tokens", () => {
  it("round-trips a user id", () => {
    const token = signUnsubscribeToken("user-abc");
    expect(verifyUnsubscribeToken(token)).toBe("user-abc");
  });

  it("rejects a token whose signature was altered", () => {
    const token = signUnsubscribeToken("user-abc");
    const [id, signature] = token.split(".");
    const flipped = signature!.startsWith("A") ? `B${signature!.slice(1)}` : `A${signature!.slice(1)}`;
    expect(verifyUnsubscribeToken(`${id}.${flipped}`)).toBeNull();
  });

  it("rejects a token whose user id was swapped for someone else's", () => {
    const mine = signUnsubscribeToken("user-abc");
    const theirs = signUnsubscribeToken("user-xyz");
    const forged = `${theirs.split(".")[0]}.${mine.split(".")[1]}`;
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it("rejects malformed tokens rather than throwing", () => {
    for (const bad of ["", ".", "nodot", "a.b.c", "user-abc."]) {
      expect(verifyUnsubscribeToken(bad)).toBeNull();
    }
  });

  it("rejects a truncated signature", () => {
    const token = signUnsubscribeToken("user-abc");
    const [id, signature] = token.split(".");
    expect(verifyUnsubscribeToken(`${id}.${signature!.slice(0, -4)}`)).toBeNull();
  });

  it("builds a page URL and a one-click POST URL carrying the same token", () => {
    const page = new URL(unsubscribeUrl("user-abc"));
    const post = new URL(unsubscribePostUrl("user-abc"));

    expect(page.pathname).toBe("/unsubscribe");
    expect(post.pathname).toBe("/api/unsubscribe");
    expect(verifyUnsubscribeToken(page.searchParams.get("u")!)).toBe("user-abc");
    expect(verifyUnsubscribeToken(post.searchParams.get("u")!)).toBe("user-abc");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/unsubscribe-token.test.ts`
Expected: FAIL — cannot resolve `@/lib/unsubscribe-token`.

- [ ] **Step 3: Write the implementation**

Create `lib/unsubscribe-token.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/*
 * An opt-out token is an HMAC of the user id, not a stored secret. There is no
 * table to write, nothing to expire, and nothing to clean up when an account is
 * deleted — and because the secret is the one already signing sessions, a
 * rotated secret invalidates outstanding links, which for an unsubscribe link
 * is a fair trade for having no state at all.
 *
 * Server-only: `lib/env.ts` must never reach the browser bundle.
 */
function digest(userId: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(userId).digest("base64url");
}

export function signUnsubscribeToken(userId: string): string {
  const encodedId = Buffer.from(userId, "utf8").toString("base64url");
  return `${encodedId}.${digest(userId)}`;
}

/**
 * Returns the user id a token vouches for, or null.
 *
 * Every rejection returns null rather than throwing: this runs on an endpoint
 * anyone can POST to, and a thrown error there is a 500 that tells a prober
 * their input was interesting.
 */
export function verifyUnsubscribeToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedId, signature] = parts;
  if (!encodedId || !signature) return null;

  const userId = Buffer.from(encodedId, "base64url").toString("utf8");
  if (!userId) return null;

  const expected = Buffer.from(digest(userId), "utf8");
  const actual = Buffer.from(signature, "utf8");
  // timingSafeEqual throws on a length mismatch, so the length is checked
  // first — and a wrong length is already a wrong signature.
  if (expected.length !== actual.length) return null;

  return timingSafeEqual(expected, actual) ? userId : null;
}

/** Where the footer link in a broadcast email points: a page, never an action. */
export function unsubscribeUrl(userId: string): string {
  return `${env.BETTER_AUTH_URL}/unsubscribe?u=${signUnsubscribeToken(userId)}`;
}

/** Where `List-Unsubscribe-Post` points: the endpoint that actually opts out. */
export function unsubscribePostUrl(userId: string): string {
  return `${env.BETTER_AUTH_URL}/api/unsubscribe?u=${signUnsubscribeToken(userId)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/unsubscribe-token.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add lib/unsubscribe-token.ts tests/unit/unsubscribe-token.test.ts
git commit -m "feat: add signed unsubscribe tokens"
```

---

### Task 3: The three new templates

**Files:**
- Modify: `lib/dates.ts`
- Modify: `lib/emails/layout.ts`
- Modify: `lib/emails/enrollment.ts`
- Create: `lib/emails/announcement.ts`
- Create: `lib/emails/class-occurrence.ts`
- Test: `tests/unit/broadcast-emails.test.ts`

**Interfaces:**
- Consumes: `unsubscribeUrl` (Task 2) — only at the call site, not inside these renders.
- Produces: `formatIsoDate(iso: string): string`; `toParagraphs(body: string): string[]`; `wrapBroadcastHtml(heading, paragraphs, unsubscribeUrl): string`; `broadcastTextFooter(unsubscribeUrl): string`; `RenderedEmail` (moved to `layout.ts`); `renderAnnouncementEmail(data: AnnouncementEmailData): RenderedEmail`; `ANNOUNCEMENT_TEMPLATE`; `renderClassOccurrenceEmail(template: ClassOccurrenceEmailTemplate, data: ClassOccurrenceEmailData): RenderedEmail`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/broadcast-emails.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderAnnouncementEmail } from "@/lib/emails/announcement";
import { renderClassOccurrenceEmail } from "@/lib/emails/class-occurrence";
import { toParagraphs } from "@/lib/emails/layout";

const UNSUB = "https://studio.example/unsubscribe?u=token";

const occurrence = {
  className: "Ballet I",
  date: "2026-10-12",
  dayOfWeek: "monday" as const,
  startTime: "16:00:00",
  endTime: "17:00:00",
  reason: "The instructor is unwell.",
};

describe("toParagraphs", () => {
  it("splits on blank lines and drops empty ones", () => {
    expect(toParagraphs("One.\n\nTwo.\n\n\n  \n\nThree.")).toEqual(["One.", "Two.", "Three."]);
  });

  it("keeps a single newline inside one paragraph", () => {
    expect(toParagraphs("Line one\nline two")).toEqual(["Line one\nline two"]);
  });
});

describe("renderAnnouncementEmail", () => {
  it("uses the title as the subject and renders the body as paragraphs", () => {
    const rendered = renderAnnouncementEmail({
      title: "Recital tickets",
      body: "Tickets are available at the desk.\n\nBring exact change.",
      unsubscribeUrl: UNSUB,
    });

    expect(rendered.subject).toBe("Recital tickets");
    expect(rendered.text).toContain("Tickets are available at the desk.");
    expect(rendered.text).toContain("Bring exact change.");
    expect(rendered.html).toContain("<p style=");
  });

  it("carries the unsubscribe link in both parts", () => {
    const rendered = renderAnnouncementEmail({
      title: "Recital tickets",
      body: "Tickets are available at the desk.",
      unsubscribeUrl: UNSUB,
    });

    expect(rendered.text).toContain(UNSUB);
    expect(rendered.html).toContain(`href="${UNSUB}"`);
  });

  it("renders a script tag in the body inert", () => {
    const rendered = renderAnnouncementEmail({
      title: "Hi <script>alert(1)</script>",
      body: "Careful: <script>alert(2)</script> & co.",
      unsubscribeUrl: UNSUB,
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("&amp; co.");
  });
});

describe("renderClassOccurrenceEmail", () => {
  it("names the class, the date and the reason when cancelling", () => {
    const rendered = renderClassOccurrenceEmail("class.cancelled", occurrence);

    expect(rendered.subject).toContain("Ballet I");
    expect(rendered.text).toContain("Monday, 12 October 2026");
    expect(rendered.text).toContain("The instructor is unwell.");
  });

  it("says the class is back on when restoring", () => {
    const rendered = renderClassOccurrenceEmail("class.restored", {
      ...occurrence,
      reason: null,
    });

    expect(rendered.text).toContain("Ballet I");
    expect(rendered.text).toContain("Monday, 12 October 2026");
    expect(rendered.text.toLowerCase()).toContain("going ahead");
  });

  it("carries no unsubscribe link — a cancellation is transactional", () => {
    for (const template of ["class.cancelled", "class.restored"] as const) {
      const rendered = renderClassOccurrenceEmail(template, occurrence);
      expect(rendered.text.toLowerCase()).not.toContain("unsubscribe");
      expect(rendered.html.toLowerCase()).not.toContain("unsubscribe");
    }
  });

  it("mentions no money, because nothing here tracks any", () => {
    for (const template of ["class.cancelled", "class.restored"] as const) {
      const rendered = renderClassOccurrenceEmail(template, occurrence);
      for (const word of ["$", "refund", "credit", "make-up", "makeup"]) {
        expect(rendered.text.toLowerCase()).not.toContain(word);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/broadcast-emails.test.ts`
Expected: FAIL — cannot resolve `@/lib/emails/announcement`.

- [ ] **Step 3: Add the date formatter**

Append to `lib/dates.ts`:

```ts
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * "2026-10-12" becomes "Monday, 12 October 2026".
 *
 * Formatted in UTC so it agrees with `todayIso` and with the `date` columns,
 * which are calendar dates with no zone of their own — reading one in local
 * time is how a Monday class becomes a Sunday class for anyone west of here.
 */
export function formatIsoDate(iso: string): string {
  return DATE_FORMAT.format(new Date(`${iso}T00:00:00Z`));
}
```

- [ ] **Step 4: Extend the layout**

In `lib/emails/layout.ts`, add the shared result type, paragraph splitting, and the broadcast shell. Put `RenderedEmail` here because three template modules now share it:

```ts
export type RenderedEmail = { subject: string; text: string; html: string };

/**
 * Splits a plain-text body into paragraphs on blank lines.
 *
 * A single newline stays inside its paragraph — the studio owner writing an
 * address or a list of times means those lines to stay together.
 */
export function toParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/** Escaped text with its single newlines turned into line breaks. */
export function escapeParagraph(paragraph: string): string {
  return escapeHtml(paragraph).replaceAll("\n", "<br />");
}

const UNSUB_NOTE =
  "You are receiving this because your family is enrolled at Jodi&rsquo;s Dance Unlimited.";

/**
 * The broadcast shell: the transactional one plus a footer.
 *
 * Only broadcast mail gets this. A family cannot opt out of being told what
 * happened to their own request or their own class, so a transactional
 * `wrapHtml` call must never pass a footer.
 */
export function wrapBroadcastHtml(
  heading: string,
  paragraphs: string[],
  unsubscribeUrl: string,
): string {
  const footer = [
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e1dc;font-size:12px;line-height:1.5;color:#6f6a63;">`,
    UNSUB_NOTE,
    ` <a href="${unsubscribeUrl}" style="color:#b57a33;">Unsubscribe from studio news</a>.`,
    `</p>`,
  ].join("");

  return wrapHtml(heading, paragraphs, footer);
}
```

This needs one change to the existing `wrapHtml`: a third, optional argument,
appended inside the card. Take the footer as a parameter rather than splicing it
into the returned string afterwards — a `.replace` on the closing tags would
depend on markup this function is free to change.

```ts
export function wrapHtml(
  heading: string,
  paragraphs: string[],
  footerHtml = "",
): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;">${p}</p>`)
    .join("");

  return [
    `<div style="background:#f6f5f3;padding:24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#14161a;">`,
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e1dc;padding:32px;">`,
    `<p style="margin:0 0 24px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#b57a33;">${STUDIO}</p>`,
    `<h1 style="margin:0 0 20px;font-size:20px;">${heading}</h1>`,
    body,
    footerHtml,
    `</div></div>`,
  ].join("");
}

/** The same footer for the text part. */
export function broadcastTextFooter(unsubscribeUrl: string): string {
  return [
    "--",
    "You are receiving this because your family is enrolled at Jodi's Dance Unlimited.",
    `Unsubscribe from studio news: ${unsubscribeUrl}`,
  ].join("\n");
}
```

Then in `lib/emails/enrollment.ts`, delete its local `RenderedEmail` declaration and take it from the layout instead, so there is one definition:

```ts
import { escapeHtml, wrapHtml, type RenderedEmail } from "./layout";

export type { RenderedEmail };
```

- [ ] **Step 5: Write the announcement template**

Create `lib/emails/announcement.ts`:

```ts
import {
  broadcastTextFooter,
  escapeHtml,
  escapeParagraph,
  toParagraphs,
  wrapBroadcastHtml,
  type RenderedEmail,
} from "./layout";

/** The one template this phase's announcements use. */
export const ANNOUNCEMENT_TEMPLATE = "announcement.posted";

export type AnnouncementEmailData = {
  title: string;
  body: string;
  /** This recipient's own link — which is why rendering happens per row. */
  unsubscribeUrl: string;
};

/**
 * Renders one announcement. Pure: no database, no clock, no environment.
 *
 * The title becomes the subject verbatim. Staff wrote it for a person to read
 * in their inbox, and inventing a prefix around it would only make the studio
 * sound like a mailing list.
 */
export function renderAnnouncementEmail(data: AnnouncementEmailData): RenderedEmail {
  const paragraphs = toParagraphs(data.body);

  return {
    subject: data.title,
    text: [data.title, "", paragraphs.join("\n\n"), "", broadcastTextFooter(data.unsubscribeUrl)]
      .join("\n")
      .concat("\n"),
    html: wrapBroadcastHtml(
      escapeHtml(data.title),
      paragraphs.map(escapeParagraph),
      data.unsubscribeUrl,
    ),
  };
}
```

- [ ] **Step 6: Write the cancellation templates**

Create `lib/emails/class-occurrence.ts`:

```ts
import type { DayOfWeek } from "@/db/schema";
import { formatIsoDate } from "@/lib/dates";
import { formatTimeRange } from "@/lib/format";
import { escapeHtml, wrapHtml, type RenderedEmail } from "./layout";

export type ClassOccurrenceEmailTemplate = "class.cancelled" | "class.restored";

export type ClassOccurrenceEmailData = {
  className: string;
  /** The occurrence's calendar date, YYYY-MM-DD. */
  date: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  /** Staff's reason for cancelling. Null on a restoration. */
  reason: string | null;
};

/** "Monday, 12 October 2026, 4:00 PM – 5:00 PM" */
function whenLine(data: ClassOccurrenceEmailData): string {
  return `${formatIsoDate(data.date)}, ${formatTimeRange(data.startTime, data.endTime)}`;
}

/*
 * Both messages are transactional: they carry no unsubscribe link and reach
 * every family on the roster regardless of the broadcast preference. A family
 * cannot opt out of being told their own class is not happening.
 *
 * Neither mentions money. The studio takes payment in person and this system
 * tracks no balances, so it is in no position to promise a credit or a
 * make-up class — that conversation happens at the desk.
 */
function body(
  template: ClassOccurrenceEmailTemplate,
  data: ClassOccurrenceEmailData,
): { heading: string; subject: string; paragraphs: string[] } {
  switch (template) {
    case "class.cancelled":
      return {
        subject: `${data.className} is cancelled on ${formatIsoDate(data.date)}`,
        heading: "One class is cancelled",
        paragraphs: [
          `${data.className} on ${whenLine(data)} will not take place.`,
          ...(data.reason ? [data.reason] : []),
          "Every other week runs as normal. If you have a question, call the studio and we will sort it out.",
        ],
      };
    case "class.restored":
      return {
        subject: `${data.className} is going ahead on ${formatIsoDate(data.date)}`,
        heading: "That class is back on",
        paragraphs: [
          `We told you ${data.className} on ${whenLine(data)} was cancelled. It is going ahead after all.`,
          "Sorry for the confusion — please come as usual.",
        ],
      };
  }
}

/** Renders one occurrence email. Pure, like the enrollment templates. */
export function renderClassOccurrenceEmail(
  template: ClassOccurrenceEmailTemplate,
  data: ClassOccurrenceEmailData,
): RenderedEmail {
  const { heading, subject, paragraphs } = body(template, data);

  return {
    subject,
    text: `${heading}\n\n${paragraphs.join("\n\n")}\n`,
    html: wrapHtml(escapeHtml(heading), paragraphs.map(escapeHtml)),
  };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/broadcast-emails.test.ts tests/unit/enrollment-emails.test.ts`
Expected: all pass. The enrollment suite is included because `RenderedEmail` moved — if it still passes, nothing downstream noticed.

- [ ] **Step 8: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add lib/dates.ts lib/emails tests/unit/broadcast-emails.test.ts
git commit -m "feat: render announcements and class cancellations"
```

---

### Task 4: Audience resolution

**Files:**
- Create: `db/queries/audience.ts`
- Test: `tests/integration/audience.test.ts`

**Interfaces:**
- Produces: `type Recipient = { userId: string; email: string }`; `audienceSeasonId(exec: Executor, today: string): Promise<string | null>`; `resolveAnnouncementAudience(exec, input: { audienceType: AnnouncementAudience; classOfferingId: string | null }, today: string): Promise<Recipient[]>`; `resolveOccurrenceAudience(exec, occurrenceId: string): Promise<Recipient[]>`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/audience.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import {
  audienceSeasonId,
  resolveAnnouncementAudience,
  resolveOccurrenceAudience,
} from "@/db/queries/audience";
import { requestEnrollment } from "@/db/queries/enrollments";
import { syncOccurrencesForOffering } from "@/db/queries/class-occurrences";
import { classOccurrences, classOfferings, user } from "@/db/schema";

const TODAY = "2026-10-01";

describe("audience resolution", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function addLogin(id: string, email: string, familyId: string) {
    await db.insert(user).values({ id, name: id, email, familyId });
  }

  async function request(familyId: string, studentId: string, offeringId: string) {
    const result = await requestEnrollment(db, familyId, {
      studentId,
      offeringId,
      actorUserId: null,
    });
    if (!result.ok) throw new Error(`expected the request to succeed, got ${result.reason}`);
    return result.enrollment;
  }

  it("addresses every parent login on a currently enrolled family", async () => {
    const seeded = await seedTwoFamilies(db, 5);
    await addLogin("a1", "a1@example.com", seeded.familyA.id);
    await addLogin("a2", "a2@example.com", seeded.familyA.id);
    await addLogin("b1", "b1@example.com", seeded.familyB.id);
    await request(seeded.familyA.id, seeded.studentA.id, seeded.offering.id);

    const recipients = await resolveAnnouncementAudience(
      db,
      { audienceType: "all", classOfferingId: null },
      TODAY,
    );

    expect(recipients.map((r) => r.email)).toEqual(["a1@example.com", "a2@example.com"]);
  });

  it("excludes a login that opted out of broadcast mail", async () => {
    const seeded = await seedTwoFamilies(db, 5);
    await addLogin("a1", "a1@example.com", seeded.familyA.id);
    await addLogin("a2", "a2@example.com", seeded.familyA.id);
    await db
      .update(user)
      .set({ broadcastOptedOutAt: new Date() })
      .where(eq(user.id, "a2"));
    await request(seeded.familyA.id, seeded.studentA.id, seeded.offering.id);

    const recipients = await resolveAnnouncementAudience(
      db,
      { audienceType: "all", classOfferingId: null },
      TODAY,
    );

    expect(recipients.map((r) => r.email)).toEqual(["a1@example.com"]);
  });

  it("addresses a login once however many seats their family holds", async () => {
    const seeded = await seedTwoFamilies(db, 5);
    await addLogin("a1", "a1@example.com", seeded.familyA.id);
    const [second] = await db
      .insert(classOfferings)
      .values({
        seasonId: seeded.offering.seasonId,
        name: "Tap I",
        dayOfWeek: "tuesday",
        startTime: "16:00:00",
        endTime: "17:00:00",
        capacity: 5,
        monthlyPriceCents: 8500,
        published: true,
      })
      .returning();
    await request(seeded.familyA.id, seeded.studentA.id, seeded.offering.id);
    await request(seeded.familyA.id, seeded.studentA.id, second!.id);

    const recipients = await resolveAnnouncementAudience(
      db,
      { audienceType: "all", classOfferingId: null },
      TODAY,
    );

    expect(recipients).toHaveLength(1);
  });

  it("narrows to one class when the audience is that class", async () => {
    const seeded = await seedTwoFamilies(db, 5);
    await addLogin("a1", "a1@example.com", seeded.familyA.id);
    await addLogin("b1", "b1@example.com", seeded.familyB.id);
    /*
     * Family B must hold a live seat of its own, in a DIFFERENT class.
     * Without that, b1 would be absent from the result whether or not the
     * class predicate did anything at all — the test would pass against a
     * query that ignored `classOfferingId` entirely, which is exactly the
     * bug it is supposed to catch.
     */
    const [other] = await db
      .insert(classOfferings)
      .values({
        seasonId: seeded.offering.seasonId,
        name: "Jazz I",
        dayOfWeek: "wednesday",
        startTime: "17:00:00",
        endTime: "18:00:00",
        capacity: 5,
        monthlyPriceCents: 8500,
        published: true,
      })
      .returning();
    await request(seeded.familyA.id, seeded.studentA.id, seeded.offering.id);
    await request(seeded.familyB.id, seeded.studentB.id, other!.id);

    // Both families are in the season, so "everyone" reaches both …
    const everyone = await resolveAnnouncementAudience(
      db,
      { audienceType: "all", classOfferingId: null },
      TODAY,
    );
    expect(everyone.map((r) => r.email)).toEqual(["a1@example.com", "b1@example.com"]);

    // … and naming one class cuts it to that class's family.
    const recipients = await resolveAnnouncementAudience(
      db,
      { audienceType: "class_offering", classOfferingId: seeded.offering.id },
      TODAY,
    );

    expect(recipients.map((r) => r.email)).toEqual(["a1@example.com"]);
  });

  it("falls back to the most recent season when none contains today", async () => {
    const seeded = await seedTwoFamilies(db, 5);
    await addLogin("a1", "a1@example.com", seeded.familyA.id);
    await request(seeded.familyA.id, seeded.studentA.id, seeded.offering.id);

    // The seeded season is 2026-09-01 to 2026-12-18; ask from the following July.
    const seasonId = await audienceSeasonId(db, "2027-07-04");
    expect(seasonId).not.toBeNull();

    const recipients = await resolveAnnouncementAudience(
      db,
      { audienceType: "all", classOfferingId: null },
      "2027-07-04",
    );
    expect(recipients.map((r) => r.email)).toEqual(["a1@example.com"]);
  });

  it("reaches an opted-out login when the class is cancelled", async () => {
    const seeded = await seedTwoFamilies(db, 5);
    await addLogin("a1", "a1@example.com", seeded.familyA.id);
    await db
      .update(user)
      .set({ broadcastOptedOutAt: new Date() })
      .where(eq(user.id, "a1"));
    await request(seeded.familyA.id, seeded.studentA.id, seeded.offering.id);
    await syncOccurrencesForOffering(db, seeded.offering.id);
    const [occurrence] = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.classOfferingId, seeded.offering.id))
      .limit(1);

    const recipients = await resolveOccurrenceAudience(db, occurrence!.id);

    expect(recipients.map((r) => r.email)).toEqual(["a1@example.com"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/audience.test.ts`
Expected: FAIL — cannot resolve `@/db/queries/audience`.

- [ ] **Step 3: Write the implementation**

Create `db/queries/audience.ts`:

```ts
import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import {
  classOccurrences,
  classOfferings,
  enrollments,
  seasons,
  students,
  user,
  type AnnouncementAudience,
} from "@/db/schema";
import type { Executor } from "./executor";

/** One addressee. The id is needed for the delivery row and the opt-out link. */
export type Recipient = { userId: string; email: string };

/** A seat that means the family is currently part of the studio. */
const LIVE_STATUSES = ["pending", "active"] as const;

/**
 * Which season "everyone" means.
 *
 * The season containing today, or — when none does — the most recently started
 * one. Without that fallback a July announcement about autumn registration
 * would resolve to nobody, because between seasons no season contains today.
 *
 * Deliberately not `getCurrentSeason` from `./seasons`: that takes a
 * `Database` and has no fallback, and both matter here.
 */
export async function audienceSeasonId(
  exec: Executor,
  today: string,
): Promise<string | null> {
  const [current] = await exec
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(lte(seasons.startDate, today), gte(seasons.endDate, today)))
    .orderBy(desc(seasons.startDate))
    .limit(1);
  if (current) return current.id;

  const [recent] = await exec
    .select({ id: seasons.id })
    .from(seasons)
    .where(lte(seasons.startDate, today))
    .orderBy(desc(seasons.startDate))
    .limit(1);
  return recent?.id ?? null;
}

/**
 * Who receives one announcement.
 *
 * Distinct by login, not by family: a family holding three seats is one
 * recipient per parent, not three. The opt-out is filtered in SQL alongside
 * everything else, so a caller cannot forget it.
 */
export async function resolveAnnouncementAudience(
  exec: Executor,
  input: { audienceType: AnnouncementAudience; classOfferingId: string | null },
  today: string,
): Promise<Recipient[]> {
  const scope =
    input.audienceType === "class_offering"
      ? input.classOfferingId
        ? eq(enrollments.classOfferingId, input.classOfferingId)
        : null
      : await (async () => {
          const seasonId = await audienceSeasonId(exec, today);
          return seasonId ? eq(classOfferings.seasonId, seasonId) : null;
        })();

  // No season and no class means no audience — not an error, just nobody.
  if (!scope) return [];

  return exec
    .selectDistinct({ userId: user.id, email: user.email })
    .from(user)
    .innerJoin(students, eq(students.familyId, user.familyId))
    .innerJoin(enrollments, eq(enrollments.studentId, students.id))
    .innerJoin(classOfferings, eq(classOfferings.id, enrollments.classOfferingId))
    .where(
      and(
        inArray(enrollments.status, LIVE_STATUSES),
        // Broadcast honours the preference. Cancellations below do not.
        isNull(user.broadcastOptedOutAt),
        scope,
      ),
    )
    .orderBy(asc(user.email));
}

/**
 * Who receives a cancellation or a restoration: the roster of the class that
 * occurrence belongs to.
 *
 * No opt-out filter, on purpose. This is transactional mail, and a family
 * cannot decline to be told that their own class is not happening.
 */
export async function resolveOccurrenceAudience(
  exec: Executor,
  occurrenceId: string,
): Promise<Recipient[]> {
  return exec
    .selectDistinct({ userId: user.id, email: user.email })
    .from(classOccurrences)
    .innerJoin(enrollments, eq(enrollments.classOfferingId, classOccurrences.classOfferingId))
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(user, eq(user.familyId, students.familyId))
    .where(
      and(eq(classOccurrences.id, occurrenceId), inArray(enrollments.status, LIVE_STATUSES)),
    )
    .orderBy(asc(user.email));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/audience.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add db/queries/audience.ts tests/integration/audience.test.ts
git commit -m "feat: resolve announcement and cancellation audiences"
```

---

### Task 5: Generic delivery queueing

**Files:**
- Modify: `db/queries/email-deliveries.ts`
- Test: `tests/integration/queue-deliveries.test.ts`

**Interfaces:**
- Consumes: `Recipient` (Task 4); `RenderedEmail` (Task 3).
- Produces: `queueDeliveries(exec, input: QueueDeliveriesInput): Promise<string[]>`; `releaseToQueued(db, deliveryId): Promise<void>`; `listQueuedForSource(db, sourceType, sourceId, limit): Promise<string[]>`; `countDeliveriesByStatus(db, sourceType, sourceId): Promise<Record<EmailDeliveryStatus, number>>`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/queue-deliveries.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import {
  claimForSend,
  countDeliveriesByStatus,
  listQueuedForSource,
  queueDeliveries,
  releaseToQueued,
} from "@/db/queries/email-deliveries";
import { emailDeliveries, user } from "@/db/schema";

const SOURCE_ID = "11111111-1111-1111-1111-111111111111";

describe("queueDeliveries", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
    await db.insert(user).values([
      { id: "u1", name: "One", email: "one@example.com" },
      { id: "u2", name: "Two", email: "two@example.com" },
    ]);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  const recipients = [
    { userId: "u1", email: "one@example.com" },
    { userId: "u2", email: "two@example.com" },
  ];

  function queue() {
    return queueDeliveries(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      template: "announcement.posted",
      category: "broadcast",
      recipients,
      render: (recipient) => ({
        subject: "Recital tickets",
        text: `hello ${recipient.email}`,
        html: `<p>hello ${recipient.email}</p>`,
      }),
    });
  }

  it("writes one row per recipient, rendered for that recipient", async () => {
    const ids = await queue();

    expect(ids).toHaveLength(2);
    const rows = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, SOURCE_ID));
    expect(rows.every((r) => r.category === "broadcast")).toBe(true);
    expect(rows.every((r) => r.sourceType === "announcement")).toBe(true);
    // The body differs per row — which is the whole reason rendering is a
    // callback rather than a value.
    expect(rows.map((r) => r.bodyText).sort()).toEqual([
      "hello one@example.com",
      "hello two@example.com",
    ]);
  });

  it("queues nothing for an empty audience rather than failing", async () => {
    const ids = await queueDeliveries(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      template: "announcement.posted",
      category: "broadcast",
      recipients: [],
      render: () => ({ subject: "x", text: "x", html: "x" }),
    });

    expect(ids).toEqual([]);
  });

  it("lists queued rows for one source up to a limit, oldest first", async () => {
    await queue();

    const first = await listQueuedForSource(db, "announcement", SOURCE_ID, 1);
    expect(first).toHaveLength(1);

    const all = await listQueuedForSource(db, "announcement", SOURCE_ID, 50);
    expect(all).toHaveLength(2);
  });

  it("omits a claimed row from the queued list and restores it on release", async () => {
    const ids = await queue();
    const claimed = await claimForSend(db, ids[0]!);
    expect(claimed).not.toBeNull();

    expect(await listQueuedForSource(db, "announcement", SOURCE_ID, 50)).toHaveLength(1);

    await releaseToQueued(db, ids[0]!);
    expect(await listQueuedForSource(db, "announcement", SOURCE_ID, 50)).toHaveLength(2);
  });

  it("counts a source's rows by status", async () => {
    const ids = await queue();
    await claimForSend(db, ids[0]!);

    const counts = await countDeliveriesByStatus(db, "announcement", SOURCE_ID);

    expect(counts.queued).toBe(1);
    expect(counts.sending).toBe(1);
    expect(counts.sent).toBe(0);
    expect(counts.failed).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/queue-deliveries.test.ts`
Expected: FAIL — `queueDeliveries` is not exported.

- [ ] **Step 3: Write the implementation**

In `db/queries/email-deliveries.ts`, add these imports to the existing ones:

```ts
import { count } from "drizzle-orm";
import type { RenderedEmail } from "@/lib/emails/layout";
import type { EmailCategory, EmailDeliveryStatus, EmailSourceType } from "@/db/schema";
import type { Recipient } from "./audience";
```

Then append:

```ts
export type QueueDeliveriesInput = {
  sourceType: EmailSourceType;
  sourceId: string;
  template: string;
  category: EmailCategory;
  recipients: Recipient[];
  /**
   * Called once per recipient rather than once per send.
   *
   * A broadcast body carries that recipient's own unsubscribe link, so the
   * rendered message genuinely differs row to row. Storing it per row is not
   * 3a's convention carried forward — it is forced.
   */
  render: (recipient: Recipient) => RenderedEmail;
};

/**
 * Writes one delivery row per recipient.
 *
 * Takes an `Executor` so it joins the caller's transaction: rows for a
 * transition that rolls back must roll back with it.
 *
 * An empty audience queues nothing and is not an error — nobody has asked to
 * be told, so there is nobody to tell. It returns early because an INSERT with
 * no values is a runtime error, not an empty insert.
 */
export async function queueDeliveries(
  exec: Executor,
  input: QueueDeliveriesInput,
): Promise<string[]> {
  if (input.recipients.length === 0) return [];

  const rows = await exec
    .insert(emailDeliveries)
    .values(
      input.recipients.map((recipient) => {
        const rendered = input.render(recipient);
        return {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          template: input.template,
          category: input.category,
          recipientUserId: recipient.userId,
          recipientEmail: recipient.email,
          subject: rendered.subject,
          bodyText: rendered.text,
          bodyHtml: rendered.html,
        };
      }),
    )
    .returning({ id: emailDeliveries.id });

  return rows.map((row) => row.id);
}

/**
 * Hands a claimed row back without recording an outcome.
 *
 * Used when a batch stops because the provider is rate-limiting: the row was
 * claimed but never attempted, so marking it `failed` would be a lie and
 * leaving it `sending` would strand it for fifteen minutes. `attempts` is
 * deliberately not decremented — the attempt to *claim* it did happen, and a
 * counter that goes backwards is worse than one that counts honestly.
 */
export async function releaseToQueued(db: Database, deliveryId: string): Promise<void> {
  await db
    .update(emailDeliveries)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(emailDeliveries.id, deliveryId), eq(emailDeliveries.status, "sending")));
}

/**
 * The next rows to send for one source, oldest first.
 *
 * `failed` rows are deliberately excluded. A resume sends what was never
 * attempted; an address the provider actively rejected is retried from
 * `/admin/emails` by someone who has read the error. Otherwise every press of
 * "Send the rest" would re-attempt the same dead address and re-fail it.
 */
export async function listQueuedForSource(
  db: Database,
  sourceType: EmailSourceType,
  sourceId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: emailDeliveries.id })
    .from(emailDeliveries)
    .where(
      and(
        eq(emailDeliveries.sourceType, sourceType),
        eq(emailDeliveries.sourceId, sourceId),
        eq(emailDeliveries.status, "queued"),
      ),
    )
    .orderBy(asc(emailDeliveries.createdAt), asc(emailDeliveries.id))
    .limit(limit);

  return rows.map((row) => row.id);
}

/**
 * How one fan-out is going, counted from the rows themselves.
 *
 * No counter column anywhere: a counter and the rows it summarises drift the
 * first time a process dies between the two writes, and this aggregate is
 * cheap — `(source_type, source_id)` is indexed.
 */
export async function countDeliveriesByStatus(
  db: Database,
  sourceType: EmailSourceType,
  sourceId: string,
): Promise<Record<EmailDeliveryStatus, number>> {
  const rows = await db
    .select({ status: emailDeliveries.status, total: count() })
    .from(emailDeliveries)
    .where(
      and(eq(emailDeliveries.sourceType, sourceType), eq(emailDeliveries.sourceId, sourceId)),
    )
    .groupBy(emailDeliveries.status);

  const counts: Record<EmailDeliveryStatus, number> = {
    queued: 0,
    sending: 0,
    sent: 0,
    failed: 0,
  };
  for (const row of rows) counts[row.status] = row.total;
  return counts;
}
```

- [ ] **Step 3a: Make `queueEnrollmentEmails` use it**

`queueEnrollmentEmails` ends by building delivery rows in a `.map` and
inserting them — which is now exactly what `queueDeliveries` does, with a
render that ignores its argument. Generalising the queueing and then leaving
the case it was generalised from on its own copy is the worst of both choices,
so replace that tail. The select of `details` and of `recipients` above it
stays as it is; only the insert goes.

Replace the final `const rows = await exec.insert(emailDeliveries)…` block and
its `return` with:

```ts
  return queueDeliveries(exec, {
    sourceType: "enrollment",
    sourceId: input.enrollmentId,
    template: input.template,
    category: "transactional",
    // The recipient select yields `{ id, email }`; `Recipient` is
    // `{ userId, email }`.
    recipients: recipients.map((recipient) => ({
      userId: recipient.id,
      email: recipient.email,
    })),
    // Every parent on the family gets the same transactional message — unlike
    // broadcast, where the body carries a per-recipient unsubscribe link.
    render: () => rendered,
  });
```

The early `if (recipients.length === 0) return [];` guard above can stay or go;
`queueDeliveries` makes the same check. Keeping it is fine — it avoids a
pointless render.

`tests/integration/email-queueing.test.ts` and
`tests/integration/enrollment-email-wiring.test.ts` both cover this function and
must stay green. If the refactor disturbs either, stop and report it rather
than adjusting those tests — they are Phase 3a's contract, not yours.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/queue-deliveries.test.ts tests/integration/email-queueing.test.ts tests/integration/enrollment-email-wiring.test.ts`
Expected: the 5 new tests pass, and both 3a suites still pass unchanged.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add db/queries/email-deliveries.ts tests/integration/queue-deliveries.test.ts
git commit -m "feat: queue deliveries for any source, rendered per recipient"
```

---

### Task 6: Announcement queries

**Files:**
- Create: `db/queries/announcements.ts`
- Test: `tests/integration/announcements.test.ts`

**Interfaces:**
- Consumes: `resolveAnnouncementAudience` (Task 4); `queueDeliveries` (Task 5); `renderAnnouncementEmail`, `ANNOUNCEMENT_TEMPLATE` (Task 3); `unsubscribeUrl` (Task 2); `recordAudit`.
- Produces: `createAnnouncement`, `updateAnnouncement`, `getAnnouncement`, `publishAnnouncement`, `sendAnnouncement`, `listAnnouncementsForAdmin`, `listPublicAnnouncements`, `listAnnouncementsForFamily`; types `NewAnnouncementInput`, `PublishResult`, `SendAnnouncementResult`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/announcements.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import {
  createAnnouncement,
  listAnnouncementsForFamily,
  listPublicAnnouncements,
  publishAnnouncement,
  sendAnnouncement,
} from "@/db/queries/announcements";
import { requestEnrollment } from "@/db/queries/enrollments";
import { announcements, auditLog, emailDeliveries, user } from "@/db/schema";

const TODAY = "2026-10-01";

describe("announcements", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedEnrolledFamily() {
    const seeded = await seedTwoFamilies(db, 5);
    await db
      .insert(user)
      .values({ id: "a1", name: "One", email: "a1@example.com", familyId: seeded.familyA.id });
    const requested = await requestEnrollment(db, seeded.familyA.id, {
      studentId: seeded.studentA.id,
      offeringId: seeded.offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    // The enrollment queued its own transactional mail; this suite is about
    // announcement rows, so start from an empty table.
    await db.delete(emailDeliveries);
    return seeded;
  }

  async function draft() {
    return createAnnouncement(db, {
      title: "Recital tickets",
      body: "Tickets are at the desk.",
      audienceType: "all",
      classOfferingId: null,
      createdByUserId: null,
    });
  }

  it("publishing sets the timestamp, writes an audit row, and sends nothing", async () => {
    await seedEnrolledFamily();
    const announcement = await draft();

    const result = await publishAnnouncement(db, {
      announcementId: announcement.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    const [row] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, announcement.id));
    expect(row!.status).toBe("published");
    expect(row!.publishedAt).not.toBeNull();
    expect(row!.emailedAt).toBeNull();
    expect(await db.select().from(emailDeliveries)).toHaveLength(0);
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, announcement.id));
    expect(audits.map((a) => a.action)).toEqual(["announcement.published"]);
  });

  it("refuses to publish twice", async () => {
    const announcement = await draft();
    await publishAnnouncement(db, { announcementId: announcement.id, actorUserId: null });

    const second = await publishAnnouncement(db, {
      announcementId: announcement.id,
      actorUserId: null,
    });

    expect(second).toEqual({ ok: false, reason: "not-draft" });
  });

  it("refuses to send an unpublished draft", async () => {
    const announcement = await draft();

    const result = await sendAnnouncement(db, {
      announcementId: announcement.id,
      actorUserId: null,
      today: TODAY,
    });

    expect(result).toEqual({ ok: false, reason: "not-published" });
  });

  it("queues one row per recipient and stamps emailed_at", async () => {
    await seedEnrolledFamily();
    const announcement = await draft();
    await publishAnnouncement(db, { announcementId: announcement.id, actorUserId: null });

    const result = await sendAnnouncement(db, {
      announcementId: announcement.id,
      actorUserId: null,
      today: TODAY,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipientCount).toBe(1);
    const rows = await db.select().from(emailDeliveries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe("broadcast");
    expect(rows[0]!.sourceType).toBe("announcement");
    expect(rows[0]!.bodyText).toContain("/unsubscribe?u=");
    const [row] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, announcement.id));
    expect(row!.emailedAt).not.toBeNull();
  });

  it("queues exactly one set of rows when two sends race", async () => {
    await seedEnrolledFamily();
    const announcement = await draft();
    await publishAnnouncement(db, { announcementId: announcement.id, actorUserId: null });

    const [first, second] = await Promise.all([
      sendAnnouncement(db, { announcementId: announcement.id, actorUserId: null, today: TODAY }),
      sendAnnouncement(db, { announcementId: announcement.id, actorUserId: null, today: TODAY }),
    ]);

    // One wins; the other is told it was already sent. Never both.
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await db.select().from(emailDeliveries)).toHaveLength(1);
  });

  it("shows an 'all' announcement publicly and a class one only in the portal", async () => {
    const seeded = await seedEnrolledFamily();
    const everyone = await draft();
    await publishAnnouncement(db, { announcementId: everyone.id, actorUserId: null });
    const classOnly = await createAnnouncement(db, {
      title: "Ballet I moves rooms",
      body: "Studio B from Monday.",
      audienceType: "class_offering",
      classOfferingId: seeded.offering.id,
      createdByUserId: null,
    });
    await publishAnnouncement(db, { announcementId: classOnly.id, actorUserId: null });

    const publicList = await listPublicAnnouncements(db);
    const familyList = await listAnnouncementsForFamily(db, seeded.familyA.id);

    expect(publicList.map((a) => a.title)).toEqual(["Recital tickets"]);
    expect(familyList.map((a) => a.title).sort()).toEqual([
      "Ballet I moves rooms",
      "Recital tickets",
    ]);
  });

  it("does not show an unrelated family a class announcement", async () => {
    const seeded = await seedEnrolledFamily();
    const classOnly = await createAnnouncement(db, {
      title: "Ballet I moves rooms",
      body: "Studio B from Monday.",
      audienceType: "class_offering",
      classOfferingId: seeded.offering.id,
      createdByUserId: null,
    });
    await publishAnnouncement(db, { announcementId: classOnly.id, actorUserId: null });

    expect(await listAnnouncementsForFamily(db, seeded.familyB.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/announcements.test.ts`
Expected: FAIL — cannot resolve `@/db/queries/announcements`.

- [ ] **Step 3: Write the implementation**

Create `db/queries/announcements.ts`:

```ts
import { and, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import {
  announcements,
  classOfferings,
  enrollments,
  students,
  type Announcement,
  type AnnouncementAudience,
} from "@/db/schema";
import { todayIso } from "@/lib/dates";
import { ANNOUNCEMENT_TEMPLATE, renderAnnouncementEmail } from "@/lib/emails/announcement";
import { unsubscribeUrl } from "@/lib/unsubscribe-token";
import { resolveAnnouncementAudience } from "./audience";
import { recordAudit } from "./audit-log";
import { queueDeliveries } from "./email-deliveries";
import type { Database } from "./executor";

export type NewAnnouncementInput = {
  title: string;
  body: string;
  audienceType: AnnouncementAudience;
  classOfferingId: string | null;
  createdByUserId: string | null;
};

export async function createAnnouncement(
  db: Database,
  input: NewAnnouncementInput,
): Promise<Announcement> {
  const [row] = await db.insert(announcements).values(input).returning();
  if (!row) throw new Error("createAnnouncement: insert returned no row");
  return row;
}

/**
 * Edits the copy.
 *
 * Allowed after sending on purpose: the site is the system of record and a
 * typo should be fixable there. It never re-sends, and the delivery rows keep
 * what was actually mailed — the page tells staff as much.
 */
export async function updateAnnouncement(
  db: Database,
  announcementId: string,
  input: Pick<NewAnnouncementInput, "title" | "body">,
): Promise<Announcement | null> {
  const [row] = await db
    .update(announcements)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(announcements.id, announcementId))
    .returning();
  return row ?? null;
}

export async function getAnnouncement(
  db: Database,
  announcementId: string,
): Promise<Announcement | null> {
  const [row] = await db
    .select()
    .from(announcements)
    .where(eq(announcements.id, announcementId))
    .limit(1);
  return row ?? null;
}

export type PublishResult =
  | { ok: true; announcement: Announcement }
  | { ok: false; reason: "not-found" | "not-draft" };

/**
 * Puts an announcement on the site. Sends nothing.
 *
 * The status predicate makes a double submit harmless: the second call moves
 * zero rows and says so, rather than overwriting `published_at` with a later
 * time.
 */
export async function publishAnnouncement(
  db: Database,
  input: { announcementId: string; actorUserId: string | null },
): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(announcements)
      .where(eq(announcements.id, input.announcementId))
      .limit(1);
    if (!before) return { ok: false, reason: "not-found" } as const;

    const now = new Date();
    const [row] = await tx
      .update(announcements)
      .set({ status: "published", publishedAt: now, updatedAt: now })
      .where(
        and(eq(announcements.id, input.announcementId), eq(announcements.status, "draft")),
      )
      .returning();
    if (!row) return { ok: false, reason: "not-draft" } as const;

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "announcement.published",
      entityType: "announcement",
      entityId: row.id,
      before: { status: before.status },
      after: { status: row.status, audienceType: row.audienceType },
    });

    return { ok: true, announcement: row } as const;
  });
}

export type SendAnnouncementResult =
  | { ok: true; deliveryIds: string[]; recipientCount: number }
  | { ok: false; reason: "not-found" | "not-published" | "already-emailed" };

/**
 * Queues the fan-out, exactly once.
 *
 * The conditional UPDATE runs first — before the audience is resolved and
 * before a single row is written — so two staff members pressing Send at the
 * same moment means the second one aborts having queued nothing. Same
 * discipline as the seat claim and the delivery claim: the affected-row count
 * is the decision.
 *
 * Rendering happens per recipient because each body carries that recipient's
 * own unsubscribe link.
 */
export async function sendAnnouncement(
  db: Database,
  input: { announcementId: string; actorUserId: string | null; today?: string },
): Promise<SendAnnouncementResult> {
  const today = input.today ?? todayIso();

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(announcements)
      .where(eq(announcements.id, input.announcementId))
      .limit(1);
    if (!before) return { ok: false, reason: "not-found" } as const;
    if (before.status !== "published") {
      return { ok: false, reason: "not-published" } as const;
    }

    const now = new Date();
    const [claimed] = await tx
      .update(announcements)
      .set({ emailedAt: now, updatedAt: now })
      .where(
        and(
          eq(announcements.id, input.announcementId),
          eq(announcements.status, "published"),
          isNull(announcements.emailedAt),
        ),
      )
      .returning();
    if (!claimed) return { ok: false, reason: "already-emailed" } as const;

    const recipients = await resolveAnnouncementAudience(tx, claimed, today);

    const deliveryIds = await queueDeliveries(tx, {
      sourceType: "announcement",
      sourceId: claimed.id,
      template: ANNOUNCEMENT_TEMPLATE,
      category: "broadcast",
      recipients,
      render: (recipient) =>
        renderAnnouncementEmail({
          title: claimed.title,
          body: claimed.body,
          unsubscribeUrl: unsubscribeUrl(recipient.userId),
        }),
    });

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "announcement.emailed",
      entityType: "announcement",
      entityId: claimed.id,
      before: null,
      after: { audienceType: claimed.audienceType, recipientCount: recipients.length },
    });

    return { ok: true, deliveryIds, recipientCount: recipients.length } as const;
  });
}

/** Everything, newest first — the admin list. */
export async function listAnnouncementsForAdmin(db: Database): Promise<Announcement[]> {
  return db.select().from(announcements).orderBy(desc(announcements.createdAt));
}

/**
 * What the open web sees: published, addressed to everyone.
 *
 * A class-targeted announcement is for the families in that class, so it never
 * appears here — the audience is part of what the announcement means, not just
 * a mailing decision.
 */
export async function listPublicAnnouncements(db: Database): Promise<Announcement[]> {
  return db
    .select()
    .from(announcements)
    .where(and(eq(announcements.status, "published"), eq(announcements.audienceType, "all")))
    .orderBy(desc(announcements.publishedAt));
}

/**
 * What one family is addressed by: everything public, plus announcements
 * targeting a class they hold a live seat in.
 *
 * `familyId` is a required first parameter and is filtered in SQL, like every
 * other family-scoped read in this directory.
 */
export async function listAnnouncementsForFamily(
  db: Database,
  familyId: string,
): Promise<Announcement[]> {
  const targetsAClassThisFamilyIsIn = exists(
    db
      .select({ one: sql`1` })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(
        and(
          eq(students.familyId, familyId),
          inArray(enrollments.status, ["pending", "active"]),
          eq(enrollments.classOfferingId, announcements.classOfferingId),
        ),
      ),
  );

  return db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.status, "published"),
        or(eq(announcements.audienceType, "all"), targetsAClassThisFamilyIsIn),
      ),
    )
    .orderBy(desc(announcements.publishedAt));
}
```

> **Note on the unused import:** if `classOfferings` ends up unreferenced after
> you write this file, delete it from the import list — `tsc --noEmit` is not
> configured to fail on unused imports, but leaving one is still noise.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/announcements.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add db/queries/announcements.ts tests/integration/announcements.test.ts
git commit -m "feat: draft, publish, and send announcements"
```

---

### Task 7: Paced batch sending

**Files:**
- Modify: `lib/email.ts`
- Modify: `lib/notifications/deliver.ts`
- Test: `tests/unit/email-transport.test.ts` (extend)
- Test: `tests/integration/deliver-batch.test.ts`

**Interfaces:**
- Consumes: `listQueuedForSource`, `releaseToQueued` (Task 5).
- Produces: `class EmailSendError extends Error` with `statusCode: number | null`, `providerErrorName: string | null`, `isRateLimited: boolean`; `EmailMessage.headers?: Record<string, string>`; `DeliveryOutcome` gains `"rate-limited"`; `deliverQueued(db, ids, opts?: { minIntervalMs?: number })`; `deliverBatchForSource(db, input): Promise<BatchOutcome>`; `BROADCAST_BATCH_SIZE`; `SEND_INTERVAL_MS`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/email-transport.test.ts`:

```ts
import { EmailSendError } from "@/lib/email";

describe("EmailSendError", () => {
  it("recognises a 429 as a rate limit", () => {
    expect(new EmailSendError("slow down", 429, null).isRateLimited).toBe(true);
  });

  it("recognises the provider's named rate-limit error without a status", () => {
    expect(
      new EmailSendError("slow down", null, "rate_limit_exceeded").isRateLimited,
    ).toBe(true);
  });

  it("treats a rejected address as an ordinary failure", () => {
    expect(new EmailSendError("invalid recipient", 422, "validation_error").isRateLimited).toBe(
      false,
    );
  });
});
```

And create `tests/unit/unsubscribe-headers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { unsubscribeHeaders } from "@/lib/notifications/deliver";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

describe("unsubscribeHeaders", () => {
  it("gives broadcast mail a one-click unsubscribe header naming that recipient", () => {
    const { headers } = unsubscribeHeaders({
      category: "broadcast",
      recipientUserId: "user-abc",
    });

    expect(headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const url = new URL(headers!["List-Unsubscribe"]!.slice(1, -1));
    expect(url.pathname).toBe("/api/unsubscribe");
    expect(verifyUnsubscribeToken(url.searchParams.get("u")!)).toBe("user-abc");
  });

  it("gives transactional mail no unsubscribe headers at all", () => {
    expect(
      unsubscribeHeaders({ category: "transactional", recipientUserId: "user-abc" }),
    ).toEqual({});
  });

  it("gives a row whose account was deleted no header rather than a broken link", () => {
    expect(unsubscribeHeaders({ category: "broadcast", recipientUserId: null })).toEqual({});
  });
});
```

Create `tests/integration/deliver-batch.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { queueDeliveries } from "@/db/queries/email-deliveries";
import { deliverBatchForSource } from "@/lib/notifications/deliver";
import { emailDeliveries, user } from "@/db/schema";

const SOURCE_ID = "22222222-2222-2222-2222-222222222222";

describe("deliverBatchForSource", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
    await db.insert(user).values(
      [1, 2, 3].map((n) => ({ id: `u${n}`, name: `U${n}`, email: `u${n}@example.com` })),
    );
    await queueDeliveries(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      template: "announcement.posted",
      category: "broadcast",
      recipients: [1, 2, 3].map((n) => ({ userId: `u${n}`, email: `u${n}@example.com` })),
      render: () => ({ subject: "Recital", text: "text", html: "<p>html</p>" }),
    });
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("sends only up to the limit and leaves the rest queued and resumable", async () => {
    const first = await deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      limit: 2,
      minIntervalMs: 0,
    });

    expect(first.sent).toBe(2);
    expect(first.remaining).toBe(1);

    const second = await deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      limit: 2,
      minIntervalMs: 0,
    });

    expect(second.sent).toBe(1);
    expect(second.remaining).toBe(0);
    const rows = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, SOURCE_ID));
    expect(rows.every((r) => r.status === "sent")).toBe(true);
  });

  it("does nothing and reports nothing remaining once everything is sent", async () => {
    await deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      limit: 50,
      minIntervalMs: 0,
    });

    const again = await deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      limit: 50,
      minIntervalMs: 0,
    });

    expect(again).toEqual({ sent: 0, failed: 0, skipped: 0, rateLimited: false, remaining: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/email-transport.test.ts tests/unit/unsubscribe-headers.test.ts tests/integration/deliver-batch.test.ts`
Expected: FAIL — `EmailSendError`, `unsubscribeHeaders` and `deliverBatchForSource` are not exported.

- [ ] **Step 3: Type the transport error**

In `lib/email.ts`, add the error class and the headers passthrough, and throw the typed error instead of a plain one:

```ts
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * Extra provider headers. Broadcast mail uses this for `List-Unsubscribe`
   * and `List-Unsubscribe-Post`; transactional mail passes nothing.
   */
  headers?: Record<string, string>;
};

/**
 * A send the provider refused, carrying enough to tell *why* apart from *that*.
 *
 * The batch runner has to distinguish a rate limit — stop, try the rest later —
 * from a rejected address — record it and move on. Matching on the message
 * string would work until Resend rewords anything, so the status code and the
 * provider's error name travel on the error itself.
 */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
    readonly providerErrorName: string | null,
  ) {
    super(message);
    this.name = "EmailSendError";
  }

  get isRateLimited(): boolean {
    return this.statusCode === 429 || this.providerErrorName === "rate_limit_exceeded";
  }
}
```

Then in `sendEmail`, pass the headers through and throw the typed error:

```ts
  const { data, error } = await client().emails.send({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
    ...(message.headers ? { headers: message.headers } : {}),
  });

  if (error) {
    console.error("sendEmail failed", { to: message.to, error });
    /*
     * No cast and no fallbacks: Resend 6.20 types its `ErrorResponse` as
     * `{ message: string; statusCode: number | null; name: RESEND_ERROR_CODE_KEY }`,
     * and `rate_limit_exceeded` is one of that union's members — so the
     * rate-limit test below is reading a documented value, not guessing at an
     * undocumented shape. Verified in `node_modules/resend/dist/index.d.mts`.
     */
    throw new EmailSendError(
      `Failed to send email: ${error.message}`,
      error.statusCode,
      error.name,
    );
  }
```

- [ ] **Step 4: Pace the runner and add the per-source batch**

In `lib/notifications/deliver.ts`, widen the outcome, add pacing, and handle a rate limit. Replace the existing `DeliveryOutcome` and `deliverQueued` signature, and add the new exports:

```ts
import { EmailSendError, sendEmail } from "@/lib/email";
import {
  claimForSend,
  listQueuedForSource,
  markFailed,
  markSent,
  releaseToQueued,
} from "@/db/queries/email-deliveries";
import type { EmailSourceType } from "@/db/schema";

/** What happened to one delivery. */
export type DeliveryOutcome = "sent" | "failed" | "skipped" | "rate-limited";

/**
 * How many rows one press sends.
 *
 * Fifty paced sends is about twenty-eight seconds, which sits comfortably
 * inside `after()`. A longer batch buys fewer presses at the cost of a much
 * larger window in which a dying process strands work.
 */
export const BROADCAST_BATCH_SIZE = 50;

/**
 * The floor between two sends.
 *
 * Resend's default allowance is about two requests a second. Fifty unpaced
 * sends would collect 429s and mark perfectly good addresses `failed`, which
 * then have to be retried by hand one at a time — the expensive failure.
 */
export const SEND_INTERVAL_MS = 550;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * RFC 8058 one-click headers, for broadcast mail only.
 *
 * These are what make Gmail and Apple Mail show their own unsubscribe button
 * next to the sender — the highest-leverage deliverability item available to a
 * studio sending from a young domain, and far likelier to be used than a link
 * buried in a footer.
 *
 * Attached here rather than at render time because the header is a property of
 * the *send*, not of the message body, and because this is the one place that
 * sees both the category and the recipient. A row with no `recipientUserId`
 * (the account was deleted) gets no header rather than a broken link.
 */
export function unsubscribeHeaders(delivery: {
  category: EmailCategory;
  recipientUserId: string | null;
}): { headers?: Record<string, string> } {
  if (delivery.category !== "broadcast" || !delivery.recipientUserId) return {};

  return {
    headers: {
      "List-Unsubscribe": `<${unsubscribePostUrl(delivery.recipientUserId)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
```

with these added to the imports at the top of the file:

```ts
import type { EmailCategory } from "@/db/schema";
import { unsubscribePostUrl } from "@/lib/unsubscribe-token";
```

Then rewrite the body of `deliverQueued` to take options, pace between rows, and stop on a rate limit:

```ts
export async function deliverQueued(
  db: Database,
  deliveryIds: string[],
  opts: { minIntervalMs?: number } = {},
): Promise<Record<string, DeliveryOutcome>> {
  const minIntervalMs = opts.minIntervalMs ?? SEND_INTERVAL_MS;
  const outcomes: Record<string, DeliveryOutcome> = {};
  let sentSomething = false;

  for (const deliveryId of deliveryIds) {
    try {
      // Pace before the send, not after, so a batch of one costs nothing.
      if (sentSomething && minIntervalMs > 0) await sleep(minIntervalMs);

      const delivery = await claimForSend(db, deliveryId);
      if (!delivery) {
        outcomes[deliveryId] = "skipped";
        continue;
      }

      try {
        const result = await sendEmail({
          to: delivery.recipientEmail,
          subject: delivery.subject,
          text: delivery.bodyText,
          html: delivery.bodyHtml,
          ...unsubscribeHeaders(delivery),
        });
        sentSomething = true;
        await markSent(db, delivery.id, result.providerMessageId);
        outcomes[deliveryId] = "sent";
      } catch (error) {
        /*
         * A rate limit is not this row's fault. Hand the claim back and stop
         * the batch: marking it failed would put a healthy address on the
         * retry page, and pressing on would do the same to every row after it.
         */
        if (error instanceof EmailSendError && error.isRateLimited) {
          await releaseToQueued(db, delivery.id);
          outcomes[deliveryId] = "rate-limited";
          break;
        }

        const message = error instanceof Error ? error.message : String(error);
        await markFailed(db, delivery.id, message);
        outcomes[deliveryId] = "failed";
      }
    } catch (error) {
      // Bookkeeping failed, not the send. Leave the row where it is rather
      // than claiming to know the outcome, and keep going.
      console.error("deliverQueued: could not record a delivery outcome", { deliveryId, error });
      outcomes[deliveryId] = "skipped";
    }
  }

  return outcomes;
}

export type BatchOutcome = {
  sent: number;
  failed: number;
  skipped: number;
  /** True when the provider asked us to slow down and the batch stopped early. */
  rateLimited: boolean;
  /** Rows still queued for this source afterwards — what "Send the rest" would take. */
  remaining: number;
};

/**
 * Sends one bounded batch for a single source, then reports what is left.
 *
 * This is the whole fan-out mechanism: `after()` runs the first batch, and the
 * announcement page's resume button runs the next. Nothing sweeps on a timer,
 * so `remaining` is the number a person needs to see.
 */
export async function deliverBatchForSource(
  db: Database,
  input: {
    sourceType: EmailSourceType;
    sourceId: string;
    limit?: number;
    minIntervalMs?: number;
  },
): Promise<BatchOutcome> {
  const limit = input.limit ?? BROADCAST_BATCH_SIZE;
  const ids = await listQueuedForSource(db, input.sourceType, input.sourceId, limit);
  const outcomes = await deliverQueued(db, ids, { minIntervalMs: input.minIntervalMs });
  const values = Object.values(outcomes);

  const remaining = await listQueuedForSource(
    db,
    input.sourceType,
    input.sourceId,
    // One more than a batch, so a full batch still reports honestly that there
    // is more rather than reporting exactly the limit.
    limit + 1,
  );

  return {
    sent: values.filter((v) => v === "sent").length,
    failed: values.filter((v) => v === "failed").length,
    skipped: values.filter((v) => v === "skipped").length,
    rateLimited: values.includes("rate-limited"),
    remaining: remaining.length,
  };
}
```

- [ ] **Step 4a: Prove the rate-limit branch actually releases and stops**

This is the branch that protects a real fan-out: get it wrong and a provider
hiccup marks a hundred healthy addresses `failed`, each needing a hand retry.
It needs its own file, because it has to mock the transport and
`deliver-batch.test.ts` deliberately runs against the real capture transport.

Create `tests/integration/deliver-rate-limit.test.ts`:

```ts
import { vi } from "vitest";

/*
 * Succeed once, then rate-limit everything after.
 *
 * Counting calls rather than matching an address on purpose: `queueDeliveries`
 * inserts every row in one statement, so they share a `createdAt` and
 * `listQueuedForSource` breaks the tie on a random uuid. "The second row sent"
 * is deterministic; "the row for u2@example.com" is not.
 */
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  let calls = 0;
  return {
    ...actual,
    sendEmail: vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { providerMessageId: "capture-ok" };
      throw new actual.EmailSendError("Too many requests", 429, "rate_limit_exceeded");
    }),
  };
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { queueDeliveries } from "@/db/queries/email-deliveries";
import { deliverBatchForSource } from "@/lib/notifications/deliver";
import { emailDeliveries, user } from "@/db/schema";

const SOURCE_ID = "33333333-3333-3333-3333-333333333333";

describe("deliverBatchForSource when the provider rate-limits", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
    await db.insert(user).values(
      [1, 2, 3].map((n) => ({ id: `u${n}`, name: `U${n}`, email: `u${n}@example.com` })),
    );
    await queueDeliveries(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      template: "announcement.posted",
      category: "broadcast",
      recipients: [1, 2, 3].map((n) => ({ userId: `u${n}`, email: `u${n}@example.com` })),
      render: () => ({ subject: "Recital", text: "text", html: "<p>html</p>" }),
    });
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("releases the claim, stops the batch, and leaves the rest resumable", async () => {
    const outcome = await deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      limit: 10,
      minIntervalMs: 0,
    });

    expect(outcome.sent).toBe(1);
    expect(outcome.rateLimited).toBe(true);
    // Nothing is failed: a rate limit is not the address's fault.
    expect(outcome.failed).toBe(0);
    // Both survivors are still sendable, which is what "Send the rest" reads.
    expect(outcome.remaining).toBe(2);

    const rows = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, SOURCE_ID));

    expect(rows.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "queued")).toHaveLength(2);
    expect(rows.filter((r) => r.status === "failed")).toHaveLength(0);

    /*
     * The two queued rows are not interchangeable, and the difference is the
     * whole point. One was claimed and handed back, so it carries an attempt.
     * The other was never reached, because the loop broke — if it had kept
     * going it would carry an attempt too, and a real fan-out would burn
     * through every remaining address against a provider already saying stop.
     */
     const queuedAttempts = rows
      .filter((r) => r.status === "queued")
      .map((r) => r.attempts)
      .sort();
    expect(queuedAttempts).toEqual([0, 1]);
  });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/email-transport.test.ts tests/unit/unsubscribe-headers.test.ts tests/integration/deliver-batch.test.ts tests/integration/deliver-rate-limit.test.ts tests/integration/deliver-queued.test.ts tests/integration/deliver-queued-failure.test.ts`
Expected: all pass. The two 3a delivery suites are included because `deliverQueued` changed underneath them; if either now fails on timing, pass `{ minIntervalMs: 0 }` in that test rather than removing the pacing.

- [ ] **Step 6: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add lib/email.ts lib/notifications/deliver.ts tests/unit tests/integration/deliver-batch.test.ts
git commit -m "feat: pace sending, add one-click unsubscribe headers, and batch a fan-out"
```

---

### Task 8: The admin announcement pages

**Files:**
- Create: `lib/announcement-validation.ts`
- Create: `app/admin/announcements/actions.ts`
- Create: `app/admin/announcements/page.tsx`
- Create: `app/admin/announcements/new/page.tsx`
- Create: `app/admin/announcements/[announcementId]/page.tsx`
- Create: `components/announcement-form.tsx`
- Create: `components/announcement-send-panel.tsx`
- Modify: `app/admin/layout.tsx`
- Test: `tests/unit/announcement-validation.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–7.
- Produces: `announcementInputSchema`, `announcementIdSchema`; `createAnnouncementAction`, `updateAnnouncementAction`, `publishAnnouncementAction`, `sendAnnouncementAction`, `sendRemainingAction`.

- [ ] **Step 1: Write the failing validation test**

Create `tests/unit/announcement-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { announcementInputSchema } from "@/lib/announcement-validation";

const base = { title: "Recital tickets", body: "Tickets are at the desk." };

describe("announcementInputSchema", () => {
  it("accepts an announcement addressed to everyone", () => {
    const parsed = announcementInputSchema.safeParse({ ...base, audienceType: "all" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.classOfferingId).toBeNull();
  });

  it("requires a class when the audience is a class", () => {
    const parsed = announcementInputSchema.safeParse({
      ...base,
      audienceType: "class_offering",
    });
    expect(parsed.success).toBe(false);
  });

  it("ignores a class when the audience is everyone", () => {
    const parsed = announcementInputSchema.safeParse({
      ...base,
      audienceType: "all",
      classOfferingId: "8f8c4c34-0f3a-4f3f-9f3a-4f3f9f3a4f3f",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.classOfferingId).toBeNull();
  });

  it("rejects an empty title or body", () => {
    expect(announcementInputSchema.safeParse({ ...base, title: "  ", audienceType: "all" }).success)
      .toBe(false);
    expect(announcementInputSchema.safeParse({ ...base, body: "", audienceType: "all" }).success)
      .toBe(false);
  });
});

describe("announcementEditSchema", () => {
  it("accepts a form carrying no audience, because the edit form disables it", () => {
    expect(announcementEditSchema.safeParse(base).success).toBe(true);
  });

  it("still requires a title and a body", () => {
    expect(announcementEditSchema.safeParse({ ...base, title: " " }).success).toBe(false);
  });
});
```

with the import line reading:

```ts
import { announcementEditSchema, announcementInputSchema } from "@/lib/announcement-validation";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/announcement-validation.test.ts`
Expected: FAIL — cannot resolve `@/lib/announcement-validation`.

- [ ] **Step 3: Write the schemas**

Create `lib/announcement-validation.ts`:

```ts
import { z } from "zod";

/*
 * The audience pair is normalised here as well as checked in the database:
 * the check constraint is the guarantee, and this is the part that turns a
 * mistake into a sentence a person can act on instead of a 500.
 */
export const announcementInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the announcement a title.").max(200),
    body: z.string().trim().min(1, "Write something in the body."),
    audienceType: z.enum(["all", "class_offering"]),
    classOfferingId: z.uuid().optional(),
  })
  .transform((input) => ({
    ...input,
    // `?? null`, not `!`: a missing field parses as `undefined`, and the
    // refine below checks `!== null` — leaving it `undefined` would let a
    // class-audience row with no class straight through.
    classOfferingId:
      input.audienceType === "class_offering" ? (input.classOfferingId ?? null) : null,
  }))
  .refine((input) => input.audienceType === "all" || input.classOfferingId !== null, {
    message: "Choose which class this is for.",
    path: ["classOfferingId"],
  });

/**
 * Editing changes the copy and nothing else.
 *
 * Separate from the create schema for a concrete reason: the edit form
 * disables the audience controls, and a disabled field submits nothing — so
 * parsing an edit with `announcementInputSchema` would fail on a missing
 * `audienceType` every time. The audience is also genuinely immutable once
 * rows have gone out addressed to it.
 */
export const announcementEditSchema = z.object({
  title: z.string().trim().min(1, "Give the announcement a title.").max(200),
  body: z.string().trim().min(1, "Write something in the body."),
});

export const announcementIdSchema = z.object({ announcementId: z.uuid() });
```

> `.transform` runs before `.refine` here, which is why the refine can read the
> normalised value. Keep that order.

- [ ] **Step 4: Run the validation test to verify it passes**

Run: `npx vitest run tests/unit/announcement-validation.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Write the actions**

Create `app/admin/announcements/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import {
  createAnnouncement,
  publishAnnouncement,
  sendAnnouncement,
  updateAnnouncement,
} from "@/db/queries/announcements";
import type { ActionState } from "@/lib/action-state";
import {
  announcementEditSchema,
  announcementIdSchema,
  announcementInputSchema,
} from "@/lib/announcement-validation";
import { requireStaff } from "@/lib/guards";
import { deliverBatchForSource } from "@/lib/notifications/deliver";

function toObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && value !== "") result[key] = value;
  }
  return result;
}

/** Everything an announcement touches on the site. */
function revalidateAnnouncement(announcementId: string): void {
  revalidatePath("/admin/announcements");
  revalidatePath(`/admin/announcements/${announcementId}`);
  revalidatePath("/announcements");
  revalidatePath("/portal/announcements");
}

export async function createAnnouncementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const parsed = announcementInputSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const announcement = await createAnnouncement(db, {
    ...parsed.data,
    createdByUserId: staff.id,
  });

  revalidatePath("/admin/announcements");
  // Straight to the detail page: publishing and sending live there, and a
  // draft nobody can find is a draft nobody sends.
  redirect(`/admin/announcements/${announcement.id}`);
}

export async function updateAnnouncementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const raw = toObject(formData);
  const id = announcementIdSchema.safeParse(raw);
  if (!id.success) return { error: "That announcement could not be found." };

  const parsed = announcementEditSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const updated = await updateAnnouncement(db, id.data.announcementId, {
    title: parsed.data.title,
    body: parsed.data.body,
  });
  if (!updated) return { error: "That announcement could not be found." };

  revalidateAnnouncement(id.data.announcementId);
  return { error: null };
}

export async function publishAnnouncementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const parsed = announcementIdSchema.safeParse(toObject(formData));
  if (!parsed.success) return { error: "That announcement could not be found." };

  const result = await publishAnnouncement(db, {
    announcementId: parsed.data.announcementId,
    actorUserId: staff.id,
  });
  if (!result.ok) {
    return {
      error:
        result.reason === "not-found"
          ? "That announcement no longer exists."
          : "That announcement is already published.",
    };
  }

  revalidateAnnouncement(parsed.data.announcementId);
  return { error: null };
}

export async function sendAnnouncementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const parsed = announcementIdSchema.safeParse(toObject(formData));
  if (!parsed.success) return { error: "That announcement could not be found." };

  const result = await sendAnnouncement(db, {
    announcementId: parsed.data.announcementId,
    actorUserId: staff.id,
  });
  if (!result.ok) {
    return {
      error:
        result.reason === "not-found"
          ? "That announcement no longer exists."
          : result.reason === "not-published"
            ? "Publish it before sending it."
            : "That announcement has already been sent.",
    };
  }

  /*
   * After the response, like every other send in this system: nobody should
   * watch a spinner while fifty paced messages go out.
   */
  after(() =>
    deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: parsed.data.announcementId,
    }),
  );

  revalidateAnnouncement(parsed.data.announcementId);
  return { error: null };
}

export async function sendRemainingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const parsed = announcementIdSchema.safeParse(toObject(formData));
  if (!parsed.success) return { error: "That announcement could not be found." };

  /*
   * Awaited, not deferred: a person pressed this and is waiting to see the
   * counts move. A batch is bounded, so the wait is bounded too.
   */
  const outcome = await deliverBatchForSource(db, {
    sourceType: "announcement",
    sourceId: parsed.data.announcementId,
  });

  revalidateAnnouncement(parsed.data.announcementId);

  if (outcome.rateLimited) {
    return {
      error: `The provider asked us to slow down after ${outcome.sent} message${
        outcome.sent === 1 ? "" : "s"
      }. Wait a minute and press it again.`,
    };
  }
  return { error: null };
}
```

- [ ] **Step 6: Write the form component**

Create `components/announcement-form.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { idleState } from "@/lib/action-state";
import type { ActionState } from "@/lib/action-state";

export type OfferingChoice = { id: string; name: string };

export function AnnouncementForm({
  action,
  offerings,
  announcement,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  offerings: OfferingChoice[];
  announcement?: {
    id: string;
    title: string;
    body: string;
    audienceType: "all" | "class_offering";
    classOfferingId: string | null;
  };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const [audience, setAudience] = useState(announcement?.audienceType ?? "all");
  // Editing never changes the audience — the rows that went out were addressed
  // to the audience as it was, so changing it afterwards would describe a send
  // that never happened.
  const locked = announcement !== undefined;

  return (
    <form action={formAction} className="mt-8 flex max-w-2xl flex-col gap-5">
      {announcement && (
        <input type="hidden" name="announcementId" value={announcement.id} />
      )}

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-chalk">Title</span>
        <input
          name="title"
          defaultValue={announcement?.title}
          required
          maxLength={200}
          className="input"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-chalk">Body</span>
        <textarea
          name="body"
          defaultValue={announcement?.body}
          required
          rows={10}
          className="input"
        />
        <span className="hint">
          Plain text. Leave a blank line between paragraphs.
        </span>
      </label>

      <fieldset className="flex flex-col gap-2" disabled={locked}>
        <legend className="text-sm font-medium text-chalk">Who is this for?</legend>
        <label className="flex items-center gap-2 text-sm text-mirror">
          <input
            type="radio"
            name="audienceType"
            value="all"
            checked={audience === "all"}
            onChange={() => setAudience("all")}
          />
          Everyone enrolled this season
        </label>
        <label className="flex items-center gap-2 text-sm text-mirror">
          <input
            type="radio"
            name="audienceType"
            value="class_offering"
            checked={audience === "class_offering"}
            onChange={() => setAudience("class_offering")}
          />
          One class
        </label>
        {audience === "class_offering" && (
          <select
            name="classOfferingId"
            defaultValue={announcement?.classOfferingId ?? ""}
            className="input mt-2"
          >
            <option value="">Choose a class…</option>
            {offerings.map((offering) => (
              <option key={offering.id} value={offering.id}>
                {offering.name}
              </option>
            ))}
          </select>
        )}
      </fieldset>

      <div>
        <button type="submit" disabled={pending} className="btn btn-solid disabled:opacity-50">
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>

      {state.error && (
        <p role="alert" className="text-sm font-medium text-alarm">
          {state.error}
        </p>
      )}
    </form>
  );
}
```

> `input`, `label`, `btn`, `panel`, `hint`, and `tabular` are existing utility
> classes — see `app/admin/classes/[offeringId]/page.tsx` for them in use. Use
> them rather than writing new Tailwind strings.
>
> This form is hand-rolled rather than built on `AdminForm` because it needs
> client state: the class picker only appears when the audience is a class, and
> `AdminForm` renders its children without any.

- [ ] **Step 7: Write the send panel**

Create `components/announcement-send-panel.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import {
  publishAnnouncementAction,
  sendAnnouncementAction,
  sendRemainingAction,
} from "@/app/admin/announcements/actions";
import { idleState } from "@/lib/action-state";

function OneButton({
  action,
  announcementId,
  label,
  pendingLabel,
}: {
  action: typeof publishAnnouncementAction;
  announcementId: string;
  label: string;
  pendingLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);

  return (
    <form action={formAction}>
      <input type="hidden" name="announcementId" value={announcementId} />
      <button type="submit" disabled={pending} className="btn btn-solid disabled:opacity-50">
        {pending ? pendingLabel : label}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm font-medium text-alarm">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function AnnouncementSendPanel({
  announcementId,
  status,
  emailed,
  /*
   * `queued` and `sending` are separate because only `queued` is resumable.
   * "Send the rest" runs `listQueuedForSource`, which deliberately returns
   * queued rows only — a row stuck in `sending` is recovered from
   * /admin/emails instead, once it is old enough to count as abandoned. Gating
   * the button on queued+sending would show a button that does nothing.
   */
  queued,
  sending,
  recipientCount,
  seasonName,
}: {
  announcementId: string;
  status: "draft" | "published";
  emailed: boolean;
  queued: number;
  sending: number;
  recipientCount: number;
  seasonName: string | null;
}) {
  if (status === "draft") {
    return (
      <div className="panel mt-8 p-5">
        <p className="text-mirror">
          This is a draft. Publishing puts it on the site; sending the email is a
          separate step.
        </p>
        <div className="mt-4">
          <OneButton
            action={publishAnnouncementAction}
            announcementId={announcementId}
            label="Publish"
            pendingLabel="Publishing…"
          />
        </div>
      </div>
    );
  }

  if (!emailed) {
    return (
      <div className="panel mt-8 p-5">
        <p className="text-mirror">
          Published. Sending will email{" "}
          <strong className="text-chalk">
            {recipientCount} {recipientCount === 1 ? "recipient" : "recipients"}
          </strong>
          {seasonName && ` from ${seasonName}`}.
        </p>
        {recipientCount === 0 && (
          <p className="mt-2 text-sm text-alarm">
            Nobody matches this audience right now, so sending would email no one.
          </p>
        )}
        <div className="mt-4">
          <OneButton
            action={sendAnnouncementAction}
            announcementId={announcementId}
            label="Send the email"
            pendingLabel="Queueing…"
          />
        </div>
      </div>
    );
  }

  const waiting = queued + sending;

  return (
    <div className="panel mt-8 p-5">
      <p className="text-mirror">
        {waiting === 0
          ? "Every message has gone out."
          : `${waiting} ${waiting === 1 ? "message is" : "messages are"} still waiting.`}
      </p>

      {queued > 0 && (
        <div className="mt-4">
          <OneButton
            action={sendRemainingAction}
            announcementId={announcementId}
            label="Send the rest"
            pendingLabel="Sending…"
          />
        </div>
      )}

      {queued === 0 && sending > 0 && (
        <p className="hint mt-3">
          {sending === 1 ? "That one is" : "Those are"} mid-send. If{" "}
          {sending === 1 ? "it is" : "they are"} still here in fifteen minutes,{" "}
          {sending === 1 ? "it" : "they"} will appear on the Email page to be
          retried — there is nothing to press here.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Write the three pages**

Create `app/admin/announcements/page.tsx`:

```tsx
import Link from "next/link";
import { db } from "@/db";
import { listAnnouncementsForAdmin } from "@/db/queries/announcements";
import { requireStaff } from "@/lib/guards";

export default async function AdminAnnouncementsPage() {
  await requireStaff();
  const announcements = await listAnnouncementsForAdmin(db);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-chalk">Announcements</h2>
          <p className="hint mt-2">
            Publishing puts an announcement on the site. Emailing it is a
            separate, deliberate step.
          </p>
        </div>
        <Link href="/admin/announcements/new" className="btn btn-solid">
          New announcement
        </Link>
      </div>

      {announcements.length === 0 ? (
        <p className="mt-8 text-mirror">Nothing has been posted yet.</p>
      ) : (
        <ul className="panel mt-8 divide-y divide-barre/25">
          {announcements.map((announcement) => (
            <li key={announcement.id} className="p-5">
              <Link
                href={`/admin/announcements/${announcement.id}`}
                className="font-semibold text-chalk hover:text-maple"
              >
                {announcement.title}
              </Link>
              <p className="mt-1 text-sm text-mirror">
                {announcement.status === "draft" ? "Draft" : "Published"}
                {" · "}
                {announcement.audienceType === "all" ? "Everyone" : "One class"}
                {" · "}
                {announcement.emailedAt ? "Emailed" : "Not emailed"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

Create `app/admin/announcements/new/page.tsx`:

```tsx
import { AnnouncementForm } from "@/components/announcement-form";
import { createAnnouncementAction } from "@/app/admin/announcements/actions";
import { db } from "@/db";
import { listPublishedOfferings } from "@/db/queries/class-offerings";
import { getCurrentSeason } from "@/db/queries/seasons";
import { todayIso } from "@/lib/dates";
import { requireStaff } from "@/lib/guards";

export default async function NewAnnouncementPage() {
  await requireStaff();
  const season = await getCurrentSeason(db, todayIso());
  const offerings = season ? await listPublishedOfferings(db, season.id) : [];

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">New announcement</h2>
      <p className="hint mt-2">
        This saves a draft. Nothing is posted or emailed until you say so.
      </p>
      <AnnouncementForm
        action={createAnnouncementAction}
        offerings={offerings.map((offering) => ({ id: offering.id, name: offering.name }))}
        submitLabel="Save draft"
      />
    </section>
  );
}
```

Create `app/admin/announcements/[announcementId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { AnnouncementForm } from "@/components/announcement-form";
import { AnnouncementSendPanel } from "@/components/announcement-send-panel";
import { updateAnnouncementAction } from "@/app/admin/announcements/actions";
import { db } from "@/db";
import { getAnnouncement } from "@/db/queries/announcements";
import { audienceSeasonId, resolveAnnouncementAudience } from "@/db/queries/audience";
import { listPublishedOfferings } from "@/db/queries/class-offerings";
import { countDeliveriesByStatus } from "@/db/queries/email-deliveries";
import { getSeason } from "@/db/queries/seasons";
import { formatIsoDate, todayIso } from "@/lib/dates";
import { requireStaff } from "@/lib/guards";

export default async function AnnouncementPage({
  params,
}: {
  params: Promise<{ announcementId: string }>;
}) {
  await requireStaff();
  const { announcementId } = await params;
  const announcement = await getAnnouncement(db, announcementId);
  if (!announcement) notFound();

  const today = todayIso();
  const seasonId = await audienceSeasonId(db, today);
  const season = seasonId ? await getSeason(db, seasonId) : null;
  const offerings = seasonId ? await listPublishedOfferings(db, seasonId) : [];

  // Counted only once it has been sent; before that the number that matters is
  // how many it *would* reach.
  const counts = announcement.emailedAt
    ? await countDeliveriesByStatus(db, "announcement", announcement.id)
    : null;
  const recipients = announcement.emailedAt
    ? []
    : await resolveAnnouncementAudience(db, announcement, today);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">{announcement.title}</h2>

      <AnnouncementSendPanel
        announcementId={announcement.id}
        status={announcement.status}
        emailed={announcement.emailedAt !== null}
        queued={counts?.queued ?? 0}
        sending={counts?.sending ?? 0}
        recipientCount={recipients.length}
        seasonName={season?.name ?? null}
      />

      {counts && (
        <dl className="panel mt-6 grid grid-cols-3 gap-4 p-5 text-sm">
          <div>
            <dt className="text-mirror">Sent</dt>
            <dd className="tabular text-lg text-chalk">{counts.sent}</dd>
          </div>
          <div>
            <dt className="text-mirror">Waiting</dt>
            <dd className="tabular text-lg text-chalk">{counts.queued + counts.sending}</dd>
          </div>
          <div>
            <dt className="text-mirror">Failed</dt>
            <dd className="tabular text-lg text-alarm">{counts.failed}</dd>
          </div>
        </dl>
      )}

      {announcement.emailedAt && (
        <p className="hint mt-6">
          Emailed on{" "}
          {formatIsoDate(announcement.emailedAt.toISOString().slice(0, 10))}. Editing
          the text below changes the site, not the messages families already
          received — those said what they said.
        </p>
      )}

      <AnnouncementForm
        action={updateAnnouncementAction}
        offerings={offerings.map((offering) => ({ id: offering.id, name: offering.name }))}
        announcement={{
          id: announcement.id,
          title: announcement.title,
          body: announcement.body,
          audienceType: announcement.audienceType,
          classOfferingId: announcement.classOfferingId,
        }}
        submitLabel="Save changes"
      />
    </section>
  );
}
```

- [ ] **Step 9: Add the nav link**

In `app/admin/layout.tsx`, add one entry to `links`, between Requests and Email:

```ts
  { href: "/admin/announcements", label: "Announcements" },
```

- [ ] **Step 10: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add lib/announcement-validation.ts app/admin components tests/unit/announcement-validation.test.ts
git commit -m "feat: add the admin announcement pages"
```

---

### Task 9: The public and portal surfaces

**Files:**
- Create: `app/(public)/announcements/page.tsx`
- Create: `app/portal/announcements/page.tsx`
- Modify: `app/portal/layout.tsx`
- Modify: `components/site-header.tsx` (the public nav lives here, not in the public layout)

**Interfaces:**
- Consumes: `listPublicAnnouncements`, `listAnnouncementsForFamily` (Task 6); `toParagraphs` (Task 3).

- [ ] **Step 1: Write the public page**

Create `app/(public)/announcements/page.tsx`:

```tsx
import { db } from "@/db";
import { listPublicAnnouncements } from "@/db/queries/announcements";
import { formatIsoDate, todayIso } from "@/lib/dates";
import { toParagraphs } from "@/lib/emails/layout";

// Same cadence as the catalog and the schedule. Publishing revalidates this
// path explicitly, so the interval is a backstop rather than the mechanism.
export const revalidate = 300;

export default async function AnnouncementsPage() {
  const announcements = await listPublicAnnouncements(db);

  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <h1 className="display text-3xl uppercase text-chalk">Studio news</h1>

      {announcements.length === 0 ? (
        <p className="mt-8 text-mirror">Nothing to report just now.</p>
      ) : (
        <ul className="mt-10 flex flex-col gap-12">
          {announcements.map((announcement) => (
            <li key={announcement.id}>
              <h2 className="text-xl font-semibold text-chalk">{announcement.title}</h2>
              <p className="eyebrow mt-2">
                {announcement.publishedAt
                  ? formatIsoDate(announcement.publishedAt.toISOString().slice(0, 10))
                  : formatIsoDate(todayIso())}
              </p>
              {toParagraphs(announcement.body).map((paragraph, index) => (
                <p key={index} className="mt-4 whitespace-pre-line leading-relaxed text-mirror">
                  {paragraph}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

> `whitespace-pre-line` is what keeps a single newline inside a paragraph
> visible, matching what `escapeParagraph` does for the email.

- [ ] **Step 2: Write the portal page**

Create `app/portal/announcements/page.tsx`:

```tsx
import { db } from "@/db";
import { listAnnouncementsForFamily } from "@/db/queries/announcements";
import { toParagraphs } from "@/lib/emails/layout";
import { formatIsoDate } from "@/lib/dates";
import { requireFamilyId } from "@/lib/guards";

export default async function PortalAnnouncementsPage() {
  const familyId = await requireFamilyId();
  const announcements = await listAnnouncementsForFamily(db, familyId);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">Announcements</h2>
      <p className="hint mt-2">
        Studio news, plus anything posted about a class one of your students is
        in.
      </p>

      {announcements.length === 0 ? (
        <p className="mt-8 text-mirror">Nothing to report just now.</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-10">
          {announcements.map((announcement) => (
            <li key={announcement.id}>
              <h3 className="font-semibold text-chalk">{announcement.title}</h3>
              {announcement.publishedAt && (
                <p className="eyebrow mt-1">
                  {formatIsoDate(announcement.publishedAt.toISOString().slice(0, 10))}
                </p>
              )}
              {toParagraphs(announcement.body).map((paragraph, index) => (
                <p key={index} className="mt-3 whitespace-pre-line text-sm leading-relaxed text-mirror">
                  {paragraph}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Link both pages from their navs**

Both navs are a `links` array at the top of their module.

In `app/portal/layout.tsx`, insert one entry before "Back to site":

```ts
const links = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/students", label: "Students" },
  { href: "/portal/enrollments", label: "Classes" },
  { href: "/portal/announcements", label: "Announcements" },
  { href: "/", label: "Back to site" },
];
```

The public nav lives in `components/site-header.tsx`, not in the layout. Insert
one entry after "Schedule":

```ts
const links = [
  { href: "/classes", label: "Classes" },
  { href: "/schedule", label: "Schedule" },
  { href: "/announcements", label: "News" },
  { href: "/staff", label: "Staff" },
  { href: "/contact", label: "Contact" },
];
```

- [ ] **Step 4: Check both pages render**

Run: `npm run build`
Expected: the build lists `/announcements` and `/portal/announcements` among the routes and completes successfully. A page that renders in development but fails to build is not shippable.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add app
git commit -m "feat: show announcements on the site and in the portal"
```

---

### Task 10: Unsubscribe and the portal preference

**Files:**
- Modify: `db/queries/users.ts`
- Create: `app/unsubscribe/page.tsx`
- Create: `app/api/unsubscribe/route.ts`
- Create: `app/portal/preferences/page.tsx`
- Create: `components/broadcast-preference-form.tsx`
- Modify: `app/portal/actions.ts`
- Test: `tests/integration/broadcast-preference.test.ts`

**Interfaces:**
- Consumes: `verifyUnsubscribeToken` (Task 2).
- Produces: `setBroadcastOptOut(db, userId, optedOut: boolean): Promise<boolean>`; `setBroadcastPreferenceAction`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/broadcast-preference.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/broadcast-preference.test.ts`
Expected: FAIL — `setBroadcastOptOut` is not exported.

- [ ] **Step 3: Write the query**

Append to `db/queries/users.ts`:

```ts
import { and, isNull } from "drizzle-orm";

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/broadcast-preference.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Write the POST endpoint**

Create `app/api/unsubscribe/route.ts`:

```ts
import { db } from "@/db";
import { setBroadcastOptOut } from "@/db/queries/users";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

/*
 * The opt-out endpoint. POST only, on purpose.
 *
 * Corporate mail scanners and link prefetchers follow every GET in a message,
 * so a GET that unsubscribes would quietly unsubscribe people who never
 * clicked anything. The footer link points at /unsubscribe, a page; this is
 * where its button — and RFC 8058 one-click, from the List-Unsubscribe-Post
 * header — actually lands.
 *
 * A route handler rather than a server action because it must accept an
 * unauthenticated cross-origin POST from a mailbox provider. The signed token
 * in the query string is the authentication.
 */
function page(message: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Studio news</title></head>` +
      `<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;` +
      `background:#14161a;color:#f2f0ec;padding:48px;line-height:1.6;">` +
      `<p>${message}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("u");
  const userId = token ? verifyUnsubscribeToken(token) : null;

  /*
   * One message for a bad token and for an unknown account. A different
   * response for each would turn this endpoint into an oracle for whether a
   * given token names a live account.
   */
  if (!userId || !(await setBroadcastOptOut(db, userId, true))) {
    return page("That unsubscribe link is not valid. Call the studio and we will sort it out.", 400);
  }

  return page(
    "You have been unsubscribed from studio news. You will still receive messages about your own enrollments and class cancellations.",
    200,
  );
}
```

- [ ] **Step 6: Write the confirmation page**

Create `app/unsubscribe/page.tsx`:

```tsx
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

/*
 * Where the footer link lands. It explains and offers a button; it never opts
 * anybody out by being visited.
 *
 * The form posts to /api/unsubscribe rather than calling a server action:
 * plain, cross-origin-safe, and the same endpoint a mailbox provider's
 * one-click button uses, so there is one code path to get right.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string }>;
}) {
  const { u } = await searchParams;
  const valid = u ? verifyUnsubscribeToken(u) !== null : false;

  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <h1 className="display text-2xl uppercase text-chalk">Studio news</h1>

      {!valid ? (
        <p className="mt-6 text-mirror">
          That unsubscribe link is not valid — it may have been cut short by your
          email program. Call the studio and we will take you off the list.
        </p>
      ) : (
        <>
          <p className="mt-6 text-mirror">
            Press the button and we will stop sending you studio news. You will
            still get messages about your own enrollment requests and about a
            class being cancelled — those are not something we can stop.
          </p>
          <form method="post" action={`/api/unsubscribe?u=${encodeURIComponent(u!)}`} className="mt-8">
            <button type="submit" className="btn btn-solid">
              Unsubscribe from studio news
            </button>
          </form>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Write the portal preference**

Create `components/broadcast-preference-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { setBroadcastPreferenceAction } from "@/app/portal/actions";
import { idleState } from "@/lib/action-state";

export function BroadcastPreferenceForm({ optedOut }: { optedOut: boolean }) {
  const [state, formAction, pending] = useActionState(
    setBroadcastPreferenceAction,
    idleState,
  );

  return (
    <form action={formAction} className="mt-6">
      <input type="hidden" name="subscribe" value={optedOut ? "yes" : "no"} />
      <p className="text-mirror">
        {optedOut
          ? "You are not receiving studio news."
          : "You are receiving studio news."}
      </p>
      <button type="submit" disabled={pending} className="btn btn-solid mt-4 disabled:opacity-50">
        {pending ? "Saving…" : optedOut ? "Start receiving studio news" : "Stop receiving studio news"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm font-medium text-alarm">
          {state.error}
        </p>
      )}
    </form>
  );
}
```

Create `app/portal/preferences/page.tsx`:

```tsx
import { BroadcastPreferenceForm } from "@/components/broadcast-preference-form";
import { db } from "@/db";
import { findUserById } from "@/db/queries/users";
import { requireUser } from "@/lib/guards";

export default async function PreferencesPage() {
  const sessionUser = await requireUser();
  const account = await findUserById(db, sessionUser.id);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">Email preferences</h2>
      <p className="hint mt-2">
        Studio news only. Messages about your own enrollment requests and about a
        cancelled class always go out.
      </p>
      <BroadcastPreferenceForm optedOut={account?.broadcastOptedOutAt != null} />
    </section>
  );
}
```

Add the reader this page needs to `db/queries/users.ts`:

```ts
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
```

And the action, appended to `app/portal/actions.ts`:

```ts
export async function setBroadcastPreferenceAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sessionUser = await requireUser();
  // The form carries the state it wants, not a toggle, so a double submit
  // lands on the same value rather than flipping twice.
  const subscribe = formData.get("subscribe") === "yes";

  const changed = await setBroadcastOptOut(db, sessionUser.id, !subscribe);
  if (!changed) return { error: "We could not save that. Try again." };

  revalidatePath("/portal/preferences");
  return { error: null };
}
```

with the import added at the top of that file:

```ts
import { setBroadcastOptOut } from "@/db/queries/users";
```

- [ ] **Step 8: Link the preferences page**

In `app/portal/layout.tsx`, the `links` array should end up as:

```ts
const links = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/students", label: "Students" },
  { href: "/portal/enrollments", label: "Classes" },
  { href: "/portal/announcements", label: "Announcements" },
  { href: "/portal/preferences", label: "Email" },
  { href: "/", label: "Back to site" },
];
```

- [ ] **Step 9: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add db/queries/users.ts app components tests/integration/broadcast-preference.test.ts
git commit -m "feat: let a family stop receiving studio news"
```

---

### Task 11: Cancelling and restoring an occurrence

**Files:**
- Modify: `db/queries/class-occurrences.ts`
- Modify: `app/admin/actions.ts`
- Modify: `app/admin/classes/[offeringId]/page.tsx`
- Create: `components/cancel-occurrence-form.tsx`
- Test: `tests/integration/occurrence-cancellation.test.ts`

**Interfaces:**
- Consumes: `resolveOccurrenceAudience` (Task 4); `queueDeliveries` (Task 5); `renderClassOccurrenceEmail` (Task 3); `deliverBatchForSource` (Task 7).
- Produces: `listUpcomingOccurrences(db, offeringId, from)`; `cancelOccurrence(db, input)`; `restoreOccurrence(db, input)`; `OccurrenceTransitionResult`; `cancelOccurrenceAction`, `restoreOccurrenceAction`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/occurrence-cancellation.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import {
  cancelOccurrence,
  restoreOccurrence,
  syncOccurrencesForOffering,
} from "@/db/queries/class-occurrences";
import { requestEnrollment } from "@/db/queries/enrollments";
import { markSent } from "@/db/queries/email-deliveries";
import { classOccurrences, emailDeliveries, user } from "@/db/schema";

describe("cancelling and restoring an occurrence", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedRosterOfOne() {
    const seeded = await seedTwoFamilies(db, 5);
    await db
      .insert(user)
      .values({ id: "a1", name: "One", email: "a1@example.com", familyId: seeded.familyA.id });
    const requested = await requestEnrollment(db, seeded.familyA.id, {
      studentId: seeded.studentA.id,
      offeringId: seeded.offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    await db.delete(emailDeliveries);
    await syncOccurrencesForOffering(db, seeded.offering.id);
    const [occurrence] = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.classOfferingId, seeded.offering.id))
      .limit(1);
    return { ...seeded, occurrence: occurrence! };
  }

  function deliveriesFor(occurrenceId: string, template: string) {
    return db
      .select()
      .from(emailDeliveries)
      .where(
        and(eq(emailDeliveries.sourceId, occurrenceId), eq(emailDeliveries.template, template)),
      );
  }

  it("cancels, records the reason, and tells the roster", async () => {
    const { occurrence } = await seedRosterOfOne();

    const result = await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "The instructor is unwell.",
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    const [row] = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.id, occurrence.id));
    expect(row!.status).toBe("cancelled");
    expect(row!.note).toBe("The instructor is unwell.");
    const rows = await deliveriesFor(occurrence.id, "class.cancelled");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe("transactional");
    expect(rows[0]!.bodyText.toLowerCase()).not.toContain("unsubscribe");
  });

  it("refuses to cancel the same occurrence twice", async () => {
    const { occurrence } = await seedRosterOfOne();
    await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Snow.",
      actorUserId: null,
    });

    const second = await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Snow again.",
      actorUserId: null,
    });

    expect(second).toEqual({ ok: false, reason: "not-scheduled" });
    expect(await deliveriesFor(occurrence.id, "class.cancelled")).toHaveLength(1);
  });

  it("restoring before anything was sent deletes the queued mail and says nothing", async () => {
    const { occurrence } = await seedRosterOfOne();
    await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Mistake.",
      actorUserId: null,
    });

    const result = await restoreOccurrence(db, {
      occurrenceId: occurrence.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deliveryIds).toEqual([]);
    expect(await deliveriesFor(occurrence.id, "class.cancelled")).toHaveLength(0);
    expect(await deliveriesFor(occurrence.id, "class.restored")).toHaveLength(0);
    const [row] = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.id, occurrence.id));
    expect(row!.status).toBe("scheduled");
    expect(row!.note).toBeNull();
  });

  it("restoring after the cancellation went out tells exactly those people", async () => {
    const { occurrence } = await seedRosterOfOne();
    const cancelled = await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Mistake.",
      actorUserId: null,
    });
    if (!cancelled.ok) throw new Error("expected the cancellation to succeed");
    await markSent(db, cancelled.deliveryIds[0]!, "capture-1");

    const result = await restoreOccurrence(db, {
      occurrenceId: occurrence.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deliveryIds).toHaveLength(1);
    // The sent cancellation stays on the record — it really was sent.
    expect(await deliveriesFor(occurrence.id, "class.cancelled")).toHaveLength(1);
    const restored = await deliveriesFor(occurrence.id, "class.restored");
    expect(restored).toHaveLength(1);
    expect(restored[0]!.recipientEmail).toBe("a1@example.com");
  });

  it("refuses to restore an occurrence that is not cancelled", async () => {
    const { occurrence } = await seedRosterOfOne();

    expect(
      await restoreOccurrence(db, { occurrenceId: occurrence.id, actorUserId: null }),
    ).toEqual({ ok: false, reason: "not-cancelled" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/occurrence-cancellation.test.ts`
Expected: FAIL — `cancelOccurrence` is not exported.

- [ ] **Step 3: Write the transitions**

Append to `db/queries/class-occurrences.ts`, adding the imports it needs at the top of the file:

```ts
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { classOccurrences, classOfferings, emailDeliveries } from "@/db/schema";
import { renderClassOccurrenceEmail } from "@/lib/emails/class-occurrence";
import { resolveOccurrenceAudience } from "./audience";
import { recordAudit } from "./audit-log";
import { queueDeliveries } from "./email-deliveries";
```

```ts
/** Occurrences from `from` onwards — what staff can still cancel. */
export async function listUpcomingOccurrences(
  db: Database,
  offeringId: string,
  from: string,
): Promise<ClassOccurrence[]> {
  return db
    .select()
    .from(classOccurrences)
    .where(
      and(
        eq(classOccurrences.classOfferingId, offeringId),
        gte(classOccurrences.date, from),
      ),
    )
    .orderBy(asc(classOccurrences.date));
}

export type OccurrenceTransitionResult =
  | { ok: true; occurrence: ClassOccurrence; deliveryIds: string[] }
  | { ok: false; reason: "not-found" | "not-scheduled" | "not-cancelled" };

/** The class details an occurrence email needs, read inside the transaction. */
async function occurrenceEmailData(exec: Transaction, occurrenceId: string) {
  const [row] = await exec
    .select({
      className: classOfferings.name,
      startTime: classOfferings.startTime,
      endTime: classOfferings.endTime,
      date: classOccurrences.date,
    })
    .from(classOccurrences)
    .innerJoin(classOfferings, eq(classOfferings.id, classOccurrences.classOfferingId))
    .where(eq(classOccurrences.id, occurrenceId))
    .limit(1);
  return row ?? null;
}

/**
 * Cancels one dated occurrence and tells the roster.
 *
 * The status predicate makes a double submit harmless: the second call moves
 * zero rows, so nobody is emailed twice about the same cancellation.
 *
 * Transactional mail — every family holding a live seat is told, whatever
 * their broadcast preference says.
 */
export async function cancelOccurrence(
  db: Database,
  input: { occurrenceId: string; reason: string; actorUserId: string | null },
): Promise<OccurrenceTransitionResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.id, input.occurrenceId))
      .limit(1);
    if (!before) return { ok: false, reason: "not-found" } as const;

    const [row] = await tx
      .update(classOccurrences)
      .set({ status: "cancelled", note: input.reason, updatedAt: new Date() })
      .where(
        and(
          eq(classOccurrences.id, input.occurrenceId),
          eq(classOccurrences.status, "scheduled"),
        ),
      )
      .returning();
    if (!row) return { ok: false, reason: "not-scheduled" } as const;

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "occurrence.cancelled",
      entityType: "class_occurrence",
      entityId: row.id,
      before: { status: before.status, note: before.note },
      after: { status: row.status, note: row.note },
    });

    const details = await occurrenceEmailData(tx, row.id);
    if (!details) throw new Error(`cancelOccurrence: ${row.id} lost its offering mid-transaction`);
    const recipients = await resolveOccurrenceAudience(tx, row.id);

    const deliveryIds = await queueDeliveries(tx, {
      sourceType: "class_occurrence",
      sourceId: row.id,
      template: "class.cancelled",
      category: "transactional",
      recipients,
      render: () => renderClassOccurrenceEmail("class.cancelled", { ...details, reason: input.reason }),
    });

    return { ok: true, occurrence: row, deliveryIds } as const;
  });
}

/**
 * Puts a cancelled occurrence back, and corrects the record for whoever was
 * told otherwise.
 *
 * Cancellation rows still `queued` are deleted: they describe a message that
 * was never sent and now must never be sent, and the audit log keeps both the
 * cancellation and this restoration, so no history is lost. A row in `sending`
 * is left alone — it may already be with the provider — and its recipient is
 * treated as having been told.
 *
 * The effect is that a cancel-then-undo within seconds is silent, while a real
 * reinstatement reaches exactly the people who were misinformed.
 */
export async function restoreOccurrence(
  db: Database,
  input: { occurrenceId: string; actorUserId: string | null },
): Promise<OccurrenceTransitionResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.id, input.occurrenceId))
      .limit(1);
    if (!before) return { ok: false, reason: "not-found" } as const;

    const [row] = await tx
      .update(classOccurrences)
      .set({ status: "scheduled", note: null, updatedAt: new Date() })
      .where(
        and(
          eq(classOccurrences.id, input.occurrenceId),
          eq(classOccurrences.status, "cancelled"),
        ),
      )
      .returning();
    if (!row) return { ok: false, reason: "not-cancelled" } as const;

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "occurrence.restored",
      entityType: "class_occurrence",
      entityId: row.id,
      before: { status: before.status, note: before.note },
      after: { status: row.status, note: row.note },
    });

    // Never sent, so never send it.
    await tx
      .delete(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.sourceType, "class_occurrence"),
          eq(emailDeliveries.sourceId, row.id),
          eq(emailDeliveries.template, "class.cancelled"),
          eq(emailDeliveries.status, "queued"),
        ),
      );

    // Whoever actually heard the cancellation — or may be hearing it right now.
    const told = await tx
      .select({
        userId: emailDeliveries.recipientUserId,
        email: emailDeliveries.recipientEmail,
      })
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.sourceType, "class_occurrence"),
          eq(emailDeliveries.sourceId, row.id),
          eq(emailDeliveries.template, "class.cancelled"),
          inArray(emailDeliveries.status, ["sent", "sending"]),
        ),
      );

    const recipients = told
      .filter((r): r is { userId: string; email: string } => r.userId !== null)
      .map((r) => ({ userId: r.userId, email: r.email }));

    if (recipients.length === 0) {
      return { ok: true, occurrence: row, deliveryIds: [] } as const;
    }

    const details = await occurrenceEmailData(tx, row.id);
    if (!details) throw new Error(`restoreOccurrence: ${row.id} lost its offering mid-transaction`);

    const deliveryIds = await queueDeliveries(tx, {
      sourceType: "class_occurrence",
      sourceId: row.id,
      template: "class.restored",
      category: "transactional",
      recipients,
      render: () => renderClassOccurrenceEmail("class.restored", { ...details, reason: null }),
    });

    return { ok: true, occurrence: row, deliveryIds } as const;
  });
}
```

> `Transaction` comes from `./executor`; add it to that file's type import if it
> is not already there.

- [ ] **Step 3a: Clear the dead `dayOfWeek` field and close two test gaps**

Task 3's review found that `ClassOccurrenceEmailData.dayOfWeek` is declared and
never read — `formatIsoDate` already yields the weekday, so `whenLine` gets
"Monday, 12 October 2026" without it. This task is its only consumer, so retire
it here rather than letting a later reader assume it matters:

- In `lib/emails/class-occurrence.ts`, delete the `dayOfWeek: DayOfWeek;` field
  from `ClassOccurrenceEmailData`, and delete the now-unused
  `import type { DayOfWeek } from "@/db/schema";`.
- In `tests/unit/broadcast-emails.test.ts`, delete `dayOfWeek` from the
  `occurrence` fixture.
- `occurrenceEmailData` above already does not select it.

Then add the two assertions that review also asked for, to
`tests/unit/broadcast-emails.test.ts`:

```ts
  it("escapes a staff-written reason on its way into the HTML part", () => {
    const rendered = renderClassOccurrenceEmail("class.cancelled", {
      ...occurrence,
      reason: "Burst pipe <script>alert(1)</script> in Studio B & the hall.",
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("&amp; the hall.");
  });

  it("mentions no money in the HTML part either", () => {
    for (const template of ["class.cancelled", "class.restored"] as const) {
      const rendered = renderClassOccurrenceEmail(template, occurrence);
      for (const word of ["$", "refund", "credit", "make-up", "makeup"]) {
        expect(rendered.html.toLowerCase()).not.toContain(word);
      }
    }
  });
```

The `reason` field is staff-authored free text that lands in markup, so it
deserves the same injection test the announcement body already has.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/occurrence-cancellation.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Write the actions**

Append to `app/admin/actions.ts`, with the imports it needs:

```ts
import { cancelOccurrence, restoreOccurrence } from "@/db/queries/class-occurrences";
import { deliverBatchForSource } from "@/lib/notifications/deliver";
import { occurrenceCancelSchema, occurrenceIdSchema } from "@/lib/admin-validation";
```

```ts
export async function cancelOccurrenceAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const parsed = occurrenceCancelSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const result = await cancelOccurrence(db, {
    occurrenceId: parsed.data.occurrenceId,
    reason: parsed.data.reason,
    actorUserId: staff.id,
  });
  if (!result.ok) {
    return {
      error:
        result.reason === "not-found"
          ? "That class date no longer exists."
          : "That date is already cancelled.",
    };
  }

  // A roster cannot exceed capacity, so one batch always covers it — but it
  // goes through the same paced runner as a fan-out.
  after(() =>
    deliverBatchForSource(db, {
      sourceType: "class_occurrence",
      sourceId: parsed.data.occurrenceId,
    }),
  );

  revalidatePath(`/admin/classes/${parsed.data.offeringId}`);
  revalidatePath("/schedule");
  return { error: null };
}

export async function restoreOccurrenceAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const parsed = occurrenceIdSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const result = await restoreOccurrence(db, {
    occurrenceId: parsed.data.occurrenceId,
    actorUserId: staff.id,
  });
  if (!result.ok) {
    return {
      error:
        result.reason === "not-found"
          ? "That class date no longer exists."
          : "That date is not cancelled.",
    };
  }

  if (result.deliveryIds.length > 0) {
    after(() =>
      deliverBatchForSource(db, {
        sourceType: "class_occurrence",
        sourceId: parsed.data.occurrenceId,
      }),
    );
  }

  revalidatePath(`/admin/classes/${parsed.data.offeringId}`);
  revalidatePath("/schedule");
  return { error: null };
}
```

Add the two schemas to `lib/admin-validation.ts`:

```ts
export const occurrenceIdSchema = z.object({
  occurrenceId: z.uuid(),
  offeringId: z.uuid(),
});

export const occurrenceCancelSchema = occurrenceIdSchema.extend({
  reason: z
    .string()
    .trim()
    .min(1, "Say why the class is cancelled — families will read this.")
    .max(500),
});
```

- [ ] **Step 6: Write the form component**

Create `components/cancel-occurrence-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { cancelOccurrenceAction, restoreOccurrenceAction } from "@/app/admin/actions";
import { idleState } from "@/lib/action-state";

export function CancelOccurrenceForm({
  occurrenceId,
  offeringId,
  date,
  cancelled,
  note,
}: {
  occurrenceId: string;
  offeringId: string;
  date: string;
  cancelled: boolean;
  note: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    cancelled ? restoreOccurrenceAction : cancelOccurrenceAction,
    idleState,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="occurrenceId" value={occurrenceId} />
      <input type="hidden" name="offeringId" value={offeringId} />

      {cancelled ? (
        <p className="text-sm text-alarm">Cancelled{note ? ` — ${note}` : ""}</p>
      ) : (
        <label className="flex flex-1 flex-col gap-1">
          <span className="sr-only">Why is {date} cancelled?</span>
          <input
            name="reason"
            required
            maxLength={500}
            placeholder="Why? Families will read this."
            className="input text-sm"
          />
        </label>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-ghost min-h-0 py-1.5 text-sm disabled:opacity-50"
      >
        {pending ? "Saving…" : cancelled ? "Put it back" : "Cancel this date"}
      </button>

      {state.error && (
        <p role="alert" className="w-full text-sm font-medium text-alarm">
          {state.error}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 7: Show upcoming occurrences on the class page**

In `app/admin/classes/[offeringId]/page.tsx`, read the upcoming occurrences and render one row each. Add to the imports:

```tsx
import { CancelOccurrenceForm } from "@/components/cancel-occurrence-form";
import { listUpcomingOccurrences } from "@/db/queries/class-occurrences";
import { formatIsoDate, todayIso } from "@/lib/dates";
```

and add this section to the page body, after whatever it already renders:

```tsx
      <div className="mt-12">
        <h3 className="text-lg font-semibold text-chalk">Upcoming dates</h3>
        <p className="hint mt-2">
          Cancelling a date emails every family holding a seat in this class.
          Putting it back tells whoever already heard.
        </p>

        {occurrences.length === 0 ? (
          <p className="mt-6 text-mirror">No dates left this season.</p>
        ) : (
          <ul className="panel mt-6 divide-y divide-barre/25">
            {occurrences.map((occurrence) => (
              <li key={occurrence.id} className="flex flex-wrap items-center gap-4 p-4">
                <span className="tabular w-56 text-sm text-chalk">
                  {formatIsoDate(occurrence.date)}
                </span>
                <div className="flex-1">
                  <CancelOccurrenceForm
                    occurrenceId={occurrence.id}
                    offeringId={offering.id}
                    date={formatIsoDate(occurrence.date)}
                    cancelled={occurrence.status === "cancelled"}
                    note={occurrence.note}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
```

reading them alongside the page's existing queries, immediately after the
`listRoster` call:

```tsx
  const roster = await listRoster(db, offering.id);
  const occurrences = await listUpcomingOccurrences(db, offering.id, todayIso());
```

The page already has both `offering` and `offeringId` in scope, so the snippet
above drops in unchanged. Put the new section between the Roster list and the
"Edit class" heading — a date is a thing staff act on, and the long edit form
should not sit between them and it.

- [ ] **Step 8: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add db/queries/class-occurrences.ts lib/admin-validation.ts app components tests/integration/occurrence-cancellation.test.ts
git commit -m "feat: cancel and restore a class date"
```

---

### Task 12: End-to-end coverage

**Files:**
- Modify: `e2e/fixtures/seed.ts`
- Create: `e2e/announcements.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `deliveriesForSource(sourceType, sourceId)`; `latestAnnouncementId()`.

- [ ] **Step 1: Add the seed helpers**

Append to `e2e/fixtures/seed.ts`, adding `announcements` to its schema imports:

```ts
/** Every delivery row belonging to one source, oldest first. */
export async function deliveriesForSource(sourceType: "announcement" | "class_occurrence", sourceId: string) {
  return withDb((db) =>
    db
      .select()
      .from(emailDeliveries)
      .where(
        and(eq(emailDeliveries.sourceType, sourceType), eq(emailDeliveries.sourceId, sourceId)),
      )
      .orderBy(asc(emailDeliveries.createdAt), asc(emailDeliveries.id)),
  );
}

/** The most recently created announcement, which is the one the test just made. */
export async function latestAnnouncementId(): Promise<string> {
  return withDb(async (db) => {
    const [row] = await db
      .select({ id: announcements.id })
      .from(announcements)
      .orderBy(desc(announcements.createdAt))
      .limit(1);
    if (!row) throw new Error("no announcement found");
    return row.id;
  });
}
```

with `and` added to the `drizzle-orm` import at the top of the file.

- [ ] **Step 2: Write the spec**

Create `e2e/announcements.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import {
  deliveriesForSource,
  latestAnnouncementId,
  promoteToStaff,
  seedOpenSeasonWithClass,
} from "./fixtures/seed";

const PASSWORD = "correct-horse-battery";

/*
 * One thread: a parent enrols, staff post and send an announcement, the parent
 * reads it and unsubscribes, and the next announcement skips them. Serial,
 * because each scenario builds on the last.
 */
test.describe.configure({ mode: "serial" });

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify$/);
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in$/);
}

test.describe("announcements", () => {
  const stamp = Date.now();
  const parentEmail = `parent-news-${stamp}@example.com`;
  const staffEmail = `staff-news-${stamp}@example.com`;
  let className: string;

  test("a parent takes a seat so they have an audience to be in", async ({ page }) => {
    const seeded = await seedOpenSeasonWithClass(10);
    className = seeded.className;

    await signUp(page, "News Parent", parentEmail);
    await signIn(page, parentEmail);
    await page.goto("/portal/students/new");
    await page.getByLabel("First name").fill("Nina");
    await page.getByLabel("Last name").fill("News");
    await page.getByLabel("Date of birth").fill("2015-05-05");
    // "Save student" — the label app/portal/students/new/page.tsx passes to
    // StudentForm. Not "Add student"; check the component before changing it.
    await page.getByRole("button", { name: "Save student" }).click();

    await page.goto("/portal");
    const cell = page
      .locator("div")
      .filter({ has: page.getByRole("heading", { name: className }) })
      .last();
    await cell.getByRole("button", { name: "Request seat" }).click();
    await expect(page.getByText(/seat is held|request/i).first()).toBeVisible();
  });

  test("staff draft, publish and send an announcement", async ({ browser }) => {
    /*
     * Sign the staff account up in a throwaway context and close it. Signing
     * up leaves the browser holding a parent session; the staff work below
     * needs a context that was signed in AFTER the role was promoted, because
     * the session cookie carries the role.
     */
    const signUpContext = await browser.newContext();
    await signUp(await signUpContext.newPage(), "News Staff", staffEmail);
    await signUpContext.close();
    await promoteToStaff(staffEmail);

    const context = await browser.newContext();
    const staff = await context.newPage();
    await signIn(staff, staffEmail);

    await staff.goto("/admin/announcements/new");
    await staff.getByLabel("Title").fill("Recital tickets");
    await staff.getByLabel("Body").fill("Tickets are at the desk.\n\nBring exact change.");
    await staff.getByRole("button", { name: "Save draft" }).click();

    // Publishing puts it on the site and sends nothing.
    await staff.getByRole("button", { name: "Publish" }).click();
    const announcementId = await latestAnnouncementId();
    expect(await deliveriesForSource("announcement", announcementId)).toHaveLength(0);

    await staff.getByRole("button", { name: "Send the email" }).click();
    await expect(staff.getByText(/Every message has gone out|still waiting/)).toBeVisible();

    await expect
      .poll(async () => {
        const rows = await deliveriesForSource("announcement", announcementId);
        return rows.map((row) => `${row.recipientEmail}:${row.status}`);
      })
      .toEqual([`${parentEmail}:sent`]);

    await context.close();
  });

  test("the announcement is on the public page and in the portal", async ({ page }) => {
    await page.goto("/announcements");
    await expect(page.getByRole("heading", { name: "Recital tickets" })).toBeVisible();
    await expect(page.getByText("Bring exact change.")).toBeVisible();

    await signIn(page, parentEmail);
    await page.goto("/portal/announcements");
    await expect(page.getByRole("heading", { name: "Recital tickets" })).toBeVisible();
  });

  test("the parent unsubscribes and the next announcement skips them", async ({ page, browser }) => {
    const announcementId = await latestAnnouncementId();
    const [delivery] = await deliveriesForSource("announcement", announcementId);
    const link = delivery!.bodyText.match(/http:\/\/[^\s]*\/unsubscribe\?u=[^\s]+/)?.[0];
    expect(link, "the broadcast body must carry an unsubscribe link").toBeTruthy();

    await page.goto(link!);
    await page.getByRole("button", { name: "Unsubscribe from studio news" }).click();
    await expect(page.getByText(/unsubscribed from studio news/i)).toBeVisible();

    const context = await browser.newContext();
    const staff = await context.newPage();
    await signIn(staff, staffEmail);
    await staff.goto("/admin/announcements/new");
    await staff.getByLabel("Title").fill("Second notice");
    await staff.getByLabel("Body").fill("This one should reach nobody.");
    await staff.getByRole("button", { name: "Save draft" }).click();
    await staff.getByRole("button", { name: "Publish" }).click();

    // The panel names the count before anything goes out — and it is zero.
    await expect(staff.getByText(/0 recipients|Nobody matches this audience/)).toBeVisible();

    const second = await latestAnnouncementId();
    await staff.getByRole("button", { name: "Send the email" }).click();
    expect(await deliveriesForSource("announcement", second)).toHaveLength(0);

    await context.close();
  });

  test("cancelling a date still reaches the unsubscribed parent", async ({ browser }) => {
    const context = await browser.newContext();
    const staff = await context.newPage();
    await signIn(staff, staffEmail);

    await staff.goto("/admin/classes");
    await staff.getByRole("link", { name: className }).click();
    const firstDate = staff.locator("li").filter({ hasText: "Cancel this date" }).first();
    await firstDate.getByPlaceholder("Why? Families will read this.").fill("The instructor is unwell.");
    await firstDate.getByRole("button", { name: "Cancel this date" }).click();

    await expect(staff.getByText("Cancelled — The instructor is unwell.")).toBeVisible();

    /*
     * The assertion this test is actually named for. The parent unsubscribed
     * from studio news in the previous scenario, and a cancellation is
     * transactional — it must reach them anyway. Checking only that the admin
     * page says "Cancelled" would pass even if the roster were never told,
     * which is the failure that matters here.
     */
    const occurrenceId = await cancelledOccurrenceIdFor(className);
    await expect
      .poll(async () => {
        const rows = await deliveriesForSource("class_occurrence", occurrenceId);
        return rows.map((row) => `${row.recipientEmail}:${row.template}:${row.status}`);
      })
      .toEqual([`${parentEmail}:class.cancelled:sent`]);

    // And it carries no way to opt out of it.
    const [delivery] = await deliveriesForSource("class_occurrence", occurrenceId);
    expect(delivery!.category).toBe("transactional");
    expect(delivery!.bodyText.toLowerCase()).not.toContain("unsubscribe");
    expect(delivery!.bodyHtml.toLowerCase()).not.toContain("unsubscribe");

    await context.close();
  });
});
```

That needs one more seed helper. Append it to `e2e/fixtures/seed.ts`, beside
the others:

```ts
/** The cancelled occurrence of a class, by the class's name. */
export async function cancelledOccurrenceIdFor(className: string): Promise<string> {
  return withDb(async (db) => {
    const [row] = await db
      .select({ id: classOccurrences.id })
      .from(classOccurrences)
      .innerJoin(classOfferings, eq(classOfferings.id, classOccurrences.classOfferingId))
      .where(
        and(eq(classOfferings.name, className), eq(classOccurrences.status, "cancelled")),
      )
      .orderBy(asc(classOccurrences.date))
      .limit(1);
    if (!row) throw new Error(`no cancelled occurrence found for ${className}`);
    return row.id;
  });
}
```

with `classOccurrences` added to that file's existing `@/db/schema` import.

- [ ] **Step 3: Run the e2e suite**

Run: `npm run test:e2e`
Expected: the existing eight scenarios plus these five, all passing. Stop any `npm run dev` first — Next refuses a second development server in one directory — and run `npm test` at least once on a cold test database so the migrations are applied.

- [ ] **Step 4: Verify no test reached the real provider**

Run:

```bash
psql "$TEST_DATABASE_URL" -c "SELECT provider_message_id FROM email_deliveries WHERE provider_message_id IS NOT NULL LIMIT 10;"
```

Expected: every id begins with `capture-`. Anything else means a suite reached Resend, which is a bug in the environment, not in the test.

- [ ] **Step 5: Run everything and commit**

```bash
npm test && npm run typecheck && npm run build && npm run test:e2e
git add e2e
git commit -m "test: cover announcements and unsubscribe end to end"
```

---

## Phase 3b completion checklist

Confirm each by running the command and reading the output — not by assuming:

- [ ] `npm run typecheck` passes with no errors
- [ ] `npm test` passes every unit and integration suite
- [ ] `npm run test:e2e` passes every scenario
- [ ] `npm run build` completes successfully
- [ ] Publishing an announcement posts it and queues no email
- [ ] Two concurrent Sends on one announcement queue exactly one set of rows
- [ ] A batch limit leaves the remainder `queued`, and "Send the rest" sends it
- [ ] A rate-limited send leaves its row `queued`, not `failed`
- [ ] An opted-out login receives no announcement and still receives a cancellation
- [ ] A family with two logins gets two rows, each with its own unsubscribe link
- [ ] Visiting an unsubscribe link does **not** opt anyone out; pressing the button does
- [ ] Broadcast mail carries `List-Unsubscribe`; transactional mail carries neither header nor link
- [ ] A class-targeted announcement never appears on the public page
- [ ] Cancelling a date emails the roster; restoring before the mail went out emails nobody
- [ ] Restoring after the cancellation was sent emails exactly the people who received it
- [ ] No cancellation email mentions a refund, a credit, or a make-up class
- [ ] No test run reached the real provider — every `provider_message_id` starts with `capture-`

## What Phase 3b deliberately does not do

**No provider webhooks.** Bounces and complaints are Phase 3c.

**No scheduled or delayed sends.** Nothing sweeps on a timer; a person presses a button.

**No markdown, no per-class preference granularity, no unpublish, no SMS.** See §12 of the design for why each is out.
