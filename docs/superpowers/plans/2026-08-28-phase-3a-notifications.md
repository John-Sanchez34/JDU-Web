# Phase 3a — Enrollment Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a family three transactional emails as their enrollment request moves through its lifecycle, recording every send as its own row so a failure can be seen and retried.

**Architecture:** Each of the three enrollment transitions writes one `email_deliveries` row per parent login inside the same transaction that changes the enrollment's status, so a rolled-back transition can never be emailed about. The server action then hands those row IDs to Next's `after()`, which claims each row with a conditional UPDATE, sends it through Resend, and marks it `sent` or `failed`. A parent never waits on the provider, and anything that fails surfaces on an admin page with a Retry button.

**Tech Stack:** Next.js 16.3.1 (App Router, server actions, `after` from `next/server`), Drizzle ORM on Postgres, Resend, Zod, Vitest (unit + integration), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-28-phase-3a-notifications-design.md`

## Global Constraints

- **No money moves through this site.** Every email that mentions price says payment happens at the studio in person.
- **Every monetary amount is an integer count of cents.** Format with `formatCents` from `@/lib/format` at the display boundary only. Never use floating point for money.
- **Transactional email carries no unsubscribe link.** All three emails in this phase are transactional.
- **No scheduled jobs.** Nothing sweeps for failures on a timer; a person presses Retry.
- **Query functions that may run inside a transaction take `Executor`** (`@/db/queries/executor`), not `Database`. Existing query modules declare their own local `Database` alias; leave those alone.
- **A `"use server"` module may only export async functions.** Shared constants and types live in a plain module and are imported.
- **`lib/env.ts` is server-only.** Importing it from client code leaks secrets into the browser bundle.
- Tests run against `TEST_DATABASE_URL`, which the harness truncates. It must differ from `DATABASE_URL`.

## File structure

| File | Responsibility |
|---|---|
| `db/schema/email-deliveries.ts` | The table, its three enums, and its indexes |
| `lib/emails/layout.ts` | HTML escaping and the shared HTML shell |
| `lib/emails/enrollment.ts` | Pure render of the three enrollment emails |
| `lib/email.ts` (modify) | Transport: Resend or the capture transport, returning a provider id |
| `db/queries/email-deliveries.ts` | Queue rows, claim one for send, mark sent/failed, list retriable |
| `db/queries/enrollments.ts` (modify) | The three transitions queue their deliveries in-transaction |
| `lib/notifications/deliver.ts` | Claim → send → mark, for a list of delivery IDs |
| `app/portal/actions.ts` (modify) | Hands request-email IDs to `after()` |
| `app/admin/actions.ts` (modify) | Hands confirm/release IDs to `after()`; the Retry action |
| `app/admin/emails/page.tsx` | The retriable-deliveries page |
| `components/retry-delivery-button.tsx` | Client form for one Retry |

---

### Task 1: The `email_deliveries` schema

**Files:**
- Create: `db/schema/email-deliveries.ts`
- Modify: `db/schema/index.ts`
- Create: `drizzle/0005_*.sql` (generated)
- Test: `tests/integration/email-deliveries-schema.test.ts`

**Interfaces:**
- Produces: `emailDeliveries` table; `emailDeliveryStatusEnum`, `emailCategoryEnum`, `emailSourceTypeEnum`; types `EmailDelivery`, `EmailDeliveryStatus`, `EmailCategory`, `EmailSourceType`.

- [ ] **Step 1: Write the schema module**

Create `db/schema/email-deliveries.ts`:

```ts
import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", [
  "queued",
  "sending",
  "sent",
  "failed",
]);

export type EmailDeliveryStatus = (typeof emailDeliveryStatusEnum.enumValues)[number];

export const emailCategoryEnum = pgEnum("email_category", [
  "transactional",
  "broadcast",
]);

export type EmailCategory = (typeof emailCategoryEnum.enumValues)[number];

/*
 * Polymorphic, like `audit_log`: Phase 3a only ever writes "enrollment", but
 * announcements and class cancellations are the reason the column exists at
 * all rather than a foreign key to `enrollments`.
 */
export const emailSourceTypeEnum = pgEnum("email_source_type", [
  "enrollment",
  "announcement",
  "class_occurrence",
]);

export type EmailSourceType = (typeof emailSourceTypeEnum.enumValues)[number];

export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: emailSourceTypeEnum("source_type").notNull(),
    // text, not uuid: the same polymorphic-reference reasoning as
    // `audit_log.entity_id`, where a source may one day be a text user id.
    sourceId: text("source_id").notNull(),
    template: text("template").notNull(),
    category: emailCategoryEnum("category").notNull(),
    // "set null", never cascade: a delivery row must stay readable after the
    // account it went to is deleted. The address it went to is on the row.
    recipientUserId: text("recipient_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    recipientEmail: text("recipient_email").notNull(),
    /*
     * The rendered message is stored, not re-derived. A retry then resends
     * exactly what was promised rather than re-rendering against a class whose
     * price may have changed in between.
     */
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html").notNull(),
    status: emailDeliveryStatusEnum("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The retry page reads by status.
    index("email_deliveries_status_idx").on(table.status),
    // Every delivery belonging to one enrollment.
    index("email_deliveries_source_idx").on(table.sourceType, table.sourceId),
  ],
);

export type EmailDelivery = typeof emailDeliveries.$inferSelect;
```

- [ ] **Step 2: Re-export it**

Append to `db/schema/index.ts`:

```ts
export * from "./email-deliveries";
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0005_*.sql` creating three enums and the table. Read it before continuing — it must contain `CREATE TYPE "public"."email_delivery_status"`, `CREATE TABLE "email_deliveries"`, and both `CREATE INDEX` statements.

- [ ] **Step 4: Apply the migration**

Run: `npm run db:migrate`
Expected: applied with no error.

- [ ] **Step 5: Write the constraint tests**

Create `tests/integration/email-deliveries-schema.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { emailDeliveries, families, user } from "@/db/schema";

describe("email_deliveries", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  const row = {
    sourceType: "enrollment" as const,
    sourceId: "11111111-1111-1111-1111-111111111111",
    template: "enrollment.requested",
    category: "transactional" as const,
    recipientEmail: "parent@example.com",
    subject: "Your seat is held",
    bodyText: "text body",
    bodyHtml: "<p>html body</p>",
  };

  it("defaults a new row to queued with no attempts", async () => {
    const [created] = await db.insert(emailDeliveries).values(row).returning();

    expect(created!.status).toBe("queued");
    expect(created!.attempts).toBe(0);
    expect(created!.sentAt).toBeNull();
    expect(created!.providerMessageId).toBeNull();
  });

  it("keeps the row when the recipient account is deleted", async () => {
    const [family] = await db.insert(families).values({ name: "Alvarez" }).returning();
    await db.insert(user).values({
      id: "user-1",
      name: "Ana Alvarez",
      email: "ana@example.com",
      familyId: family!.id,
    });
    const [created] = await db
      .insert(emailDeliveries)
      .values({ ...row, recipientUserId: "user-1" })
      .returning();

    await db.delete(user).where(eq(user.id, "user-1"));

    const [after] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, created!.id));
    // The account is gone; the record of what was sent to it is not.
    expect(after!.recipientUserId).toBeNull();
    expect(after!.recipientEmail).toBe("parent@example.com");
  });

  it("rejects a status outside the enum", async () => {
    await expect(
      db.insert(emailDeliveries).values({ ...row, status: "delivered" as never }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/integration/email-deliveries-schema.test.ts`
Expected: 3 passed.

- [ ] **Step 7: Run the full suite and commit**

```bash
npm test && npm run typecheck
git add db/schema drizzle tests/integration/email-deliveries-schema.test.ts
git commit -m "feat: add the email deliveries schema"
```

---

### Task 2: The transport seam

`lib/email.ts` currently sends text only, returns nothing, and constructs its
Resend client at module load. This task gives it an HTML part, a provider
message id, and a capture transport the test suites select by environment
variable — the same mechanism `E2E_SKIP_EMAIL_VERIFICATION` already uses.

**Files:**
- Modify: `lib/email.ts`
- Modify: `tests/setup/env.ts`
- Modify: `playwright.config.ts`
- Modify: `.env.example`
- Test: `tests/unit/email-transport.test.ts`

**Interfaces:**
- Consumes: `env` from `@/lib/env`.
- Produces: `sendEmail(message: EmailMessage): Promise<SendResult>` where `EmailMessage = { to: string; subject: string; text: string; html?: string }` and `SendResult = { providerMessageId: string | null }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/email-transport.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sendEmail } from "@/lib/email";

describe("sendEmail with the capture transport", () => {
  const original = process.env.EMAIL_TRANSPORT;

  beforeEach(() => {
    process.env.EMAIL_TRANSPORT = "capture";
  });

  afterEach(() => {
    process.env.EMAIL_TRANSPORT = original;
  });

  it("returns a synthetic provider id without calling the provider", async () => {
    const result = await sendEmail({
      to: "parent@example.com",
      subject: "Your seat is held",
      text: "text body",
      html: "<p>html body</p>",
    });

    expect(result.providerMessageId).toMatch(/^capture-/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/email-transport.test.ts`
Expected: FAIL — `sendEmail` returns `undefined`, so reading `.providerMessageId` throws.

- [ ] **Step 3: Rewrite the module**

Replace the whole of `lib/email.ts`:

```ts
import { Resend } from "resend";
import { env } from "@/lib/env";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type SendResult = { providerMessageId: string | null };

/*
 * Constructed lazily rather than at module load, so the capture transport
 * never needs a usable API key and importing this module stays cheap.
 */
let resend: Resend | undefined;

function client(): Resend {
  resend ??= new Resend(env.RESEND_API_KEY);
  return resend;
}

/** True when this process must not reach the real provider. */
function capturing(): boolean {
  return process.env.EMAIL_TRANSPORT === "capture";
}

/**
 * Sends one transactional email.
 *
 * Failures are logged and rethrown — the caller decides whether a send failure
 * should fail the surrounding operation. In this system the caller is always
 * the delivery runner, which records the failure on the delivery row.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  if (capturing()) {
    // Deliberately not stored anywhere: the tests that care assert against the
    // delivery row, and holding messages in memory would leak across a run.
    return { providerMessageId: `capture-${crypto.randomUUID()}` };
  }

  const { data, error } = await client().emails.send({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });

  if (error) {
    console.error("sendEmail failed", { to: message.to, error });
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return { providerMessageId: data?.id ?? null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/email-transport.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Point both test suites at the capture transport**

Append to `tests/setup/env.ts`:

```ts
// Integration tests exercise the delivery runner end to end. Nothing in a test
// run may reach the real provider, so the transport is pinned here rather than
// left to whatever `.env` happens to contain.
process.env.EMAIL_TRANSPORT = "capture";
```

In `playwright.config.ts`, add to the `webServer.env` object, beside
`E2E_SKIP_EMAIL_VERIFICATION`:

```ts
      EMAIL_TRANSPORT: "capture",
```

Append to `.env.example`:

```
# Set only by the test suites. "capture" short-circuits sending and returns a
# synthetic message id, so no test can reach the real provider.
# EMAIL_TRANSPORT=capture
```

- [ ] **Step 6: Run the full suite and commit**

```bash
npm test && npm run typecheck
git add lib/email.ts tests/setup/env.ts tests/unit/email-transport.test.ts playwright.config.ts .env.example
git commit -m "feat: add an html part, a provider id, and a capture transport"
```

---

### Task 3: Rendering the three emails

Pure functions of typed data — no database, no clock — so the wording is
testable without a transaction.

**Files:**
- Create: `lib/emails/layout.ts`
- Create: `lib/emails/enrollment.ts`
- Test: `tests/unit/enrollment-emails.test.ts`

**Interfaces:**
- Consumes: `formatCents`, `formatTimeRange` from `@/lib/format`; `formatDayOfWeek` from `@/lib/dates`; `DayOfWeek` from `@/db/schema`.
- Produces: `escapeHtml(value: string): string`; `wrapHtml(heading: string, paragraphs: string[]): string`; `EnrollmentEmailTemplate`, `EnrollmentEmailData`, `RenderedEmail`, and `renderEnrollmentEmail(template, data): RenderedEmail`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/enrollment-emails.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { escapeHtml } from "@/lib/emails/layout";
import {
  renderEnrollmentEmail,
  type EnrollmentEmailData,
} from "@/lib/emails/enrollment";

const data: EnrollmentEmailData = {
  studentFirstName: "Lucia",
  studentLastName: "Vasquez",
  className: "Ballet I",
  dayOfWeek: "monday",
  startTime: "16:00:00",
  endTime: "17:00:00",
  monthlyPriceCents: 6500,
  seasonFeeCents: 5000,
};

describe("escapeHtml", () => {
  it("neutralizes markup in a name", () => {
    expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });
});

describe("renderEnrollmentEmail", () => {
  it("states both amounts and the pay-in-person rule when a seat is requested", () => {
    const email = renderEnrollmentEmail("enrollment.requested", data);

    expect(email.subject).toContain("Ballet I");
    expect(email.text).toContain("Lucia");
    expect(email.text).toContain("$65.00");
    expect(email.text).toContain("$50.00");
    expect(email.text).toContain("at the studio");
  });

  it("omits the season fee when there is none", () => {
    const email = renderEnrollmentEmail("enrollment.requested", {
      ...data,
      seasonFeeCents: 0,
    });

    expect(email.text).toContain("$65.00");
    expect(email.text).not.toContain("season fee");
  });

  it("tells a family the seat is theirs when confirmed", () => {
    const email = renderEnrollmentEmail("enrollment.confirmed", data);

    expect(email.subject).toContain("Ballet I");
    expect(email.text).toContain("enrolled");
  });

  it("tells a family the hold is gone when released", () => {
    const email = renderEnrollmentEmail("enrollment.released", data);

    expect(email.text).toContain("released");
  });

  it("escapes the student name in the html part", () => {
    const email = renderEnrollmentEmail("enrollment.confirmed", {
      ...data,
      studentFirstName: "<script>",
    });

    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain("<script>");
  });

  it("never carries an unsubscribe link", () => {
    for (const template of [
      "enrollment.requested",
      "enrollment.confirmed",
      "enrollment.released",
    ] as const) {
      const email = renderEnrollmentEmail(template, data);
      expect(email.text.toLowerCase()).not.toContain("unsubscribe");
      expect(email.html.toLowerCase()).not.toContain("unsubscribe");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/enrollment-emails.test.ts`
Expected: FAIL — cannot resolve `@/lib/emails/layout`.

- [ ] **Step 3: Write the layout**

Create `lib/emails/layout.ts`:

```ts
/**
 * Escapes text for interpolation into an HTML email body.
 *
 * Names, class names, and notes are all user- or staff-supplied, and an email
 * body is the one place in this system where such text is assembled into
 * markup by hand rather than by React.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const STUDIO = "Jodi&rsquo;s Dance Unlimited";

/**
 * Wraps rendered paragraphs in the shared shell.
 *
 * Inline styles and a table-free single column on purpose: email clients strip
 * stylesheets, and anything more elaborate degrades worse than it gains.
 * Callers pass HTML that is already escaped.
 */
export function wrapHtml(heading: string, paragraphs: string[]): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;">${p}</p>`)
    .join("");

  return [
    `<div style="background:#f6f5f3;padding:24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#14161a;">`,
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e1dc;padding:32px;">`,
    `<p style="margin:0 0 24px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#b57a33;">${STUDIO}</p>`,
    `<h1 style="margin:0 0 20px;font-size:20px;">${heading}</h1>`,
    body,
    `</div></div>`,
  ].join("");
}
```

- [ ] **Step 4: Write the three templates**

Create `lib/emails/enrollment.ts`:

```ts
import type { DayOfWeek } from "@/db/schema";
import { formatDayOfWeek } from "@/lib/dates";
import { formatCents, formatTimeRange } from "@/lib/format";
import { escapeHtml, wrapHtml } from "./layout";

export type EnrollmentEmailTemplate =
  | "enrollment.requested"
  | "enrollment.confirmed"
  | "enrollment.released";

export type EnrollmentEmailData = {
  studentFirstName: string;
  studentLastName: string;
  className: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  monthlyPriceCents: number;
  seasonFeeCents: number;
};

export type RenderedEmail = { subject: string; text: string; html: string };

/** "Ballet I — Monday, 4:00 PM – 5:00 PM" */
function whenLine(data: EnrollmentEmailData): string {
  return `${data.className} — ${formatDayOfWeek(data.dayOfWeek)}, ${formatTimeRange(
    data.startTime,
    data.endTime,
  )}`;
}

/**
 * The money paragraph. Phrased as what to bring to the studio, never as an
 * amount owed to this website — the site takes no payment.
 */
function costLines(data: EnrollmentEmailData): string[] {
  const lines = [`Tuition is ${formatCents(data.monthlyPriceCents)} per month.`];
  if (data.seasonFeeCents > 0) {
    lines.push(`There is also a one-time season fee of ${formatCents(data.seasonFeeCents)}.`);
  }
  lines.push("Payment is taken in person at the studio — we never collect it online.");
  return lines;
}

function body(
  template: EnrollmentEmailTemplate,
  data: EnrollmentEmailData,
): { heading: string; subject: string; paragraphs: string[] } {
  const student = `${data.studentFirstName} ${data.studentLastName}`;

  switch (template) {
    case "enrollment.requested":
      return {
        subject: `We're holding a seat in ${data.className}`,
        heading: "Your request is in",
        paragraphs: [
          `We are holding a seat for ${student} in ${whenLine(data)}.`,
          ...costLines(data),
          "The seat is held until a member of staff confirms it. Nothing else is needed from you online.",
        ],
      };
    case "enrollment.confirmed":
      return {
        subject: `${data.className} is confirmed`,
        heading: "You're enrolled",
        paragraphs: [
          `${student} is now enrolled in ${whenLine(data)}.`,
          "We have recorded your payment at the studio. See you in class.",
        ],
      };
    case "enrollment.released":
      return {
        subject: `The seat in ${data.className} has been released`,
        heading: "The hold has been released",
        paragraphs: [
          `The seat we were holding for ${student} in ${whenLine(data)} has been released, so it is no longer reserved.`,
          "If this is not what you expected, reply to this message or call the studio and we will sort it out.",
        ],
      };
  }
}

/**
 * Renders one enrollment email. Pure: no database, no clock, no environment —
 * which is what makes the wording unit-testable.
 */
export function renderEnrollmentEmail(
  template: EnrollmentEmailTemplate,
  data: EnrollmentEmailData,
): RenderedEmail {
  const { heading, subject, paragraphs } = body(template, data);

  return {
    subject,
    text: `${heading}\n\n${paragraphs.join("\n\n")}\n`,
    html: wrapHtml(escapeHtml(heading), paragraphs.map(escapeHtml)),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/enrollment-emails.test.ts`
Expected: 7 passed.

- [ ] **Step 6: Run the full suite and commit**

```bash
npm test && npm run typecheck
git add lib/emails tests/unit/enrollment-emails.test.ts
git commit -m "feat: render the three enrollment emails"
```

---

### Task 4: Queueing deliveries

One row per parent login on the family, written with the executor the caller
supplies so it joins the caller's transaction.

**Files:**
- Create: `db/queries/email-deliveries.ts`
- Test: `tests/integration/email-queueing.test.ts`

**Interfaces:**
- Consumes: `Executor` from `@/db/queries/executor`; `renderEnrollmentEmail`, `EnrollmentEmailTemplate` from `@/lib/emails/enrollment`; `emailDeliveries`, `enrollments`, `students`, `families`, `classOfferings`, `user` from `@/db/schema`.
- Produces: `queueEnrollmentEmails(exec: Executor, input: { enrollmentId: string; template: EnrollmentEmailTemplate }): Promise<string[]>` — the ids of the rows written, in recipient order.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/email-queueing.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import { queueEnrollmentEmails } from "@/db/queries/email-deliveries";
import { requestEnrollment } from "@/db/queries/enrollments";
import { emailDeliveries, user } from "@/db/schema";

describe("queueEnrollmentEmails", () => {
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

  it("writes one row per parent login on the family", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 5);
    await addLogin("user-1", "one@example.com", familyA.id);
    await addLogin("user-2", "two@example.com", familyA.id);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const ids = await queueEnrollmentEmails(db, {
      enrollmentId: requested.enrollment.id,
      template: "enrollment.confirmed",
    });

    expect(ids).toHaveLength(2);
    const rows = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, requested.enrollment.id));
    expect(rows.map((r) => r.recipientEmail).sort()).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
    expect(rows.every((r) => r.status === "queued")).toBe(true);
    expect(rows.every((r) => r.category === "transactional")).toBe(true);
    expect(rows.every((r) => r.sourceType === "enrollment")).toBe(true);
  });

  it("stores the rendered message on the row", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 5);
    await addLogin("user-1", "one@example.com", familyA.id);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    await queueEnrollmentEmails(db, {
      enrollmentId: requested.enrollment.id,
      template: "enrollment.requested",
    });

    const [row] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, requested.enrollment.id));
    expect(row!.subject).toContain("Ballet I");
    expect(row!.bodyText).toContain("Ana");
    expect(row!.bodyText).toContain("$85.00");
    expect(row!.bodyHtml).toContain("<p");
  });

  it("writes nothing for a family with no logins", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 5);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const ids = await queueEnrollmentEmails(db, {
      enrollmentId: requested.enrollment.id,
      template: "enrollment.released",
    });

    expect(ids).toEqual([]);
  });

  it("writes nothing for an enrollment that does not exist", async () => {
    const ids = await queueEnrollmentEmails(db, {
      enrollmentId: "11111111-1111-1111-1111-111111111111",
      template: "enrollment.confirmed",
    });

    expect(ids).toEqual([]);
  });

  it("leaves no rows behind when the surrounding transaction rolls back", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 5);
    await addLogin("user-1", "one@example.com", familyA.id);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    // The request itself queued nothing yet — Task 5 wires that up.
    await db.delete(emailDeliveries);

    await expect(
      db.transaction(async (tx) => {
        await queueEnrollmentEmails(tx, {
          enrollmentId: requested.enrollment.id,
          template: "enrollment.confirmed",
        });
        throw new Error("roll it back");
      }),
    ).rejects.toThrow("roll it back");

    const rows = await db.select().from(emailDeliveries);
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/email-queueing.test.ts`
Expected: FAIL — cannot resolve `@/db/queries/email-deliveries`.

- [ ] **Step 3: Write the implementation**

Create `db/queries/email-deliveries.ts`:

```ts
import { asc, eq } from "drizzle-orm";
import {
  classOfferings,
  emailDeliveries,
  enrollments,
  students,
  user,
} from "@/db/schema";
import {
  renderEnrollmentEmail,
  type EnrollmentEmailTemplate,
} from "@/lib/emails/enrollment";
import type { Executor } from "./executor";

export type QueueEnrollmentInput = {
  enrollmentId: string;
  template: EnrollmentEmailTemplate;
};

/**
 * Writes one delivery row per parent login on the enrolling family.
 *
 * Takes an `Executor` so it joins the caller's transaction: a delivery for a
 * transition that rolls back must roll back with it, and a transition that
 * commits must never lose its email between two separate commits.
 *
 * A family with no logins queues nothing, and that is not an error — nobody
 * has asked to be told, so there is nobody to tell.
 */
export async function queueEnrollmentEmails(
  exec: Executor,
  input: QueueEnrollmentInput,
): Promise<string[]> {
  const [details] = await exec
    .select({
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      familyId: students.familyId,
      className: classOfferings.name,
      dayOfWeek: classOfferings.dayOfWeek,
      startTime: classOfferings.startTime,
      endTime: classOfferings.endTime,
      monthlyPriceCents: classOfferings.monthlyPriceCents,
      seasonFeeCents: classOfferings.seasonFeeCents,
    })
    .from(enrollments)
    .innerJoin(students, eq(enrollments.studentId, students.id))
    .innerJoin(classOfferings, eq(enrollments.classOfferingId, classOfferings.id))
    .where(eq(enrollments.id, input.enrollmentId))
    .limit(1);
  if (!details) return [];

  const recipients = await exec
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.familyId, details.familyId))
    .orderBy(asc(user.email));
  if (recipients.length === 0) return [];

  const rendered = renderEnrollmentEmail(input.template, details);

  const rows = await exec
    .insert(emailDeliveries)
    .values(
      recipients.map((recipient) => ({
        sourceType: "enrollment" as const,
        sourceId: input.enrollmentId,
        template: input.template,
        category: "transactional" as const,
        recipientUserId: recipient.id,
        recipientEmail: recipient.email,
        subject: rendered.subject,
        bodyText: rendered.text,
        bodyHtml: rendered.html,
      })),
    )
    .returning({ id: emailDeliveries.id });

  return rows.map((row) => row.id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/email-queueing.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck
git add db/queries/email-deliveries.ts tests/integration/email-queueing.test.ts
git commit -m "feat: queue one delivery row per parent login"
```

---

### Task 5: Wiring the three transitions

**Files:**
- Modify: `db/queries/enrollments.ts`
- Test: `tests/integration/enrollment-email-wiring.test.ts`

**Interfaces:**
- Consumes: `queueEnrollmentEmails` (Task 4).
- Produces: `RequestResult` and `TransitionResult` `ok` branches each gain `deliveryIds: string[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/enrollment-email-wiring.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import {
  confirmEnrollment,
  releaseEnrollment,
  requestEnrollment,
  withdrawEnrollment,
} from "@/db/queries/enrollments";
import { emailDeliveries, user } from "@/db/schema";

describe("the three transitions queue their emails", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedWithLogin() {
    const seeded = await seedTwoFamilies(db, 5);
    await db.insert(user).values({
      id: "user-1",
      name: "Ana Alvarez",
      email: "one@example.com",
      familyId: seeded.familyA.id,
    });
    return seeded;
  }

  async function templatesFor(enrollmentId: string) {
    const rows = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, enrollmentId));
    return rows.map((row) => row.template).sort();
  }

  it("queues a requested email and returns its id", async () => {
    const { familyA, studentA, offering } = await seedWithLogin();

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deliveryIds).toHaveLength(1);
    expect(await templatesFor(result.enrollment.id)).toEqual(["enrollment.requested"]);
  });

  it("queues a confirmed email", async () => {
    const { familyA, studentA, offering } = await seedWithLogin();
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const result = await confirmEnrollment(db, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deliveryIds).toHaveLength(1);
    expect(await templatesFor(requested.enrollment.id)).toEqual([
      "enrollment.confirmed",
      "enrollment.requested",
    ]);
  });

  it("queues a released email", async () => {
    const { familyA, studentA, offering } = await seedWithLogin();
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const result = await releaseEnrollment(db, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await templatesFor(requested.enrollment.id)).toEqual([
      "enrollment.released",
      "enrollment.requested",
    ]);
  });

  it("queues nothing when a parent withdraws", async () => {
    const { familyA, studentA, offering } = await seedWithLogin();
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    await withdrawEnrollment(db, familyA.id, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    // The family did this themselves; telling them about it is noise.
    expect(await templatesFor(requested.enrollment.id)).toEqual([
      "enrollment.requested",
    ]);
  });

  it("queues nothing when the request is rejected", async () => {
    const { familyA, studentA, studentB, offering } = await seedWithLogin();
    await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    await db.delete(emailDeliveries);

    // Another family's student: rejected before anything is written.
    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(false);
    expect(await db.select().from(emailDeliveries)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/enrollment-email-wiring.test.ts`
Expected: FAIL — `result.deliveryIds` is `undefined`.

- [ ] **Step 3: Widen the result types**

In `db/queries/enrollments.ts`, add the import:

```ts
import { queueEnrollmentEmails } from "./email-deliveries";
```

Change `RequestResult`:

```ts
export type RequestResult =
  | { ok: true; enrollment: Enrollment; deliveryIds: string[] }
  | { ok: false; reason: "not-found" | "closed" | "full" | "duplicate" };
```

Change `TransitionResult`:

```ts
export type TransitionResult =
  | { ok: true; enrollment: Enrollment; deliveryIds: string[] }
  | { ok: false; reason: "not-found" | "not-pending" };
```

- [ ] **Step 4: Queue inside each transaction**

In `requestEnrollment`, after the `recordAudit` call and before the return,
replace the final return of the transaction callback:

```ts
      const deliveryIds = await queueEnrollmentEmails(tx, {
        enrollmentId: enrollment.id,
        template: "enrollment.requested",
      });

      return { ok: true, enrollment, deliveryIds } as const;
```

In `confirmEnrollment`, likewise:

```ts
    const deliveryIds = await queueEnrollmentEmails(tx, {
      enrollmentId: row.id,
      template: "enrollment.confirmed",
    });

    return { ok: true, enrollment: row, deliveryIds } as const;
```

In `releaseEnrollment`, likewise:

```ts
    const deliveryIds = await queueEnrollmentEmails(tx, {
      enrollmentId: row.id,
      template: "enrollment.released",
    });

    return { ok: true, enrollment: row, deliveryIds } as const;
```

In `withdrawEnrollment`, return an empty list — a family that withdrew its own
seat does not need to be told it withdrew:

```ts
    return { ok: true, enrollment: row, deliveryIds: [] } as const;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/enrollment-email-wiring.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Run the full suite and commit**

Existing enrollment tests read `result.enrollment` and must still pass
unchanged — a widened `ok` branch is additive.

```bash
npm test && npm run typecheck
git add db/queries/enrollments.ts tests/integration/enrollment-email-wiring.test.ts
git commit -m "feat: queue lifecycle emails inside each transition"
```

---

### Task 6: Claiming, marking, and listing

**Files:**
- Modify: `db/queries/email-deliveries.ts`
- Test: `tests/integration/email-delivery-state.test.ts`

**Interfaces:**
- Produces: `STUCK_AFTER_MS`; `claimForSend(db: Database, deliveryId: string): Promise<EmailDelivery | null>`; `markSent(db: Database, deliveryId: string, providerMessageId: string | null): Promise<void>`; `markFailed(db: Database, deliveryId: string, error: string): Promise<void>`; `listRetriableDeliveries(db: Database, now?: Date): Promise<EmailDelivery[]>`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/email-delivery-state.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import {
  claimForSend,
  listRetriableDeliveries,
  markFailed,
  markSent,
} from "@/db/queries/email-deliveries";
import { emailDeliveries } from "@/db/schema";

const base = {
  sourceType: "enrollment" as const,
  sourceId: "11111111-1111-1111-1111-111111111111",
  template: "enrollment.requested",
  category: "transactional" as const,
  recipientEmail: "parent@example.com",
  subject: "Your seat is held",
  bodyText: "text body",
  bodyHtml: "<p>html body</p>",
};

describe("delivery state", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function insert(overrides: Partial<typeof emailDeliveries.$inferInsert> = {}) {
    const [row] = await db
      .insert(emailDeliveries)
      .values({ ...base, ...overrides })
      .returning();
    return row!;
  }

  it("claims a queued row and counts the attempt", async () => {
    const row = await insert();

    const claimed = await claimForSend(db, row.id);

    expect(claimed!.status).toBe("sending");
    expect(claimed!.attempts).toBe(1);
  });

  it("lets exactly one of two concurrent claims win", async () => {
    const row = await insert();

    const [first, second] = await Promise.all([
      claimForSend(db, row.id),
      claimForSend(db, row.id),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("refuses to claim a row that has already been sent", async () => {
    const row = await insert({ status: "sent" });

    expect(await claimForSend(db, row.id)).toBeNull();
  });

  it("claims a failed row again, so Retry works", async () => {
    const row = await insert({ status: "failed", attempts: 1, error: "boom" });

    const claimed = await claimForSend(db, row.id);

    expect(claimed!.status).toBe("sending");
    expect(claimed!.attempts).toBe(2);
  });

  it("records the provider id when sent", async () => {
    const row = await insert();
    await claimForSend(db, row.id);

    await markSent(db, row.id, "resend-123");

    const [after] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, row.id));
    expect(after!.status).toBe("sent");
    expect(after!.providerMessageId).toBe("resend-123");
    expect(after!.sentAt).not.toBeNull();
    expect(after!.error).toBeNull();
  });

  it("records the error when it fails", async () => {
    const row = await insert();
    await claimForSend(db, row.id);

    await markFailed(db, row.id, "provider refused");

    const [after] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, row.id));
    expect(after!.status).toBe("failed");
    expect(after!.error).toBe("provider refused");
  });

  it("lists failed rows and rows stuck sending, oldest first", async () => {
    const now = new Date("2026-09-01T12:00:00Z");
    const stale = new Date(now.getTime() - 20 * 60 * 1000);
    const recent = new Date(now.getTime() - 60 * 1000);

    await insert({ status: "sent" });
    const failed = await insert({ status: "failed", error: "boom" });
    const stuck = await insert({ status: "sending", updatedAt: stale });
    await insert({ status: "sending", updatedAt: recent });
    await insert({ status: "queued" });

    const rows = await listRetriableDeliveries(db, now);

    expect(rows.map((row) => row.id).sort()).toEqual([failed.id, stuck.id].sort());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/email-delivery-state.test.ts`
Expected: FAIL — `claimForSend` is not exported.

- [ ] **Step 3: Write the implementation**

First widen the two import lines at the top of `db/queries/email-deliveries.ts`,
which Task 4 left listing only what Task 4 used:

```ts
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  classOfferings,
  emailDeliveries,
  enrollments,
  students,
  user,
  type EmailDelivery,
} from "@/db/schema";
```

and change the executor import to bring in `Database` alongside `Executor`:

```ts
import type { Database, Executor } from "./executor";
```

Then append:

```ts
/**
 * How long a row may sit in `sending` before it is assumed abandoned.
 *
 * Nothing sweeps on a timer, so without this a process that died mid-send
 * would strand a row in a state nothing ever looks at again.
 */
export const STUCK_AFTER_MS = 15 * 60 * 1000;

/**
 * Takes exclusive responsibility for sending one delivery.
 *
 * The status predicate is what makes this exactly-once: the affected-row count
 * is the decision, never a read followed by a write that another process could
 * interleave with — the same discipline as the seat claim in `enrollments.ts`.
 * Null means someone else holds it, or it has already been sent.
 */
export async function claimForSend(
  db: Database,
  deliveryId: string,
): Promise<EmailDelivery | null> {
  const [row] = await db
    .update(emailDeliveries)
    .set({
      status: "sending",
      attempts: sql`${emailDeliveries.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailDeliveries.id, deliveryId),
        inArray(emailDeliveries.status, ["queued", "failed"]),
      ),
    )
    .returning();
  return row ?? null;
}

/** Records a successful send. Clears any error left by an earlier attempt. */
export async function markSent(
  db: Database,
  deliveryId: string,
  providerMessageId: string | null,
): Promise<void> {
  const now = new Date();
  await db
    .update(emailDeliveries)
    .set({
      status: "sent",
      providerMessageId,
      error: null,
      sentAt: now,
      updatedAt: now,
    })
    .where(eq(emailDeliveries.id, deliveryId));
}

/** Records a failed send, leaving the row claimable again by Retry. */
export async function markFailed(
  db: Database,
  deliveryId: string,
  error: string,
): Promise<void> {
  await db
    .update(emailDeliveries)
    .set({ status: "failed", error, updatedAt: new Date() })
    .where(eq(emailDeliveries.id, deliveryId));
}

/**
 * Everything a staff member should look at: outright failures, plus rows still
 * `sending` long enough that the process handling them is gone.
 *
 * `now` is a parameter so the boundary is testable without waiting fifteen
 * minutes.
 */
export async function listRetriableDeliveries(
  db: Database,
  now: Date = new Date(),
): Promise<EmailDelivery[]> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);

  return db
    .select()
    .from(emailDeliveries)
    .where(
      or(
        eq(emailDeliveries.status, "failed"),
        and(
          eq(emailDeliveries.status, "sending"),
          lt(emailDeliveries.updatedAt, cutoff),
        ),
      ),
    )
    .orderBy(asc(emailDeliveries.createdAt), asc(emailDeliveries.id));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/email-delivery-state.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck
git add db/queries/email-deliveries.ts tests/integration/email-delivery-state.test.ts
git commit -m "feat: claim, mark, and list email deliveries"
```

---

### Task 7: The delivery runner

**Files:**
- Create: `lib/notifications/deliver.ts`
- Test: `tests/integration/deliver-queued.test.ts`

**Interfaces:**
- Consumes: `claimForSend`, `markSent`, `markFailed` (Task 6); `sendEmail` (Task 2).
- Produces: `deliverQueued(db: Database, deliveryIds: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/deliver-queued.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { deliverQueued } from "@/lib/notifications/deliver";
import { emailDeliveries } from "@/db/schema";

const base = {
  sourceType: "enrollment" as const,
  sourceId: "11111111-1111-1111-1111-111111111111",
  template: "enrollment.requested",
  category: "transactional" as const,
  recipientEmail: "parent@example.com",
  subject: "Your seat is held",
  bodyText: "text body",
  bodyHtml: "<p>html body</p>",
};

describe("deliverQueued", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("sends every queued row and records the provider id", async () => {
    const rows = await db
      .insert(emailDeliveries)
      .values([base, { ...base, recipientEmail: "two@example.com" }])
      .returning();

    await deliverQueued(db, rows.map((row) => row.id));

    const after = await db.select().from(emailDeliveries);
    expect(after.every((row) => row.status === "sent")).toBe(true);
    expect(after.every((row) => row.providerMessageId?.startsWith("capture-"))).toBe(true);
  });

  it("leaves an already-sent row alone", async () => {
    const [row] = await db
      .insert(emailDeliveries)
      .values({ ...base, status: "sent", providerMessageId: "original" })
      .returning();

    await deliverQueued(db, [row!.id]);

    const [after] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, row!.id));
    expect(after!.providerMessageId).toBe("original");
    expect(after!.attempts).toBe(0);
  });

  it("ignores an id that does not exist", async () => {
    await expect(
      deliverQueued(db, ["11111111-1111-1111-1111-111111111111"]),
    ).resolves.toBeUndefined();
  });

  it("does nothing at all for an empty list", async () => {
    await expect(deliverQueued(db, [])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/deliver-queued.test.ts`
Expected: FAIL — cannot resolve `@/lib/notifications/deliver`.

- [ ] **Step 3: Write the implementation**

Create `lib/notifications/deliver.ts`:

```ts
import { claimForSend, markFailed, markSent } from "@/db/queries/email-deliveries";
import type { Database } from "@/db/queries/executor";
import { sendEmail } from "@/lib/email";

/**
 * Sends a batch of queued deliveries, one row at a time.
 *
 * Runs after the response — from `after()` in a server action, or from the
 * Retry action — so nothing here may throw into a caller that has already
 * returned. A failure is recorded on its own row and the next row still goes
 * out; one bad address must not silence the rest of a family's mail.
 */
export async function deliverQueued(
  db: Database,
  deliveryIds: string[],
): Promise<void> {
  for (const deliveryId of deliveryIds) {
    // Claiming is what makes a double Retry safe: a row already sent, or
    // already in flight elsewhere, comes back null and is skipped.
    const delivery = await claimForSend(db, deliveryId);
    if (!delivery) continue;

    try {
      const { providerMessageId } = await sendEmail({
        to: delivery.recipientEmail,
        subject: delivery.subject,
        text: delivery.bodyText,
        html: delivery.bodyHtml,
      });
      await markSent(db, delivery.id, providerMessageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("deliverQueued failed", { deliveryId, message });
      await markFailed(db, delivery.id, message);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/deliver-queued.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck
git add lib/notifications tests/integration/deliver-queued.test.ts
git commit -m "feat: add the delivery runner"
```

---

### Task 8: Sending after the response

**Files:**
- Modify: `app/portal/actions.ts`
- Modify: `app/admin/actions.ts`

**Interfaces:**
- Consumes: `deliverQueued` (Task 7); `after` from `next/server`; the widened results from Task 5.

Read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`
before writing this task. `after` is imported from `next/server`, is stable in
this version, and runs its callback once the response is finished — including
when the action redirects.

- [ ] **Step 1: Wire the portal request action**

In `app/portal/actions.ts`, add to the imports:

```ts
import { after } from "next/server";
import { deliverQueued } from "@/lib/notifications/deliver";
```

In `requestEnrollmentAction`, after the result is known to be `ok` and before
the `revalidatePath` calls, add:

```ts
  /*
   * The rows are already committed; sending them is what is deferred. Doing it
   * here rather than awaiting inline means a slow or failing provider cannot
   * make "Request seat" appear to hang, and a failure lands on the delivery
   * row where /admin/emails can show it.
   */
  after(() => deliverQueued(db, result.deliveryIds));
```

- [ ] **Step 2: Wire both admin actions**

In `app/admin/actions.ts`, add to the imports:

```ts
import { after } from "next/server";
import { deliverQueued } from "@/lib/notifications/deliver";
```

In `confirmEnrollmentAction`, after the `if (!result.ok)` guard:

```ts
  after(() => deliverQueued(db, result.deliveryIds));
```

In `releaseEnrollmentAction`, after its `if (!result.ok)` guard:

```ts
  after(() => deliverQueued(db, result.deliveryIds));
```

- [ ] **Step 3: Verify it compiles and builds**

```bash
npm run typecheck && npm run build
```
Expected: both clean. A build error naming `after` means the import came from
`next/after` rather than `next/server`.

- [ ] **Step 4: Run the full suite and commit**

```bash
npm test
git add app/portal/actions.ts app/admin/actions.ts
git commit -m "feat: send lifecycle emails after the response"
```

---

### Task 9: The retry page

**Files:**
- Create: `app/admin/emails/page.tsx`
- Create: `components/retry-delivery-button.tsx`
- Modify: `app/admin/actions.ts`
- Modify: `app/admin/layout.tsx`
- Modify: `lib/enrollment-validation.ts`

**Interfaces:**
- Consumes: `listRetriableDeliveries`, `STUCK_AFTER_MS` (Task 6); `deliverQueued` (Task 7); `requireStaff`; `AdminForm` conventions from `components/admin-form.tsx`.
- Produces: `deliveryIdSchema`; `retryDeliveryAction(prev: ActionState, formData: FormData): Promise<ActionState>`.

- [ ] **Step 1: Add the schema**

Append to `lib/enrollment-validation.ts`:

```ts
export const deliveryIdSchema = z.object({
  deliveryId: z.uuid("That delivery could not be found."),
});
```

- [ ] **Step 2: Add the retry action**

In `app/admin/actions.ts`, extend the existing
`@/lib/enrollment-validation` import to include `deliveryIdSchema`, then append:

```ts
export async function retryDeliveryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const parsed = deliveryIdSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  /*
   * Awaited, not deferred: a person pressed Retry and is waiting to see
   * whether it worked. `deliverQueued` never throws, and a row that someone
   * else already sent is skipped by the claim.
   */
  await deliverQueued(db, [parsed.data.deliveryId]);

  revalidatePath("/admin/emails");
  return { error: null };
}
```

- [ ] **Step 3: Write the button**

Create `components/retry-delivery-button.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { retryDeliveryAction } from "@/app/admin/actions";
import { idleState } from "@/lib/action-state";

export function RetryDeliveryButton({
  deliveryId,
  recipientEmail,
}: {
  deliveryId: string;
  recipientEmail: string;
}) {
  const [state, formAction, pending] = useActionState(
    retryDeliveryAction,
    idleState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="deliveryId" value={deliveryId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Retry the message to ${recipientEmail}`}
        className="btn btn-ghost min-h-0 py-1.5 text-sm disabled:opacity-50"
      >
        {pending ? "Sending…" : "Retry"}
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

- [ ] **Step 4: Build the page**

Create `app/admin/emails/page.tsx`:

```tsx
import { RetryDeliveryButton } from "@/components/retry-delivery-button";
import { db } from "@/db";
import { listRetriableDeliveries } from "@/db/queries/email-deliveries";
import { requireStaff } from "@/lib/guards";

export default async function AdminEmailsPage() {
  await requireStaff();
  const deliveries = await listRetriableDeliveries(db);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">Email</h2>
      <p className="hint mt-2">
        Messages that did not go out. Nothing retries on its own — press Retry
        once you believe the problem is fixed. Pressing it twice is safe.
      </p>

      {deliveries.length === 0 ? (
        <p className="mt-8 text-mirror">Everything has been delivered.</p>
      ) : (
        <ul className="panel mt-8 divide-y divide-barre/25">
          {deliveries.map((delivery) => (
            <li
              key={delivery.id}
              className="flex flex-wrap items-start justify-between gap-4 p-5"
            >
              <div>
                <p className="font-semibold text-chalk">{delivery.subject}</p>
                <p className="mt-1 text-sm text-mirror">
                  {delivery.recipientEmail} · {delivery.template}
                </p>
                <p className="tabular mt-2 text-sm text-alarm">
                  {delivery.status === "failed"
                    ? (delivery.error ?? "Failed with no reason recorded")
                    : "Started sending and never finished"}
                  {delivery.attempts > 1 && ` · ${delivery.attempts} attempts`}
                </p>
              </div>
              <RetryDeliveryButton
                deliveryId={delivery.id}
                recipientEmail={delivery.recipientEmail}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Add the nav link**

In `app/admin/layout.tsx`, add to the `links` array after "Requests":

```ts
  { href: "/admin/emails", label: "Email" },
```

- [ ] **Step 6: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add app/admin components/retry-delivery-button.tsx lib/enrollment-validation.ts
git commit -m "feat: add the email retry page"
```

---

### Task 10: End-to-end coverage

**Files:**
- Modify: `e2e/enrollment.spec.ts`
- Modify: `e2e/fixtures/seed.ts`

**Interfaces:**
- Consumes: `seedOpenSeasonWithClass`, `promoteToStaff` (Phase 2's fixture).
- Produces: `deliveriesFor(sourceId: string)` — the delivery rows for one enrollment, read straight from the test database.

- [ ] **Step 1: Extend the fixture**

Append to `e2e/fixtures/seed.ts`, following the `withDb` helper already there:

```ts
/**
 * Every delivery row belonging to one enrollment, newest last. Read directly
 * because the e2e suite has no other window onto what was sent — the capture
 * transport deliberately keeps nothing in memory.
 */
export async function deliveriesForEnrollment(enrollmentId: string) {
  return withDb((db) =>
    db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, enrollmentId))
      .orderBy(asc(emailDeliveries.createdAt)),
  );
}

/** The most recent enrollment id for a student, by first name. */
export async function latestEnrollmentIdFor(firstName: string): Promise<string> {
  return withDb(async (db) => {
    const [row] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .innerJoin(students, eq(enrollments.studentId, students.id))
      .where(eq(students.firstName, firstName))
      .orderBy(desc(enrollments.requestedAt))
      .limit(1);
    if (!row) throw new Error(`no enrollment found for ${firstName}`);
    return row.id;
  });
}
```

Extend that file's drizzle import to `import { asc, desc, eq, like } from "drizzle-orm";`
and its schema import to include `emailDeliveries`, `enrollments`, and `students`.

- [ ] **Step 2: Assert the requested email in the existing spec**

In `e2e/enrollment.spec.ts`, extend the fixture import to include
`deliveriesForEnrollment` and `latestEnrollmentIdFor`, then append to the
**"a parent requests a seat"** test, after the existing
`await expect(page.getByText("Requested")).toBeVisible();`:

```ts
    // after() runs once the response is finished, so the row may still be in
    // flight for a moment after the page renders.
    const enrollmentId = await latestEnrollmentIdFor("Lucia");
    await expect
      .poll(async () => {
        const rows = await deliveriesForEnrollment(enrollmentId);
        return rows.map((row) => `${row.template}:${row.status}`);
      })
      .toEqual(["enrollment.requested:sent"]);
```

- [ ] **Step 3: Assert the confirmed email**

Append to the **"staff confirm the request"** test, after the parent sees
"Enrolled":

```ts
    const enrollmentId = await latestEnrollmentIdFor("Lucia");
    await expect
      .poll(async () => {
        const rows = await deliveriesForEnrollment(enrollmentId);
        return rows.map((row) => `${row.template}:${row.status}`);
      })
      .toEqual(["enrollment.requested:sent", "enrollment.confirmed:sent"]);
```

- [ ] **Step 4: Assert the retry page is empty**

Append to the **"staff confirm the request"** test, inside the staff context
and before `staffContext.close()`:

```ts
    await staff.goto("/admin/emails");
    await expect(staff.getByText("Everything has been delivered.")).toBeVisible();
```

- [ ] **Step 5: Run the e2e suite**

Run: `npm run test:e2e`
Expected: 8 passed — the same eight scenarios, now also asserting delivery.

- [ ] **Step 6: Run everything and commit**

```bash
npm test && npm run typecheck && npm run build && npm run test:e2e
git add e2e
git commit -m "test: cover lifecycle email delivery end to end"
```

---

## Phase 3a completion checklist

Confirm each by running the command and reading the output — not by assuming:

- [ ] `npm run typecheck` passes with no errors
- [ ] `npm test` passes every unit and integration suite
- [ ] `npm run test:e2e` passes all eight scenarios
- [ ] `npm run build` completes successfully
- [ ] A request, a confirm, and a release each write one delivery row per parent login
- [ ] A family with two logins gets two rows; a family with none gets zero and the transition still succeeds
- [ ] A rolled-back transition leaves no delivery row behind
- [ ] Two concurrent claims on one row result in exactly one send
- [ ] Pressing Retry twice on one row sends it once
- [ ] A row stuck in `sending` for more than fifteen minutes appears on `/admin/emails`
- [ ] No email in this phase contains the word "unsubscribe"
- [ ] Withdrawing sends nothing
- [ ] No test run reaches the real provider — check with
      `SELECT provider_message_id FROM email_deliveries LIMIT 5;` after an e2e
      run; every id must start with `capture-`

## What Phase 3a deliberately does not do

**No announcements and no cancellations.** Both are Phase 3b, and both are why
`email_deliveries` is polymorphic rather than enrollment-shaped.

**No unsubscribe and no broadcast preference.** Nothing here is broadcast mail.
The `category` column is in place so 3b adds a predicate rather than a
migration.

**No scheduled retry and no provider webhooks.** A person presses Retry. Bounces
and complaints are recorded in 3b, when a fan-out makes them matter.
