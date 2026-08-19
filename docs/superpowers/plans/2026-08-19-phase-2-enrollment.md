# Phase 2 — Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a parent request a seat in a class, hold that seat atomically from
the moment of the request, and let staff confirm or release it after taking
payment in person.

**Architecture:** Enrollment is a request that staff confirm. Every state
transition is a conditional `UPDATE` whose affected-row count *is* the decision,
wrapped in one transaction with the seat-counter change and an audit row. No
transition ever reads a value and then writes based on it. All parent-facing
queries take `familyId` as their first parameter, as everywhere else in this
codebase.

**Tech Stack:** Node 24.19.0, Next.js 16.3.1, React 19.2.8, TypeScript 5.9.3,
Postgres 18, Drizzle ORM 0.45.2, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-08-14-dance-studio-website-design.md`
(§3 data model, §4 enrollment)

## Global Constraints

- **Money is always integer cents.** Never a float, never a decimal. Dollars
  appear only at the display boundary via `formatCents` in `lib/format.ts`.
- **This application never collects or tracks money.** Payment happens in person
  at the studio. Prices are displayed so a family knows what to bring. Nothing
  sums, bills, or records a payment.
- **Family-scoped queries take `familyId: string` as their first parameter** and
  filter on it in SQL. Never filter in application code after fetching.
- **Seat holds never expire.** Nothing releases a seat on a timer. A `pending`
  enrollment holds a real seat until a human acts on it.
- **A `pending` enrollment counts against `seats_taken` exactly as `active`
  does.** The public catalog must never offer a seat that a pending request
  holds.
- **Age ranges are advisory.** `min_age` and `max_age` are displayed, never
  enforced. Staff catch misplacement at confirmation.
- Run `npm test` and `npm run typecheck` before every commit. Both must be clean.

## Decisions this plan locks in

These were settled before the plan was written. Do not relitigate them mid-task.

- **No emails in Phase 2.** The three enrollment lifecycle emails are Phase 3.
  A parent learns the status of a request from the portal. Do not import
  `lib/email.ts` anywhere in this phase.
- **The audit log is built here, in Phase 2**, not deferred. Its purpose is
  settling disputes about seats and prices, which only works if it predates the
  first real enrollment.
- **A withdrawn or released enrollment leaves its row in place**; requesting the
  same class again inserts a *new* row. A partial unique index permits only one
  `pending`-or-`active` row per student per class.
- **New requests are gated on `seasons.registration_open`.** The column exists,
  defaults to false, and is otherwise meaningless.
- **`start_date` is set on confirmation; `end_date` is set on withdrawal or
  release.** Those are the only writes to either column in this phase.

## File structure

**New:**

| File | Responsibility |
| --- | --- |
| `db/schema/enrollments.ts` | `enrollments` table, status enum, partial unique index |
| `db/schema/audit-log.ts` | `audit_log` table |
| `db/queries/executor.ts` | `Executor` type so query functions accept a db *or* a transaction |
| `db/queries/audit-log.ts` | `recordAudit` — the only writer to `audit_log` |
| `db/queries/enrollments.ts` | Every enrollment transition and read |
| `lib/enrollment-validation.ts` | Zod schemas for the enrollment form inputs |
| `app/portal/enrollments/page.tsx` | A family's requests and their status |
| `app/admin/enrollments/page.tsx` | The staff confirmation queue, oldest first |
| `app/admin/classes/[offeringId]/page.tsx` | One class: roster and edit form |
| `components/enrollment-request-form.tsx` | Per-class "request a seat" control |
| `components/enrollment-status-badge.tsx` | Shared status pill |

**Modified:**

| File | Change |
| --- | --- |
| `db/schema/index.ts` | Re-export the two new schema modules |
| `app/portal/actions.ts` | Add request and withdraw actions |
| `app/admin/actions.ts` | Add confirm, release, and offering-edit actions |
| `app/(public)/classes/page.tsx` | Availability already correct; no logic change |
| `app/portal/layout.tsx` | Nav link to enrollments |
| `app/admin/layout.tsx` | Nav link to the queue |

**Not modified:** `tests/setup/db.ts`. `resetDatabase` discovers tables from
`pg_tables` at runtime, so new tables are truncated automatically.

---

### Task 1: Enrollments and audit-log schema

**Files:**
- Create: `db/schema/enrollments.ts`
- Create: `db/schema/audit-log.ts`
- Modify: `db/schema/index.ts`
- Test: `tests/integration/enrollments-schema.test.ts`

**Interfaces:**
- Consumes: `students` (`db/schema/students.ts`), `classOfferings` (`db/schema/class-offerings.ts`), `user` (`db/schema/auth.ts`).
- Produces: `enrollments`, `enrollmentStatusEnum`, `type Enrollment`, `type EnrollmentStatus`, `auditLog`, `type AuditLogEntry`.

- [ ] **Step 1: Write the schema module for enrollments**

Create `db/schema/enrollments.ts`:

```ts
import { pgEnum, pgTable, timestamp, uniqueIndex, index, uuid, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { students } from "./students";
import { classOfferings } from "./class-offerings";
import { user } from "./auth";

export const enrollmentStatusEnum = pgEnum("enrollment_status", [
  "pending",
  "active",
  "withdrawn",
  "released",
]);

export type EnrollmentStatus = (typeof enrollmentStatusEnum.enumValues)[number];

export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    classOfferingId: uuid("class_offering_id")
      .notNull()
      .references(() => classOfferings.id, { onDelete: "cascade" }),
    status: enrollmentStatusEnum("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /*
     * The heart of the "new row each time" decision: history is kept forever,
     * but a student can hold at most one live seat in a given class. A
     * withdrawn or released row falls out of this index and stops blocking.
     */
    uniqueIndex("enrollments_one_live_per_student_class")
      .on(table.studentId, table.classOfferingId)
      .where(sql`${table.status} in ('pending', 'active')`),
    // The staff queue reads pending rows oldest-first.
    index("enrollments_status_requested_at_idx").on(table.status, table.requestedAt),
    index("enrollments_class_offering_id_idx").on(table.classOfferingId),
    index("enrollments_student_id_idx").on(table.studentId),
  ],
);

export type Enrollment = typeof enrollments.$inferSelect;
```

- [ ] **Step 2: Write the schema module for the audit log**

Create `db/schema/audit-log.ts`. Both user references use `onDelete: "set null"` so deleting a staff account never destroys the record of what they did.

```ts
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
    index("audit_log_created_at_idx").on(table.createdAt),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
```

- [ ] **Step 3: Re-export both modules**

Append to `db/schema/index.ts`:

```ts
export * from "./enrollments";
export * from "./audit-log";
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`

Then read the generated file under `drizzle/`. Confirm by eye that it contains:

- `CREATE TYPE "public"."enrollment_status" AS ENUM('pending', 'active', 'withdrawn', 'released')`
- a `CREATE UNIQUE INDEX ... WHERE "status" in ('pending', 'active')` — the `WHERE` clause is the whole point. If it is missing, the partial index did not survive; fix Step 1 and regenerate rather than continuing.
- `ON DELETE set null` on both user references.

- [ ] **Step 5: Apply the migration**

Run: `npm run db:migrate`
Expected: applies with no error.

- [ ] **Step 6: Write the constraint tests**

Create `tests/integration/enrollments-schema.test.ts`. The `seedOffering` helper below is reused by later tasks — copy it into each test file that needs it rather than extracting it, so each file stays readable on its own.

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { classOfferings, enrollments, families, seasons, students } from "@/db/schema";

async function seedOffering(db: TestDb, capacity = 10) {
  const [family] = await db.insert(families).values({ name: "Alvarez" }).returning();
  const [student] = await db
    .insert(students)
    .values({
      familyId: family!.id,
      firstName: "Ana",
      lastName: "Alvarez",
      birthdate: "2015-04-02",
    })
    .returning();
  const [season] = await db
    .insert(seasons)
    .values({
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-18",
      registrationOpen: true,
    })
    .returning();
  const [offering] = await db
    .insert(classOfferings)
    .values({
      seasonId: season!.id,
      name: "Ballet I",
      dayOfWeek: "monday",
      startTime: "16:00:00",
      endTime: "17:00:00",
      capacity,
      monthlyPriceCents: 8500,
    })
    .returning();
  return { family: family!, student: student!, season: season!, offering: offering! };
}

describe("enrollments schema", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("defaults a new enrollment to pending", async () => {
    const { student, offering } = await seedOffering(db);

    const [row] = await db
      .insert(enrollments)
      .values({ studentId: student.id, classOfferingId: offering.id })
      .returning();

    expect(row?.status).toBe("pending");
    expect(row?.confirmedAt).toBeNull();
  });

  it("refuses a second live request for the same student and class", async () => {
    const { student, offering } = await seedOffering(db);
    await db.insert(enrollments).values({ studentId: student.id, classOfferingId: offering.id });

    await expect(
      db.insert(enrollments).values({ studentId: student.id, classOfferingId: offering.id }),
    ).rejects.toThrow();
  });

  it("allows a fresh request once the previous one is withdrawn", async () => {
    const { student, offering } = await seedOffering(db);
    await db.insert(enrollments).values({
      studentId: student.id,
      classOfferingId: offering.id,
      status: "withdrawn",
    });

    const [row] = await db
      .insert(enrollments)
      .values({ studentId: student.id, classOfferingId: offering.id })
      .returning();

    expect(row?.status).toBe("pending");
  });

  it("removes enrollments when the class offering is deleted", async () => {
    const { student, offering } = await seedOffering(db);
    await db.insert(enrollments).values({ studentId: student.id, classOfferingId: offering.id });

    await db.delete(classOfferings);

    const rows = await db.select().from(enrollments);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/integration/enrollments-schema.test.ts`

Expected: all four pass. Unlike the rest of this plan, this task's tests verify database constraints that the migration already installed, so they pass on first run rather than starting red. If the second test fails, the partial unique index is wrong — fix the schema, regenerate, and re-apply.

- [ ] **Step 8: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add db/schema drizzle tests/integration/enrollments-schema.test.ts
git commit -m "feat: add enrollments and audit log schema"
```

---

### Task 2: The executor type and the audit writer

Every enrollment transition writes an audit row inside the same transaction that
moves the seat. That means `recordAudit` must accept a transaction handle, not
just the pool-backed client — hence a shared `Executor` type.

**Files:**
- Create: `db/queries/executor.ts`
- Create: `db/queries/audit-log.ts`
- Test: `tests/integration/audit-log.test.ts`

**Interfaces:**
- Produces: `type Executor`, `recordAudit(exec, entry): Promise<AuditLogEntry>`, `type AuditEntryInput`, `listAuditEntries(db, entityType, entityId)`.

- [ ] **Step 1: Write the executor type**

Create `db/queries/executor.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/audit-log.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { listAuditEntries, recordAudit } from "@/db/queries/audit-log";

describe("recordAudit", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("writes an entry with before and after snapshots", async () => {
    const entityId = crypto.randomUUID();

    const entry = await recordAudit(db, {
      actorUserId: null,
      action: "enrollment.confirmed",
      entityType: "enrollment",
      entityId,
      before: { status: "pending" },
      after: { status: "active" },
    });

    expect(entry.action).toBe("enrollment.confirmed");
    expect(entry.before).toEqual({ status: "pending" });
    expect(entry.after).toEqual({ status: "active" });
  });

  it("accepts a null actor for system-originated changes", async () => {
    const entry = await recordAudit(db, {
      actorUserId: null,
      action: "enrollment.requested",
      entityType: "enrollment",
      entityId: crypto.randomUUID(),
      before: null,
      after: { status: "pending" },
    });

    expect(entry.actorUserId).toBeNull();
  });

  it("rolls back with its transaction", async () => {
    const entityId = crypto.randomUUID();

    await expect(
      db.transaction(async (tx) => {
        await recordAudit(tx, {
          actorUserId: null,
          action: "enrollment.requested",
          entityType: "enrollment",
          entityId,
          before: null,
          after: { status: "pending" },
        });
        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow("deliberate rollback");

    const entries = await listAuditEntries(db, "enrollment", entityId);
    expect(entries).toHaveLength(0);
  });

  it("returns entries for one entity newest first", async () => {
    const entityId = crypto.randomUUID();
    await recordAudit(db, {
      actorUserId: null,
      action: "enrollment.requested",
      entityType: "enrollment",
      entityId,
      before: null,
      after: { status: "pending" },
    });
    await recordAudit(db, {
      actorUserId: null,
      action: "enrollment.confirmed",
      entityType: "enrollment",
      entityId,
      before: { status: "pending" },
      after: { status: "active" },
    });

    const entries = await listAuditEntries(db, "enrollment", entityId);

    expect(entries.map((e) => e.action)).toEqual([
      "enrollment.confirmed",
      "enrollment.requested",
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/audit-log.test.ts`
Expected: FAIL — cannot resolve `@/db/queries/audit-log`.

- [ ] **Step 4: Write the minimal implementation**

Create `db/queries/audit-log.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { auditLog, type AuditLogEntry } from "@/db/schema";
import type { Database, Executor } from "./executor";

export type AuditEntryInput = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
};

/**
 * The only writer to `audit_log`.
 *
 * Takes an `Executor` rather than a `Database` so callers can pass a
 * transaction handle: an audit row that survives a rolled-back transition
 * would be a lie about what happened.
 */
export async function recordAudit(
  exec: Executor,
  entry: AuditEntryInput,
): Promise<AuditLogEntry> {
  const [row] = await exec.insert(auditLog).values(entry).returning();
  if (!row) throw new Error("recordAudit: insert returned no row");
  return row;
}

/** Newest first — the order a person reading a dispute wants. */
export async function listAuditEntries(
  db: Database,
  entityType: string,
  entityId: string,
): Promise<AuditLogEntry[]> {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/audit-log.test.ts`
Expected: 4 passed.

Note on the newest-first test: two rows written in the same millisecond would
otherwise tie, so `listAuditEntries` breaks ties on `id`. If that test proves
flaky, the tie-break is the thing to look at, not the test.

- [ ] **Step 6: Run the full suite and commit**

```bash
npm test && npm run typecheck
git add db/queries/executor.ts db/queries/audit-log.ts tests/integration/audit-log.test.ts
git commit -m "feat: add the audit log writer"
```

---

### Task 3: The seat claim — requesting an enrollment

This is the task the whole phase rests on. Read §4 "The last-seat race" in the
spec before starting.

**Files:**
- Create: `db/queries/enrollments.ts`
- Test: `tests/integration/enrollment-request.test.ts`

**Interfaces:**
- Consumes: `recordAudit`, `type Executor`, `type Database` (Task 2); `enrollments`, `classOfferings`, `seasons`, `students` (Task 1 and existing schema).
- Produces: `requestEnrollment(db, familyId, input): Promise<RequestResult>`, `type RequestResult`, `type RequestInput`, `isUniqueViolation(error)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/enrollment-request.test.ts`. Note the second family in
`seedTwoFamilies` — the concurrency test needs two different students, or the
partial unique index rather than capacity would be what rejects the loser, and
the test would pass for the wrong reason.

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { classOfferings, enrollments, families, seasons, students } from "@/db/schema";
import { requestEnrollment } from "@/db/queries/enrollments";
import { listAuditEntries } from "@/db/queries/audit-log";

async function seedTwoFamilies(db: TestDb, capacity: number, opts?: { published?: boolean; registrationOpen?: boolean }) {
  const published = opts?.published ?? true;
  const registrationOpen = opts?.registrationOpen ?? true;

  const [familyA] = await db.insert(families).values({ name: "Alvarez" }).returning();
  const [familyB] = await db.insert(families).values({ name: "Brooks" }).returning();
  const [studentA] = await db
    .insert(students)
    .values({ familyId: familyA!.id, firstName: "Ana", lastName: "Alvarez", birthdate: "2015-04-02" })
    .returning();
  const [studentB] = await db
    .insert(students)
    .values({ familyId: familyB!.id, firstName: "Ben", lastName: "Brooks", birthdate: "2014-07-19" })
    .returning();
  const [season] = await db
    .insert(seasons)
    .values({ name: "Fall 2026", startDate: "2026-09-01", endDate: "2026-12-18", registrationOpen })
    .returning();
  const [offering] = await db
    .insert(classOfferings)
    .values({
      seasonId: season!.id,
      name: "Ballet I",
      dayOfWeek: "monday",
      startTime: "16:00:00",
      endTime: "17:00:00",
      capacity,
      monthlyPriceCents: 8500,
      published,
    })
    .returning();

  return {
    familyA: familyA!,
    familyB: familyB!,
    studentA: studentA!,
    studentB: studentB!,
    offering: offering!,
  };
}

async function seatsTaken(db: TestDb, offeringId: string): Promise<number> {
  const [row] = await db.select().from(classOfferings).where(eq(classOfferings.id, offeringId));
  return row!.seatsTaken;
}

describe("requestEnrollment", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("creates a pending enrollment and claims a seat", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enrollment.status).toBe("pending");
    expect(await seatsTaken(db, offering.id)).toBe(1);
  });

  it("writes an audit entry for the request", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!result.ok) throw new Error("expected the request to succeed");

    const entries = await listAuditEntries(db, "enrollment", result.enrollment.id);
    expect(entries.map((e) => e.action)).toEqual(["enrollment.requested"]);
  });

  it("rejects a request for a student in another family", async () => {
    const { familyA, studentB, offering } = await seedTwoFamilies(db, 10);

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(await seatsTaken(db, offering.id)).toBe(0);
  });

  it("rejects a request when the class is full", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 1);
    await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    const result = await requestEnrollment(db, familyB.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "full" });
    expect(await seatsTaken(db, offering.id)).toBe(1);
  });

  it("rejects a request when registration is closed for the season", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10, { registrationOpen: false });

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "closed" });
    expect(await seatsTaken(db, offering.id)).toBe(0);
  });

  it("rejects a request for an unpublished class", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10, { published: false });

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "closed" });
  });

  it("rejects a duplicate request and does not consume a second seat", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "duplicate" });
    expect(await seatsTaken(db, offering.id)).toBe(1);
  });

  /*
   * The test this whole mechanism exists for. Two parents click at the same
   * moment on the last seat. Exactly one may win.
   *
   * `vitest.config.ts` sets `fileParallelism: false`, so concurrency here comes
   * from two promises sharing one pool, not from parallel test files.
   */
  it("lets exactly one of two simultaneous requests take the last seat", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 1);

    const results = await Promise.all([
      requestEnrollment(db, familyA.id, {
        studentId: studentA.id,
        offeringId: offering.id,
        actorUserId: null,
      }),
      requestEnrollment(db, familyB.id, {
        studentId: studentB.id,
        offeringId: offering.id,
        actorUserId: null,
      }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "full" });
    expect(await seatsTaken(db, offering.id)).toBe(1);

    const rows = await db.select().from(enrollments);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/enrollment-request.test.ts`
Expected: FAIL — cannot resolve `@/db/queries/enrollments`.

- [ ] **Step 3: Write the implementation**

Create `db/queries/enrollments.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import { classOfferings, enrollments, seasons, students, type Enrollment } from "@/db/schema";
import { recordAudit } from "./audit-log";
import type { Database } from "./executor";

export type RequestInput = {
  studentId: string;
  offeringId: string;
  actorUserId: string | null;
};

export type RequestResult =
  | { ok: true; enrollment: Enrollment }
  | { ok: false; reason: "not-found" | "closed" | "full" | "duplicate" };

/** Postgres unique-violation SQLSTATE. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

/**
 * Requests a seat, claiming it at request time.
 *
 * `familyId` comes first and the student is verified through it in SQL, so a
 * student ID belonging to another family simply finds nothing.
 *
 * The seat claim is a single conditional UPDATE whose affected-row count is the
 * decision — never a read followed by a write, which another transaction could
 * interleave with. The claim, the insert, and the audit row share one
 * transaction, so the counter and the roster can never disagree.
 */
export async function requestEnrollment(
  db: Database,
  familyId: string,
  input: RequestInput,
): Promise<RequestResult> {
  try {
    return await db.transaction(async (tx) => {
      const [student] = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.id, input.studentId), eq(students.familyId, familyId)))
        .limit(1);
      if (!student) return { ok: false, reason: "not-found" } as const;

      // The class must be published and its season still accepting requests.
      const [open] = await tx
        .select({ id: classOfferings.id })
        .from(classOfferings)
        .innerJoin(seasons, eq(classOfferings.seasonId, seasons.id))
        .where(
          and(
            eq(classOfferings.id, input.offeringId),
            eq(classOfferings.published, true),
            eq(seasons.registrationOpen, true),
          ),
        )
        .limit(1);
      if (!open) return { ok: false, reason: "closed" } as const;

      // Claim the seat. Zero rows means the class filled up.
      const claimed = await tx
        .update(classOfferings)
        .set({ seatsTaken: sql`${classOfferings.seatsTaken} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(classOfferings.id, input.offeringId),
            sql`${classOfferings.seatsTaken} < ${classOfferings.capacity}`,
          ),
        )
        .returning({ id: classOfferings.id });
      if (claimed.length === 0) return { ok: false, reason: "full" } as const;

      /*
       * No pre-check for an existing request: the partial unique index is the
       * guard, and letting it raise is race-free where a SELECT-then-INSERT is
       * not. The violation aborts this transaction, which is exactly right —
       * the seat increment above is rolled back with it. It is caught outside
       * the transaction because a Postgres transaction cannot continue after a
       * failed statement.
       */
      const [enrollment] = await tx
        .insert(enrollments)
        .values({ studentId: input.studentId, classOfferingId: input.offeringId })
        .returning();
      if (!enrollment) throw new Error("requestEnrollment: insert returned no row");

      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: "enrollment.requested",
        entityType: "enrollment",
        entityId: enrollment.id,
        before: null,
        after: { status: enrollment.status, classOfferingId: input.offeringId },
      });

      return { ok: true, enrollment } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/enrollment-request.test.ts`
Expected: 8 passed.

If the concurrency test fails intermittently, do **not** add a retry or a sleep.
A failure there means the claim is not actually atomic — re-read the `WHERE`
clause on the seat UPDATE.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck
git add db/queries/enrollments.ts tests/integration/enrollment-request.test.ts
git commit -m "feat: claim a seat atomically when a parent requests enrollment"
```

---

### Task 4: Staff transitions — confirm and release

**Files:**
- Modify: `db/queries/enrollments.ts`
- Test: `tests/integration/enrollment-transitions.test.ts`

**Interfaces:**
- Produces: `confirmEnrollment(db, input): Promise<TransitionResult>`, `releaseEnrollment(db, input): Promise<TransitionResult>`, `type TransitionResult`.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/enrollment-transitions.test.ts`. Copy `seedTwoFamilies`
and `seatsTaken` from Task 3's test file verbatim, then add:

```ts
describe("confirmEnrollment", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("moves a pending request to active without changing the seat count", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
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
    expect(result.enrollment.status).toBe("active");
    expect(result.enrollment.confirmedAt).not.toBeNull();
    expect(result.enrollment.startDate).not.toBeNull();
    // The seat was already held by the pending request.
    expect(await seatsTaken(db, offering.id)).toBe(1);
  });

  it("refuses to confirm a request that is not pending", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    await confirmEnrollment(db, { enrollmentId: requested.enrollment.id, actorUserId: null });

    const result = await confirmEnrollment(db, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "not-pending" });
  });

  it("reports a missing enrollment", async () => {
    const result = await confirmEnrollment(db, {
      enrollmentId: crypto.randomUUID(),
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("releaseEnrollment", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("returns the seat to the class", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
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
    expect(result.enrollment.status).toBe("released");
    expect(result.enrollment.endDate).not.toBeNull();
    expect(await seatsTaken(db, offering.id)).toBe(0);
  });

  /*
   * Two staff members clicking Release on the same request. Without the status
   * predicate on the UPDATE, both would decrement and the counter would drift
   * below the true roster.
   */
  it("does not release the same seat twice", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const [first, second] = await Promise.all([
      releaseEnrollment(db, { enrollmentId: requested.enrollment.id, actorUserId: null }),
      releaseEnrollment(db, { enrollmentId: requested.enrollment.id, actorUserId: null }),
    ]);

    expect([first!.ok, second!.ok].filter(Boolean)).toHaveLength(1);
    expect(await seatsTaken(db, offering.id)).toBe(0);
  });

  it("frees the seat for another family", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 1);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    await releaseEnrollment(db, { enrollmentId: requested.enrollment.id, actorUserId: null });

    const second = await requestEnrollment(db, familyB.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(second.ok).toBe(true);
  });
});
```

Add these imports at the top of the file:

```ts
import { confirmEnrollment, releaseEnrollment, requestEnrollment } from "@/db/queries/enrollments";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/enrollment-transitions.test.ts`
Expected: FAIL — `confirmEnrollment` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `db/queries/enrollments.ts`:

```ts
export type TransitionInput = {
  enrollmentId: string;
  actorUserId: string | null;
};

export type TransitionResult =
  | { ok: true; enrollment: Enrollment }
  | { ok: false; reason: "not-found" | "not-pending" };

/** `YYYY-MM-DD` in UTC, matching the convention in `lib/dates.ts`. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Marks a pending request confirmed after staff have taken payment in person.
 *
 * Deliberately does not touch `seats_taken`: a pending request already holds a
 * real seat, and the only thing changing here is whether the studio has been
 * paid.
 */
export async function confirmEnrollment(
  db: Database,
  input: TransitionInput,
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, input.enrollmentId))
      .limit(1);
    if (!before) return { ok: false, reason: "not-found" } as const;

    const [row] = await tx
      .update(enrollments)
      .set({
        status: "active",
        confirmedAt: new Date(),
        confirmedByUserId: input.actorUserId,
        startDate: todayIso(),
        updatedAt: new Date(),
      })
      .where(and(eq(enrollments.id, input.enrollmentId), eq(enrollments.status, "pending")))
      .returning();
    if (!row) return { ok: false, reason: "not-pending" } as const;

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "enrollment.confirmed",
      entityType: "enrollment",
      entityId: row.id,
      before: { status: before.status },
      after: { status: row.status },
    });

    return { ok: true, enrollment: row } as const;
  });
}

/**
 * Releases a pending request that never turned into a payment, returning the
 * seat to the class.
 *
 * The status predicate on the UPDATE is what makes this safe against two staff
 * members acting at once: the seat is only given back when this call is the one
 * that actually moved the row.
 */
export async function releaseEnrollment(
  db: Database,
  input: TransitionInput,
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, input.enrollmentId))
      .limit(1);
    if (!before) return { ok: false, reason: "not-found" } as const;

    const [row] = await tx
      .update(enrollments)
      .set({ status: "released", endDate: todayIso(), updatedAt: new Date() })
      .where(and(eq(enrollments.id, input.enrollmentId), eq(enrollments.status, "pending")))
      .returning();
    if (!row) return { ok: false, reason: "not-pending" } as const;

    await tx
      .update(classOfferings)
      .set({ seatsTaken: sql`${classOfferings.seatsTaken} - 1`, updatedAt: new Date() })
      .where(
        and(
          eq(classOfferings.id, row.classOfferingId),
          sql`${classOfferings.seatsTaken} > 0`,
        ),
      );

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "enrollment.released",
      entityType: "enrollment",
      entityId: row.id,
      before: { status: before.status },
      after: { status: row.status },
    });

    return { ok: true, enrollment: row } as const;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/enrollment-transitions.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck
git add db/queries/enrollments.ts tests/integration/enrollment-transitions.test.ts
git commit -m "feat: add staff confirm and release transitions"
```

---

### Task 5: Parent withdrawal

**Files:**
- Modify: `db/queries/enrollments.ts`
- Test: `tests/integration/enrollment-withdrawal.test.ts`

**Interfaces:**
- Produces: `withdrawEnrollment(db, familyId, input): Promise<TransitionResult>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/enrollment-withdrawal.test.ts`, copying
`seedTwoFamilies` and `seatsTaken` from Task 3 as before:

```ts
describe("withdrawEnrollment", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("withdraws an active enrollment and frees the seat", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    await confirmEnrollment(db, { enrollmentId: requested.enrollment.id, actorUserId: null });

    const result = await withdrawEnrollment(db, familyA.id, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enrollment.status).toBe("withdrawn");
    expect(await seatsTaken(db, offering.id)).toBe(0);
  });

  it("withdraws a still-pending request", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const result = await withdrawEnrollment(db, familyA.id, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    expect(await seatsTaken(db, offering.id)).toBe(0);
  });

  it("refuses to withdraw another family's enrollment", async () => {
    const { familyA, familyB, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const result = await withdrawEnrollment(db, familyB.id, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "not-found" });
    // The seat stays held — the attempt changed nothing.
    expect(await seatsTaken(db, offering.id)).toBe(1);
  });

  it("lets the student request the class again after withdrawing", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const first = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!first.ok) throw new Error("expected the request to succeed");
    await withdrawEnrollment(db, familyA.id, {
      enrollmentId: first.enrollment.id,
      actorUserId: null,
    });

    const second = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // A new row, not the old one revived — the history is kept.
    expect(second.enrollment.id).not.toBe(first.enrollment.id);
    expect(await seatsTaken(db, offering.id)).toBe(1);
  });
});
```

Imports for this file:

```ts
import {
  confirmEnrollment,
  requestEnrollment,
  withdrawEnrollment,
} from "@/db/queries/enrollments";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/enrollment-withdrawal.test.ts`
Expected: FAIL — `withdrawEnrollment` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `db/queries/enrollments.ts`:

```ts
/**
 * A parent withdrawing their own student. The seat is freed immediately so
 * another family can take it.
 *
 * Ownership is enforced in SQL through a subquery on `students`, not by
 * fetching the row and comparing in application code — same rule as every other
 * family-scoped query here. An enrollment belonging to another family is
 * indistinguishable from one that does not exist.
 */
export async function withdrawEnrollment(
  db: Database,
  familyId: string,
  input: TransitionInput,
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(enrollments)
      .set({ status: "withdrawn", endDate: todayIso(), updatedAt: new Date() })
      .where(
        and(
          eq(enrollments.id, input.enrollmentId),
          inArray(enrollments.status, ["pending", "active"]),
          sql`${enrollments.studentId} IN (
            SELECT ${students.id} FROM ${students} WHERE ${students.familyId} = ${familyId}
          )`,
        ),
      )
      .returning();
    if (!row) return { ok: false, reason: "not-found" } as const;

    await tx
      .update(classOfferings)
      .set({ seatsTaken: sql`${classOfferings.seatsTaken} - 1`, updatedAt: new Date() })
      .where(
        and(
          eq(classOfferings.id, row.classOfferingId),
          sql`${classOfferings.seatsTaken} > 0`,
        ),
      );

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "enrollment.withdrawn",
      entityType: "enrollment",
      entityId: row.id,
      before: { status: "pending-or-active" },
      after: { status: row.status },
    });

    return { ok: true, enrollment: row } as const;
  });
}
```

Add `inArray` to the `drizzle-orm` import at the top of the file:

```ts
import { and, eq, inArray, sql } from "drizzle-orm";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/enrollment-withdrawal.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck
git add db/queries/enrollments.ts tests/integration/enrollment-withdrawal.test.ts
git commit -m "feat: let a parent withdraw a student from a class"
```

---

### Task 6: Reading the queue, the roster, and a family's requests

**Files:**
- Modify: `db/queries/enrollments.ts`
- Test: `tests/integration/enrollment-reads.test.ts`

**Interfaces:**
- Produces: `listPendingRequests(db)`, `listRoster(db, offeringId)`, `listFamilyEnrollments(db, familyId)`, `type PendingRequest`, `type RosterEntry`, `type FamilyEnrollment`.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/enrollment-reads.test.ts`, copying `seedTwoFamilies`:

```ts
describe("listPendingRequests", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("returns pending requests oldest first", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 10);
    const first = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!first.ok) throw new Error("expected the request to succeed");
    const second = await requestEnrollment(db, familyB.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!second.ok) throw new Error("expected the request to succeed");

    const queue = await listPendingRequests(db);

    expect(queue.map((r) => r.enrollmentId)).toEqual([
      first.enrollment.id,
      second.enrollment.id,
    ]);
    expect(queue[0]?.studentFirstName).toBe("Ana");
    expect(queue[0]?.className).toBe("Ballet I");
    expect(queue[0]?.familyName).toBe("Alvarez");
  });

  it("drops a request once it is confirmed", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    await confirmEnrollment(db, { enrollmentId: requested.enrollment.id, actorUserId: null });

    expect(await listPendingRequests(db)).toHaveLength(0);
  });
});

describe("listRoster", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("includes both pending and active students", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 10);
    const a = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!a.ok) throw new Error("expected the request to succeed");
    await confirmEnrollment(db, { enrollmentId: a.enrollment.id, actorUserId: null });
    await requestEnrollment(db, familyB.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    const roster = await listRoster(db, offering.id);

    expect(roster).toHaveLength(2);
    expect(roster.map((r) => r.status).sort()).toEqual(["active", "pending"]);
  });

  it("excludes withdrawn students", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
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

    expect(await listRoster(db, offering.id)).toHaveLength(0);
  });
});

describe("listFamilyEnrollments", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("returns only this family's enrollments, including finished ones", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 10);
    const mine = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!mine.ok) throw new Error("expected the request to succeed");
    await withdrawEnrollment(db, familyA.id, {
      enrollmentId: mine.enrollment.id,
      actorUserId: null,
    });
    await requestEnrollment(db, familyB.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    const rows = await listFamilyEnrollments(db, familyA.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("withdrawn");
    expect(rows[0]?.studentFirstName).toBe("Ana");
  });
});
```

Imports for this file:

```ts
import {
  confirmEnrollment,
  listFamilyEnrollments,
  listPendingRequests,
  listRoster,
  requestEnrollment,
  withdrawEnrollment,
} from "@/db/queries/enrollments";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/enrollment-reads.test.ts`
Expected: FAIL — `listPendingRequests` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `db/queries/enrollments.ts`:

```ts
export type PendingRequest = {
  enrollmentId: string;
  requestedAt: Date;
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  familyName: string;
  classOfferingId: string;
  className: string;
  monthlyPriceCents: number;
  seasonFeeCents: number;
};

/**
 * The staff confirmation queue, oldest first.
 *
 * Order is the mitigation for holds that never expire: the longest-waiting
 * request is the first thing staff see. See §4 "Seat holds never expire".
 */
export async function listPendingRequests(db: Database): Promise<PendingRequest[]> {
  return db
    .select({
      enrollmentId: enrollments.id,
      requestedAt: enrollments.requestedAt,
      studentId: students.id,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      familyName: families.name,
      classOfferingId: classOfferings.id,
      className: classOfferings.name,
      monthlyPriceCents: classOfferings.monthlyPriceCents,
      seasonFeeCents: classOfferings.seasonFeeCents,
    })
    .from(enrollments)
    .innerJoin(students, eq(enrollments.studentId, students.id))
    .innerJoin(families, eq(students.familyId, families.id))
    .innerJoin(classOfferings, eq(enrollments.classOfferingId, classOfferings.id))
    .where(eq(enrollments.status, "pending"))
    .orderBy(asc(enrollments.requestedAt), asc(enrollments.id));
}

export type RosterEntry = {
  enrollmentId: string;
  status: EnrollmentStatus;
  studentFirstName: string;
  studentLastName: string;
  familyName: string;
  requestedAt: Date;
};

/** Everyone holding a seat in one class — pending and active alike. */
export async function listRoster(db: Database, offeringId: string): Promise<RosterEntry[]> {
  return db
    .select({
      enrollmentId: enrollments.id,
      status: enrollments.status,
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      familyName: families.name,
      requestedAt: enrollments.requestedAt,
    })
    .from(enrollments)
    .innerJoin(students, eq(enrollments.studentId, students.id))
    .innerJoin(families, eq(students.familyId, families.id))
    .where(
      and(
        eq(enrollments.classOfferingId, offeringId),
        inArray(enrollments.status, ["pending", "active"]),
      ),
    )
    .orderBy(asc(students.lastName), asc(students.firstName));
}

export type FamilyEnrollment = {
  enrollmentId: string;
  status: EnrollmentStatus;
  requestedAt: Date;
  studentId: string;
  studentFirstName: string;
  className: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  monthlyPriceCents: number;
  seasonFeeCents: number;
};

/**
 * Every enrollment belonging to one family, newest first, including withdrawn
 * and released rows so a parent can see what happened.
 */
export async function listFamilyEnrollments(
  db: Database,
  familyId: string,
): Promise<FamilyEnrollment[]> {
  return db
    .select({
      enrollmentId: enrollments.id,
      status: enrollments.status,
      requestedAt: enrollments.requestedAt,
      studentId: students.id,
      studentFirstName: students.firstName,
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
    .where(eq(students.familyId, familyId))
    .orderBy(desc(enrollments.requestedAt));
}
```

Update the imports at the top of `db/queries/enrollments.ts`:

```ts
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  classOfferings,
  enrollments,
  families,
  seasons,
  students,
  type DayOfWeek,
  type Enrollment,
  type EnrollmentStatus,
} from "@/db/schema";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/enrollment-reads.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck
git add db/queries/enrollments.ts tests/integration/enrollment-reads.test.ts
git commit -m "feat: add queue, roster, and family enrollment reads"
```

---

### Task 7: Portal — requesting a seat

**Files:**
- Create: `lib/enrollment-validation.ts`
- Create: `components/enrollment-request-form.tsx`
- Create: `components/enrollment-status-badge.tsx`
- Modify: `app/portal/actions.ts`
- Modify: `app/portal/page.tsx`
- Test: `tests/unit/enrollment-validation.test.ts`

**Interfaces:**
- Consumes: `requestEnrollment` (Task 3), `listFamilyEnrollments` (Task 6), `requireUser`/`requireFamilyId` (`lib/guards.ts`), `ActionState`/`idleState` (`lib/action-state.ts`).
- Produces: `enrollmentRequestSchema`, `requestEnrollmentAction`, `EnrollmentRequestForm`, `EnrollmentStatusBadge`.

- [ ] **Step 1: Write the failing validation test**

Create `tests/unit/enrollment-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { enrollmentRequestSchema } from "@/lib/enrollment-validation";

describe("enrollmentRequestSchema", () => {
  it("accepts a pair of UUIDs", () => {
    const result = enrollmentRequestSchema.safeParse({
      studentId: "8f1b6f9e-1f5c-4a2b-9c3d-2e4f5a6b7c8d",
      offeringId: "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a studentId that is not a UUID", () => {
    const result = enrollmentRequestSchema.safeParse({
      studentId: "not-a-uuid",
      offeringId: "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing offeringId", () => {
    const result = enrollmentRequestSchema.safeParse({
      studentId: "8f1b6f9e-1f5c-4a2b-9c3d-2e4f5a6b7c8d",
    });

    expect(result.success).toBe(false);
  });

  it("requires a student to be chosen", () => {
    const result = enrollmentRequestSchema.safeParse({
      studentId: "",
      offeringId: "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe("Choose a student.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/enrollment-validation.test.ts`
Expected: FAIL — cannot resolve `@/lib/enrollment-validation`.

- [ ] **Step 3: Write the schema**

Create `lib/enrollment-validation.ts`. Follow the message style already used in
`lib/validation.ts` — short sentences a parent can act on.

```ts
import { z } from "zod";

export const enrollmentRequestSchema = z.object({
  studentId: z.uuid("Choose a student."),
  offeringId: z.uuid("Choose a class."),
});

export const enrollmentIdSchema = z.object({
  enrollmentId: z.uuid("That enrollment could not be found."),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/enrollment-validation.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Add the server action**

Append to `app/portal/actions.ts`, following the existing shape in that file
(`_prevState` first, `toObject(formData)`, a `safeParse`, then `revalidatePath`):

```ts
export async function requestEnrollmentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const familyId = await requireFamilyId();
  // `app/portal/actions.ts` has no generic `toObject` helper — only a
  // student-specific `readForm`. Read the two fields directly, matching the
  // `String(formData.get(...))` idiom already in that file.
  const parsed = enrollmentRequestSchema.safeParse({
    studentId: String(formData.get("studentId") ?? ""),
    offeringId: String(formData.get("offeringId") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const result = await requestEnrollment(db, familyId, {
    studentId: parsed.data.studentId,
    offeringId: parsed.data.offeringId,
    actorUserId: user.id,
  });

  if (!result.ok) {
    // Every branch is a normal outcome a parent can act on, not an exception.
    const message = {
      "not-found": "That student could not be found.",
      closed: "This class is not accepting requests right now.",
      full: "This class filled up before your request went through.",
      duplicate: "That student already has a seat in this class.",
    }[result.reason];
    return { error: message };
  }

  revalidatePath("/portal/enrollments");
  revalidatePath("/classes");
  return { error: null };
}
```

Add the imports this needs at the top of the file:

```ts
import { requestEnrollment } from "@/db/queries/enrollments";
import { enrollmentRequestSchema } from "@/lib/enrollment-validation";
import { requireFamilyId, requireUser } from "@/lib/guards";
```

- [ ] **Step 6: Write the status badge**

Create `components/enrollment-status-badge.tsx`. Wording matters here — the spec
requires a pending request to read as "bring payment to the studio".

```tsx
import type { EnrollmentStatus } from "@/db/schema";

const LABELS: Record<EnrollmentStatus, string> = {
  pending: "Requested — bring payment to the studio",
  active: "Enrolled",
  withdrawn: "Withdrawn",
  released: "Released",
};

export function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  return <span data-status={status}>{LABELS[status]}</span>;
}
```

Style it with the Tailwind classes already used for pills elsewhere in
`components/`; match the surrounding design system rather than inventing new
colors.

- [ ] **Step 7: Write the request form**

Create `components/enrollment-request-form.tsx` as a client component using
`useActionState`, mirroring `components/student-form.tsx`. It takes the family's
students and one `offeringId`, renders a student `<select>` and a submit button,
and shows `state.error` when present. Disable the button when the family has no
students, with a link to `/portal/students/new`.

- [ ] **Step 8: Surface it on the portal**

Modify `app/portal/page.tsx` to list the published classes for the open season
with an `EnrollmentRequestForm` on each, hiding the form for classes where
`seatsTaken >= capacity` and showing "Full" instead.

- [ ] **Step 9: Verify by hand**

Run `npm run dev`, sign in as a parent with at least one student, and request a
class. Confirm the request appears and that requesting the same class twice
gives "That student already has a seat in this class."

- [ ] **Step 10: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add lib/enrollment-validation.ts components app/portal tests/unit/enrollment-validation.test.ts
git commit -m "feat: let a parent request a seat from the portal"
```

---

### Task 8: Portal — enrollments view and withdrawal

**Files:**
- Create: `app/portal/enrollments/page.tsx`
- Modify: `app/portal/actions.ts`
- Modify: `app/portal/layout.tsx`

**Interfaces:**
- Consumes: `listFamilyEnrollments`, `withdrawEnrollment` (Tasks 5–6), `EnrollmentStatusBadge` (Task 7).
- Produces: `withdrawEnrollmentAction`.

- [ ] **Step 1: Add the withdraw action**

Append to `app/portal/actions.ts`:

```ts
export async function withdrawEnrollmentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const familyId = await requireFamilyId();
  const parsed = enrollmentIdSchema.safeParse({
    enrollmentId: String(formData.get("enrollmentId") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const result = await withdrawEnrollment(db, familyId, {
    enrollmentId: parsed.data.enrollmentId,
    actorUserId: user.id,
  });

  if (!result.ok) {
    return { error: "That enrollment could not be withdrawn." };
  }

  revalidatePath("/portal/enrollments");
  revalidatePath("/classes");
  return { error: null };
}
```

- [ ] **Step 2: Build the page**

Create `app/portal/enrollments/page.tsx` as a server component: call
`requireFamilyId()`, then `listFamilyEnrollments(db, familyId)`. Group rows by
student. Show class name, day and time via `formatTimeRange` from
`lib/format.ts`, the monthly price and season fee via `formatCents`, and the
`EnrollmentStatusBadge`. Render a Withdraw button only for `pending` and
`active` rows.

Empty state: "No class requests yet." with a link to `/portal`.

- [ ] **Step 3: Add the nav link**

Modify `app/portal/layout.tsx` to add a "Classes" link to `/portal/enrollments`
alongside the existing student links.

- [ ] **Step 4: Verify by hand**

Run `npm run dev`. Request a class, confirm it appears here as "Requested —
bring payment to the studio", withdraw it, and confirm the seat returns by
reloading `/classes`.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add app/portal
git commit -m "feat: show a family their requests and let them withdraw"
```

---

### Task 9: Admin — the confirmation queue

**Files:**
- Create: `app/admin/enrollments/page.tsx`
- Modify: `app/admin/actions.ts`
- Modify: `app/admin/layout.tsx`

**Interfaces:**
- Consumes: `listPendingRequests`, `confirmEnrollment`, `releaseEnrollment` (Tasks 4, 6), `requireStaff` (`lib/guards.ts`).
- Produces: `confirmEnrollmentAction`, `releaseEnrollmentAction`.

- [ ] **Step 1: Add both actions**

Append to `app/admin/actions.ts`, matching the `requireStaff()` pattern already
used by every action in that file:

```ts
export async function confirmEnrollmentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const parsed = enrollmentIdSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const result = await confirmEnrollment(db, {
    enrollmentId: parsed.data.enrollmentId,
    actorUserId: staff.id,
  });

  if (!result.ok) {
    return {
      error:
        result.reason === "not-found"
          ? "That request no longer exists."
          : "Someone else already acted on that request.",
    };
  }

  revalidatePath("/admin/enrollments");
  return { error: null };
}

export async function releaseEnrollmentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const parsed = enrollmentIdSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const result = await releaseEnrollment(db, {
    enrollmentId: parsed.data.enrollmentId,
    actorUserId: staff.id,
  });

  if (!result.ok) {
    return {
      error:
        result.reason === "not-found"
          ? "That request no longer exists."
          : "Someone else already acted on that request.",
    };
  }

  revalidatePath("/admin/enrollments");
  revalidatePath("/classes");
  return { error: null };
}
```

- [ ] **Step 2: Build the queue page**

Create `app/admin/enrollments/page.tsx`: `await requireStaff()`, then
`listPendingRequests(db)`. Render a table, oldest first, with student name,
family name, class, monthly price and season fee via `formatCents` (so staff
know what to collect), and **the age of the request in days** — the visibility
mitigation the spec relies on in place of automatic expiry.

Compute age from `requestedAt` on the server. Flag anything older than 14 days
visually.

Each row carries a Confirm and a Release button, each in its own form posting
the `enrollmentId`.

Empty state: "No requests waiting."

- [ ] **Step 3: Add the nav link**

Modify `app/admin/layout.tsx` to add "Requests" linking to `/admin/enrollments`.

- [ ] **Step 4: Verify by hand**

Run `npm run dev`, sign in as staff, and confirm a request. Check that the
parent's portal shows "Enrolled" afterward and that `seats_taken` did not change
on confirmation.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add app/admin
git commit -m "feat: add the staff confirmation queue"
```

---

### Task 10: Admin — class roster and editing an offering

`updateOffering` already exists in `db/queries/class-offerings.ts` with no UI on
it. This task gives it one, and handles the edge the CHECK constraint creates.

**Files:**
- Create: `app/admin/classes/[offeringId]/page.tsx`
- Modify: `app/admin/actions.ts`
- Modify: `app/admin/classes/page.tsx`
- Test: `tests/integration/offering-capacity.test.ts`

**Interfaces:**
- Consumes: `listRoster` (Task 6), `recordAudit` (Task 2), `getOffering`, `updateOffering` (existing).
- Produces: `updateOfferingAction`, `isCheckViolation(error)`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/offering-capacity.test.ts`. This pins down what
happens when staff shrink a class below the seats already claimed — the existing
`class_offerings_seats_within_capacity` CHECK rejects it at the database level,
and the UI must turn that into a sentence rather than a 500.

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { updateOffering } from "@/db/queries/class-offerings";
import { isCheckViolation } from "@/db/queries/enrollments";
// plus seedTwoFamilies and requestEnrollment, copied as in Task 3

describe("lowering capacity below the seats already taken", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("is rejected by the database", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 5);
    await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    await requestEnrollment(db, familyB.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    await expect(updateOffering(db, offering.id, { capacity: 1 })).rejects.toThrow();
  });

  it("is recognisable as a check violation", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 5);
    await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    let caught: unknown;
    try {
      await updateOffering(db, offering.id, { capacity: 0 });
    } catch (error) {
      caught = error;
    }

    expect(isCheckViolation(caught)).toBe(true);
  });

  it("allows lowering capacity to exactly the seats taken", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 5);
    await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    const updated = await updateOffering(db, offering.id, { capacity: 1 });

    expect(updated?.capacity).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/offering-capacity.test.ts`
Expected: FAIL — `isCheckViolation` is not exported.

- [ ] **Step 3: Add the helper**

Append to `db/queries/enrollments.ts`, next to `isUniqueViolation`:

```ts
/** Postgres check-violation SQLSTATE. */
export function isCheckViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23514";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/offering-capacity.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Add the edit action**

Append to `app/admin/actions.ts`:

```ts
export async function updateOfferingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const raw = toObject(formData);
  const offeringId = raw.offeringId;
  if (!offeringId) return { error: "That class could not be found." };

  const parsed = offeringInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const before = await getOffering(db, offeringId);
  if (!before) return { error: "That class could not be found." };

  try {
    const after = await updateOffering(db, offeringId, parsed.data);

    /*
     * §3 requires an audit row for every change touching capacity or published
     * prices — this is the record consulted when a parent says the price was
     * different when they signed up.
     */
    await recordAudit(db, {
      actorUserId: staff.id,
      action: "offering.updated",
      entityType: "class_offering",
      entityId: offeringId,
      before: {
        capacity: before.capacity,
        monthlyPriceCents: before.monthlyPriceCents,
        seasonFeeCents: before.seasonFeeCents,
        published: before.published,
      },
      after: after
        ? {
            capacity: after.capacity,
            monthlyPriceCents: after.monthlyPriceCents,
            seasonFeeCents: after.seasonFeeCents,
            published: after.published,
          }
        : null,
    });
  } catch (error) {
    if (isCheckViolation(error)) {
      return {
        error:
          "That capacity is lower than the number of seats already taken. Release requests first.",
      };
    }
    throw error;
  }

  revalidatePath(`/admin/classes/${offeringId}`);
  revalidatePath("/classes");
  return { error: null };
}
```

Add the imports this action needs at the top of `app/admin/actions.ts`. It
currently imports `createOffering, updateOffering` but not `getOffering`:

```ts
import { getOffering } from "@/db/queries/class-offerings";
import { recordAudit } from "@/db/queries/audit-log";
import { isCheckViolation } from "@/db/queries/enrollments";
import { enrollmentIdSchema } from "@/lib/enrollment-validation";
```

- [ ] **Step 6: Build the class detail page**

Create `app/admin/classes/[offeringId]/page.tsx`: `await requireStaff()`, load
the offering with `getOffering` and call `notFound()` when it is null, then
render two sections —

1. **Roster** from `listRoster(db, offeringId)`: student, family, status badge,
   and a seats summary reading `${offering.seatsTaken} of ${offering.capacity}`.
2. **Edit form** reusing `components/admin-form.tsx`, pre-filled, posting
   `updateOfferingAction` with a hidden `offeringId`.

- [ ] **Step 7: Link to it**

Modify `app/admin/classes/page.tsx` so each class name links to
`/admin/classes/<id>`.

- [ ] **Step 8: Run the full suite and commit**

```bash
npm test && npm run typecheck && npm run build
git add app/admin db/queries/enrollments.ts tests/integration/offering-capacity.test.ts
git commit -m "feat: add class roster and offering editing"
```

---

### Task 11: End-to-end test of the enrollment path

**Files:**
- Create: `e2e/enrollment.spec.ts`
- Modify: `e2e/fixtures/seed.ts`

**Interfaces:**
- Consumes: the seed helpers already in `e2e/fixtures/seed.ts`, which Task 13 of Phase 1 created.

- [ ] **Step 1: Extend the seed fixture**

Modify `e2e/fixtures/seed.ts` to add a helper that creates a season with
`registrationOpen: true` and a published class offering with a caller-supplied
capacity, returning both IDs. Follow the existing style in that file — it
connects with its own `Pool` and never imports `@/lib/env`.

- [ ] **Step 2: Write the spec**

Create `e2e/enrollment.spec.ts` with four scenarios:

1. **A parent requests a seat.** Register, add a student, open the portal,
   request the seeded class, and expect the text "Requested" on
   `/portal/enrollments`.
2. **Staff confirm it.** Sign in as a seeded staff account, open
   `/admin/enrollments`, click Confirm, and expect the row to leave the queue.
   Then sign back in as the parent and expect "Enrolled".
3. **A full class cannot be requested.** Seed a class with `capacity: 1` and its
   seat already taken, and expect `/classes` to show "Full" with no request
   control.
4. **Withdrawal returns the seat.** From the portal, withdraw, then expect
   `/classes` to show the seat available again.

Use the same helpers and selectors style as `e2e/registration.spec.ts`. Set the
staff account's role directly in the seed fixture with an `UPDATE`, since the
signup path cannot produce one.

- [ ] **Step 3: Run the e2e suite**

Run: `npm run test:e2e`
Expected: 8 passed (4 existing + 4 new).

- [ ] **Step 4: Run everything and commit**

```bash
npm test && npm run typecheck && npm run build && npm run test:e2e
git add e2e
git commit -m "test: add end-to-end coverage for the enrollment path"
```

---

## Phase 2 completion checklist

Confirm each by running the command and reading the output — not by assuming:

- [ ] `npm run typecheck` passes with no errors
- [ ] `npm test` passes every unit and integration suite
- [ ] `npm run test:e2e` passes all eight scenarios
- [ ] `npm run build` completes successfully
- [ ] Two simultaneous requests for one seat leave `seats_taken` at exactly 1 (Task 3's concurrency test)
- [ ] A pending request is visible on `/classes` as a taken seat
- [ ] Confirming a request does not change `seats_taken`
- [ ] Releasing and withdrawing each return exactly one seat, and doing it twice returns only one
- [ ] A parent cannot withdraw another family's enrollment
- [ ] The admin queue is sorted oldest-first and shows each request's age
- [ ] Editing a class's capacity or price wrote an `offering.updated` audit row
- [ ] Every transition wrote an `audit_log` row — check with
      `SELECT action, count(*) FROM audit_log GROUP BY action;`

## What Phase 2 deliberately does not do

**No emails.** A parent learns the state of a request by looking at the portal.
The three lifecycle emails are Phase 3, along with announcements and delivery
tracking.

**No automatic expiry of seat holds.** A pending request holds its seat until a
person acts. The admin queue's oldest-first ordering and visible request age are
the mitigation. §10 of the spec records the condition under which to revisit
this: staff regularly releasing abandoned requests, or an observed case of a
full class blocking a paying family.

**No age or level enforcement.** `min_age` and `max_age` stay advisory. Staff
catch misplacement when they confirm, which is the better place for it.

**Still no money.** Nothing is billed, summed, or recorded as paid. Prices are
shown so a family knows what to bring to the studio.
