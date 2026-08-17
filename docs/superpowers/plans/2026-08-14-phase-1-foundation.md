# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public dance studio website, family authentication, student profiles, and the class catalog and schedule — a complete, usable studio site with no money moving through it.

**Architecture:** One Next.js App Router application backed by Postgres through Drizzle ORM. Three route groups share one database: a statically rendered public marketing site, an authenticated parent portal, and an authenticated staff backoffice. Authentication is Better Auth with email/password and verification email. All family-scoped data access goes through query functions that take a family ID as a required first parameter, so forgetting to scope a query is a compile error.

**Tech Stack:** Node 24.19.0 LTS, Next.js 16.3.1, React 19.2.8, TypeScript 5.9.3, Tailwind CSS 4.3.3, Postgres 18, Drizzle ORM 0.45.2, Better Auth 1.6.29, Resend 6.20.0, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-08-14-dance-studio-website-design.md`

## Global Constraints

- **Money is always integer cents.** Every monetary value in the database, in
  application code, and in test fixtures is an integer count of cents.
  Floating-point numbers are never used for money. Dollars appear only at the
  display boundary. Class prices are *displayed* values — nothing in the system
  sums or accumulates them.
- **Family-scoped queries take `familyId` as a required first parameter.** Any
  query function that reads family-owned data (students, enrollments)
  must accept `familyId: string` as its first argument and filter on it in SQL.
  Never filter in application code after fetching.
- **This application never collects or tracks money.** Payment happens in
  person at the studio, and the site's only involvement with money is
  displaying what a class costs. Do not add payment columns, forms, or fields;
  do not add invoice, balance, or payment-record tables. This is a permanent
  product rule, not a Phase 1 restriction — no later phase relaxes it.
- **Dates are handled in UTC.** Class dates are stored as Postgres `date` and
  manipulated in code as `YYYY-MM-DD` strings or UTC `Date` objects. Never use
  local-timezone `Date` constructors for schedule math — a studio in a
  UTC-negative timezone will get the wrong day.
- **TypeScript pinned to 5.9.3.** TypeScript 7.0.2 (the Go-native compiler) is
  GA but is not yet verified against the Next.js 16 type plugin. Upgrading is a
  separate, deliberate task.
- **Every task ends with a commit.** Do not batch commits across tasks.

## Prerequisites

Node.js is **not installed** on this machine. Task 1 installs it. Postgres 18
is also required for integration tests and local development; Task 2 covers it.

---

### Task 1: Toolchain, project scaffold, and the test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `app/layout.tsx`, `app/globals.css`, `app/(public)/page.tsx`
- Create: `lib/format.ts`
- Test: `tests/unit/format.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `formatTimeRange(start: string, end: string): string` and
  `formatCents(cents: number): string` from `@/lib/format`; the `@/*` import
  alias mapping to the repo root; `npm test` as the unit-test command.

- [ ] **Step 1: Install Node.js 24.19.0 LTS**

In a PowerShell terminal:

```powershell
winget install --id OpenJS.NodeJS.LTS --version 24.19.0 --accept-source-agreements
```

Close and reopen the terminal, then verify:

```powershell
node --version   # expect v24.19.0
npm --version    # expect 11.17.0
```

If `winget` is unavailable, download the Windows x64 MSI from
`https://nodejs.org/dist/v24.19.0/node-v24.19.0-x64.msi` and install it.

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "jdu-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "next": "16.3.1",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.3.3",
    "@types/node": "^24.3.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "postcss": "^8.5.0",
    "tailwindcss": "4.3.3",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  }
}
```

Then run `npm install`.

- [ ] **Step 3: Create the config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

`postcss.config.mjs`:

```js
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
});
```

`.gitignore`:

```
node_modules/
.next/
out/
build/
.env
.env.local
.env*.local
*.tsbuildinfo
next-env.d.ts
test-results/
playwright-report/
.superpowers/
.DS_Store
```

`drizzle/` is deliberately **not** ignored — migrations are source and must be
committed. `.superpowers/` holds scratch coordination files and must be
ignored, or `git add -A` in Step 9 would commit them.

`.env.example`:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/jdu_web
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/jdu_web_test
BETTER_AUTH_SECRET=generate-with-openssl-rand-base64-32
BETTER_AUTH_URL=http://localhost:3000
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=Dance Studio <noreply@example.com>
```

- [ ] **Step 4: Create the minimal app shell**

`app/globals.css`:

```css
@import "tailwindcss";
```

`app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dance Studio",
  description: "Classes, schedule, and enrollment for our dance studio.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`app/(public)/page.tsx`:

```tsx
export default function HomePage() {
  return <h1>Dance Studio</h1>;
}
```

- [ ] **Step 5: Write the failing test**

`tests/unit/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatCents, formatTimeRange } from "@/lib/format";

describe("formatCents", () => {
  it("renders whole dollars", () => {
    expect(formatCents(6500)).toBe("$65.00");
  });

  it("renders cents without floating point drift", () => {
    expect(formatCents(1)).toBe("$0.01");
    expect(formatCents(999)).toBe("$9.99");
    expect(formatCents(123456)).toBe("$1,234.56");
  });

  it("renders zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("renders credits as negative amounts", () => {
    expect(formatCents(-2500)).toBe("-$25.00");
  });

  it("rejects non-integer input", () => {
    expect(() => formatCents(65.5)).toThrow("must be an integer");
  });
});

describe("formatTimeRange", () => {
  it("renders a morning class", () => {
    expect(formatTimeRange("09:00:00", "10:00:00")).toBe(
      "9:00 AM – 10:00 AM",
    );
  });

  it("renders an evening class crossing noon", () => {
    expect(formatTimeRange("16:30:00", "17:45:00")).toBe(
      "4:30 PM – 5:45 PM",
    );
  });

  it("renders noon and midnight correctly", () => {
    expect(formatTimeRange("12:00:00", "13:00:00")).toBe(
      "12:00 PM – 1:00 PM",
    );
    expect(formatTimeRange("00:00:00", "01:00:00")).toBe(
      "12:00 AM – 1:00 AM",
    );
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/format'`

- [ ] **Step 7: Write the implementation**

`lib/format.ts`:

```ts
const dollarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * Formats an integer count of cents as US dollars.
 * Throws on non-integer input, because a fractional cent means money
 * arithmetic has leaked into floating point somewhere upstream.
 */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatCents: amount must be an integer, got ${cents}`);
  }
  return dollarFormatter.format(cents / 100);
}

/** Formats a Postgres `time` value (HH:MM:SS) as a 12-hour clock time. */
function formatTime(time: string): string {
  const parts = time.split(":");
  const hour24 = Number(parts[0]);
  const minute = parts[1] ?? "00";
  if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) {
    throw new Error(`formatTime: invalid time ${time}`);
  }
  const period = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${period}`;
}

/** Formats a class start and end time as a display range. */
export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}
```

- [ ] **Step 8: Run the tests and the type check**

Run: `npm test` — Expected: PASS, 8 tests
Run: `npm run typecheck` — Expected: no errors
Run: `npm run dev` and open `http://localhost:3000` — Expected: "Dance Studio" heading renders. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Tailwind, Vitest, and money formatting"
```

---

### Task 2: Postgres, Drizzle, and the integration test harness

**Files:**
- Create: `db/index.ts`, `db/schema/index.ts`, `drizzle.config.ts`
- Create: `lib/env.ts`
- Create: `tests/setup/db.ts`
- Test: `tests/integration/harness.test.ts`
- Modify: `package.json` (add dependencies)

**Interfaces:**
- Consumes: the `@/*` alias and `npm test` from Task 1.
- Produces: `db` (the application Drizzle client) from `@/db`; `env` (validated
  environment) from `@/lib/env`; and from `@/tests/setup/db` the test harness
  functions `getTestDb(): Promise<TestDb>`, `resetDatabase(): Promise<void>`,
  and `closeTestDb(): Promise<void>`, where `TestDb` is the Drizzle client type
  bound to the full schema. Every later integration test uses these three.

- [ ] **Step 1: Install Postgres 18 and create the two databases**

Install Postgres 18 for Windows:

```powershell
winget install --id PostgreSQL.PostgreSQL.18 --accept-source-agreements
```

Note the superuser password you set during installation. Then create the
development and test databases (adjust the path if Postgres installed
elsewhere):

```powershell
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres jdu_web
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres jdu_web_test
```

Copy `.env.example` to `.env` and set `DATABASE_URL` and `TEST_DATABASE_URL`
to match your actual password. Generate the auth secret now as well:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

The test database is a **separate database**, not a separate schema. The
harness truncates it between tests, and pointing it at your development
database would delete your seed data.

- [ ] **Step 2: Install dependencies**

```bash
npm install drizzle-orm@0.45.2 pg@8.23.0 zod@4.4.3
npm install -D drizzle-kit@0.31.10 @types/pg@^8.15.0 dotenv@^17.0.0
```

- [ ] **Step 3: Write the environment validator**

`lib/env.ts`:

```ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
});

/**
 * Validated server environment. Importing this from client code is a bug —
 * it would leak secrets into the browser bundle.
 */
export const env = envSchema.parse(process.env);
```

- [ ] **Step 4: Write the Drizzle client and config**

`db/schema/index.ts` (empty for now; later tasks re-export their tables here):

```ts
export {};
```

`db/index.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export type Db = typeof db;
```

`drizzle.config.ts`:

```ts
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 5: Write the test harness**

`tests/setup/db.ts`:

```ts
import { config } from "dotenv";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "@/db/schema";

config({ path: ".env" });

export type TestDb = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let testDb: TestDb | undefined;
let migrated = false;

/**
 * Returns a Drizzle client bound to the test database, running migrations
 * once per process on first use.
 */
export async function getTestDb(): Promise<TestDb> {
  if (testDb) return testDb;

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set — see .env.example");
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL must differ from DATABASE_URL — the harness truncates it",
    );
  }

  pool = new Pool({ connectionString: url });
  testDb = drizzle(pool, { schema });

  if (!migrated) {
    await migrate(testDb, { migrationsFolder: "./drizzle" });
    migrated = true;
  }
  return testDb;
}

/**
 * Empties every application table, leaving the schema and migration history
 * intact. Call this in beforeEach so tests never depend on each other's rows.
 */
export async function resetDatabase(): Promise<void> {
  const database = await getTestDb();
  const result = await database.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> '__drizzle_migrations'
  `);

  const tables = result.rows.map((row) => `"public"."${row.tablename}"`);
  if (tables.length === 0) return;

  await database.execute(
    sql.raw(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`),
  );
}

/** Closes the pool so Vitest can exit cleanly. */
export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  testDb = undefined;
  migrated = false;
}
```

- [ ] **Step 6: Write the failing test**

`tests/integration/harness.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase } from "@/tests/setup/db";

describe("test database harness", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("connects to the test database", async () => {
    const db = await getTestDb();
    const result = await db.execute<{ ok: number }>(sql`SELECT 1 AS ok`);
    expect(result.rows[0]?.ok).toBe(1);
  });

  it("refuses to run against the development database", async () => {
    expect(process.env.TEST_DATABASE_URL).not.toBe(process.env.DATABASE_URL);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test -- tests/integration/harness.test.ts`
Expected: FAIL — the `drizzle` migrations folder does not exist yet.

- [ ] **Step 8: Generate the empty migration baseline and re-run**

```bash
npm run db:generate
npm run db:migrate
```

With no tables defined yet, `drizzle-kit generate` reports there is nothing to
generate. Create the folder so the migrator has somewhere to look:

```bash
mkdir -p drizzle/meta
echo '{"version":"7","dialect":"postgresql","entries":[]}' > drizzle/meta/_journal.json
```

Run: `npm test -- tests/integration/harness.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add Drizzle client, validated env, and integration test harness"
```

---

### Task 3: Families and students schema with family-scoped queries

**Files:**
- Create: `db/schema/families.ts`, `db/schema/students.ts`
- Modify: `db/schema/index.ts`
- Create: `db/queries/students.ts`
- Test: `tests/integration/students.test.ts`

**Interfaces:**
- Consumes: `getTestDb`, `resetDatabase`, `closeTestDb` from Task 2; `db` from `@/db`.
- Produces: the `families` and `students` tables from `@/db/schema`; and from
  `@/db/queries/students` the functions
  `listStudents(db: Database, familyId: string): Promise<Student[]>`,
  `getStudent(db: Database, familyId: string, studentId: string): Promise<Student | null>`,
  `createStudent(db: Database, familyId: string, input: NewStudentInput): Promise<Student>`, and
  `updateStudent(db: Database, familyId: string, studentId: string, input: Partial<NewStudentInput>): Promise<Student | null>`,
  where `NewStudentInput = { firstName: string; lastName: string; birthdate: string; notes?: string | null }`.
  **`Database = NodePgDatabase<typeof schema>`** — every later query module
  declares this same local type alias, and both the application client (`db`)
  and the test client (`TestDb`) satisfy it.

Note the shape: **every query function takes the database client first and
`familyId` second**. Passing the client explicitly is what lets integration
tests run against the test database without mocking, and making `familyId`
required means a scoping mistake fails to compile.

- [ ] **Step 1: Write the schema files**

`db/schema/families.ts`:

```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Family = typeof families.$inferSelect;
```

`db/schema/students.ts`:

```ts
import { boolean, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { families } from "./families";

export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    birthdate: date("birthdate").notNull(),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("students_family_id_idx").on(table.familyId)],
);

export type Student = typeof students.$inferSelect;
```

`db/schema/index.ts`:

```ts
export * from "./families";
export * from "./students";
```

- [ ] **Step 2: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate
```

Expected: a new file appears under `drizzle/` creating both tables. Open it and
confirm the foreign key has `ON DELETE CASCADE`.

- [ ] **Step 3: Write the failing test**

`tests/integration/students.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { families } from "@/db/schema";
import {
  createStudent,
  getStudent,
  listStudents,
  updateStudent,
} from "@/db/queries/students";

async function seedFamily(db: TestDb, name: string): Promise<string> {
  const [row] = await db.insert(families).values({ name }).returning();
  if (!row) throw new Error("failed to seed family");
  return row.id;
}

describe("student queries", () => {
  let db: TestDb;
  let familyA: string;
  let familyB: string;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
    familyA = await seedFamily(db, "Alvarez");
    familyB = await seedFamily(db, "Brooks");
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("creates a student under the given family", async () => {
    const student = await createStudent(db, familyA, {
      firstName: "Maya",
      lastName: "Alvarez",
      birthdate: "2015-04-12",
    });

    expect(student.familyId).toBe(familyA);
    expect(student.firstName).toBe("Maya");
    expect(student.active).toBe(true);
  });

  it("lists only the requesting family's students", async () => {
    await createStudent(db, familyA, {
      firstName: "Maya",
      lastName: "Alvarez",
      birthdate: "2015-04-12",
    });
    await createStudent(db, familyB, {
      firstName: "Theo",
      lastName: "Brooks",
      birthdate: "2016-09-02",
    });

    const listed = await listStudents(db, familyA);

    expect(listed).toHaveLength(1);
    expect(listed[0]?.firstName).toBe("Maya");
  });

  it("refuses to fetch another family's student by id", async () => {
    const theo = await createStudent(db, familyB, {
      firstName: "Theo",
      lastName: "Brooks",
      birthdate: "2016-09-02",
    });

    expect(await getStudent(db, familyA, theo.id)).toBeNull();
    expect(await getStudent(db, familyB, theo.id)).not.toBeNull();
  });

  it("refuses to update another family's student", async () => {
    const theo = await createStudent(db, familyB, {
      firstName: "Theo",
      lastName: "Brooks",
      birthdate: "2016-09-02",
    });

    const attempted = await updateStudent(db, familyA, theo.id, {
      firstName: "Hacked",
    });

    expect(attempted).toBeNull();
    const untouched = await getStudent(db, familyB, theo.id);
    expect(untouched?.firstName).toBe("Theo");
  });

  it("deletes students when their family is deleted", async () => {
    await createStudent(db, familyA, {
      firstName: "Maya",
      lastName: "Alvarez",
      birthdate: "2015-04-12",
    });

    await db.delete(families);

    expect(await listStudents(db, familyA)).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- tests/integration/students.test.ts`
Expected: FAIL — `Cannot find module '@/db/queries/students'`

- [ ] **Step 5: Write the implementation**

`db/queries/students.ts`:

```ts
import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { students, type Student } from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

export type NewStudentInput = {
  firstName: string;
  lastName: string;
  birthdate: string;
  notes?: string | null;
};

export async function listStudents(
  db: Database,
  familyId: string,
): Promise<Student[]> {
  return db
    .select()
    .from(students)
    .where(eq(students.familyId, familyId))
    .orderBy(asc(students.firstName));
}

export async function getStudent(
  db: Database,
  familyId: string,
  studentId: string,
): Promise<Student | null> {
  const [row] = await db
    .select()
    .from(students)
    .where(and(eq(students.familyId, familyId), eq(students.id, studentId)))
    .limit(1);
  return row ?? null;
}

export async function createStudent(
  db: Database,
  familyId: string,
  input: NewStudentInput,
): Promise<Student> {
  const [row] = await db
    .insert(students)
    .values({ ...input, familyId })
    .returning();
  if (!row) throw new Error("createStudent: insert returned no row");
  return row;
}

export async function updateStudent(
  db: Database,
  familyId: string,
  studentId: string,
  input: Partial<NewStudentInput>,
): Promise<Student | null> {
  const [row] = await db
    .update(students)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(students.familyId, familyId), eq(students.id, studentId)))
    .returning();
  return row ?? null;
}
```

The family filter lives in the `WHERE` clause of both the update and the fetch.
That is the whole security property: a wrong family ID matches zero rows in the
database rather than being caught by an `if` statement someone can forget.

- [ ] **Step 6: Run the tests**

Run: `npm test -- tests/integration/students.test.ts` — Expected: PASS, 5 tests
Run: `npm run typecheck` — Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add families and students schema with family-scoped queries"
```

---

### Task 4: Seasons and class offerings schema

**Files:**
- Create: `db/schema/seasons.ts`, `db/schema/class-offerings.ts`
- Modify: `db/schema/index.ts`
- Create: `db/queries/seasons.ts`, `db/queries/class-offerings.ts`
- Test: `tests/integration/class-offerings.test.ts`

**Interfaces:**
- Consumes: the test harness from Task 2; the `Database` type convention from Task 3.
- Produces: the `seasons` and `classOfferings` tables and the `dayOfWeek` enum
  from `@/db/schema`; `listSeasons(db)`, `createSeason(db, input)`,
  `getCurrentSeason(db, today: string)` from `@/db/queries/seasons`; and
  `listPublishedOfferings(db, seasonId)`, `listAllOfferings(db, seasonId)`,
  `createOffering(db, input)`, `updateOffering(db, offeringId, input)` from
  `@/db/queries/class-offerings`. `DayOfWeek` is the exported union type
  `"sunday" | "monday" | ... | "saturday"`.

- [ ] **Step 1: Write the schema files**

`db/schema/seasons.ts`:

```ts
import { boolean, date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  registrationOpen: boolean("registration_open").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Season = typeof seasons.$inferSelect;
```

`db/schema/class-offerings.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { seasons } from "./seasons";

export const dayOfWeekEnum = pgEnum("day_of_week", [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

export type DayOfWeek = (typeof dayOfWeekEnum.enumValues)[number];

export const classOfferings = pgTable(
  "class_offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    level: text("level"),
    // Advisory only — enrollment is instant and does not enforce these.
    minAge: integer("min_age"),
    maxAge: integer("max_age"),
    dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    room: text("room"),
    instructor: text("instructor"),
    capacity: integer("capacity").notNull(),
    seatsTaken: integer("seats_taken").notNull().default(0),
    monthlyPriceCents: integer("monthly_price_cents").notNull(),
    seasonFeeCents: integer("season_fee_cents").notNull().default(0),
    published: boolean("published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("class_offerings_season_id_idx").on(table.seasonId),
    check("class_offerings_capacity_positive", sql`${table.capacity} > 0`),
    check(
      "class_offerings_seats_within_capacity",
      sql`${table.seatsTaken} >= 0 AND ${table.seatsTaken} <= ${table.capacity}`,
    ),
    check(
      "class_offerings_prices_non_negative",
      sql`${table.monthlyPriceCents} >= 0 AND ${table.seasonFeeCents} >= 0`,
    ),
  ],
);

export type ClassOffering = typeof classOfferings.$inferSelect;
```

The `seats_within_capacity` check is deliberate. Phase 2 claims seats with a
conditional `UPDATE`, and this constraint is the database-level backstop that
turns any future bug in that logic into a loud failure instead of an
oversubscribed class.

`db/schema/index.ts`:

```ts
export * from "./families";
export * from "./students";
export * from "./seasons";
export * from "./class-offerings";
```

- [ ] **Step 2: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate
```

- [ ] **Step 3: Write the failing test**

`tests/integration/class-offerings.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { createSeason, getCurrentSeason, listSeasons } from "@/db/queries/seasons";
import {
  createOffering,
  listAllOfferings,
  listPublishedOfferings,
  updateOffering,
} from "@/db/queries/class-offerings";

describe("seasons and class offerings", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("creates and lists seasons newest first", async () => {
    await createSeason(db, {
      name: "Spring 2026",
      startDate: "2026-01-05",
      endDate: "2026-05-30",
    });
    await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });

    const listed = await listSeasons(db);

    expect(listed.map((s) => s.name)).toEqual(["Fall 2026", "Spring 2026"]);
  });

  it("finds the season containing a given date", async () => {
    const fall = await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });

    expect((await getCurrentSeason(db, "2026-10-15"))?.id).toBe(fall.id);
    expect(await getCurrentSeason(db, "2026-08-01")).toBeNull();
    // Boundaries are inclusive on both ends.
    expect((await getCurrentSeason(db, "2026-09-01"))?.id).toBe(fall.id);
    expect((await getCurrentSeason(db, "2026-12-19"))?.id).toBe(fall.id);
  });

  it("hides unpublished offerings from the public list", async () => {
    const season = await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });

    await createOffering(db, {
      seasonId: season.id,
      name: "Ballet I",
      dayOfWeek: "tuesday",
      startTime: "16:00:00",
      endTime: "17:00:00",
      capacity: 12,
      monthlyPriceCents: 6500,
      seasonFeeCents: 5000,
      published: true,
    });
    await createOffering(db, {
      seasonId: season.id,
      name: "Draft Jazz",
      dayOfWeek: "thursday",
      startTime: "17:00:00",
      endTime: "18:00:00",
      capacity: 10,
      monthlyPriceCents: 6500,
      published: false,
    });

    expect(await listPublishedOfferings(db, season.id)).toHaveLength(1);
    expect(await listAllOfferings(db, season.id)).toHaveLength(2);
  });

  it("orders offerings by weekday then start time", async () => {
    const season = await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });
    const base = {
      seasonId: season.id,
      capacity: 10,
      monthlyPriceCents: 6500,
      published: true,
    };

    await createOffering(db, {
      ...base, name: "Thursday Late", dayOfWeek: "thursday",
      startTime: "18:00:00", endTime: "19:00:00",
    });
    await createOffering(db, {
      ...base, name: "Monday Late", dayOfWeek: "monday",
      startTime: "18:00:00", endTime: "19:00:00",
    });
    await createOffering(db, {
      ...base, name: "Monday Early", dayOfWeek: "monday",
      startTime: "16:00:00", endTime: "17:00:00",
    });

    const listed = await listPublishedOfferings(db, season.id);

    expect(listed.map((o) => o.name)).toEqual([
      "Monday Early",
      "Monday Late",
      "Thursday Late",
    ]);
  });

  it("rejects a negative price at the database level", async () => {
    const season = await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });

    await expect(
      createOffering(db, {
        seasonId: season.id,
        name: "Free Fall",
        dayOfWeek: "friday",
        startTime: "16:00:00",
        endTime: "17:00:00",
        capacity: 10,
        monthlyPriceCents: -100,
      }),
    ).rejects.toThrow();
  });

  it("rejects zero capacity at the database level", async () => {
    const season = await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });

    await expect(
      createOffering(db, {
        seasonId: season.id,
        name: "Nobody",
        dayOfWeek: "friday",
        startTime: "16:00:00",
        endTime: "17:00:00",
        capacity: 0,
        monthlyPriceCents: 6500,
      }),
    ).rejects.toThrow();
  });

  it("updates an offering", async () => {
    const season = await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });
    const offering = await createOffering(db, {
      seasonId: season.id,
      name: "Ballet I",
      dayOfWeek: "tuesday",
      startTime: "16:00:00",
      endTime: "17:00:00",
      capacity: 12,
      monthlyPriceCents: 6500,
    });

    const updated = await updateOffering(db, offering.id, {
      name: "Ballet I — Beginners",
      published: true,
    });

    expect(updated?.name).toBe("Ballet I — Beginners");
    expect(updated?.published).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- tests/integration/class-offerings.test.ts`
Expected: FAIL — `Cannot find module '@/db/queries/seasons'`

- [ ] **Step 5: Write the season queries**

`db/queries/seasons.ts`:

```ts
import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { seasons, type Season } from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

export type NewSeasonInput = {
  name: string;
  startDate: string;
  endDate: string;
  registrationOpen?: boolean;
};

export async function listSeasons(db: Database): Promise<Season[]> {
  return db.select().from(seasons).orderBy(desc(seasons.startDate));
}

export async function getSeason(
  db: Database,
  seasonId: string,
): Promise<Season | null> {
  const [row] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .limit(1);
  return row ?? null;
}

/** Returns the season whose date range contains `today`, inclusive of both ends. */
export async function getCurrentSeason(
  db: Database,
  today: string,
): Promise<Season | null> {
  const [row] = await db
    .select()
    .from(seasons)
    .where(and(lte(seasons.startDate, today), gte(seasons.endDate, today)))
    .orderBy(desc(seasons.startDate))
    .limit(1);
  return row ?? null;
}

export async function createSeason(
  db: Database,
  input: NewSeasonInput,
): Promise<Season> {
  const [row] = await db.insert(seasons).values(input).returning();
  if (!row) throw new Error("createSeason: insert returned no row");
  return row;
}

export async function updateSeason(
  db: Database,
  seasonId: string,
  input: Partial<NewSeasonInput>,
): Promise<Season | null> {
  const [row] = await db
    .update(seasons)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(seasons.id, seasonId))
    .returning();
  return row ?? null;
}
```

- [ ] **Step 6: Write the class offering queries**

`db/queries/class-offerings.ts`:

```ts
import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  classOfferings,
  type ClassOffering,
  type DayOfWeek,
} from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

export type NewOfferingInput = {
  seasonId: string;
  name: string;
  description?: string | null;
  level?: string | null;
  minAge?: number | null;
  maxAge?: number | null;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  room?: string | null;
  instructor?: string | null;
  capacity: number;
  monthlyPriceCents: number;
  seasonFeeCents?: number;
  published?: boolean;
};

/**
 * Sorts by weekday in calendar order (Sunday first) then start time.
 * The enum's declaration order gives us this for free — sorting the text
 * value would put Friday before Monday.
 */
const weekdayThenTime = [
  asc(sql`${classOfferings.dayOfWeek}::"day_of_week"`),
  asc(classOfferings.startTime),
  asc(classOfferings.name),
];

export async function listPublishedOfferings(
  db: Database,
  seasonId: string,
): Promise<ClassOffering[]> {
  return db
    .select()
    .from(classOfferings)
    .where(
      and(
        eq(classOfferings.seasonId, seasonId),
        eq(classOfferings.published, true),
      ),
    )
    .orderBy(...weekdayThenTime);
}

export async function listAllOfferings(
  db: Database,
  seasonId: string,
): Promise<ClassOffering[]> {
  return db
    .select()
    .from(classOfferings)
    .where(eq(classOfferings.seasonId, seasonId))
    .orderBy(...weekdayThenTime);
}

export async function getOffering(
  db: Database,
  offeringId: string,
): Promise<ClassOffering | null> {
  const [row] = await db
    .select()
    .from(classOfferings)
    .where(eq(classOfferings.id, offeringId))
    .limit(1);
  return row ?? null;
}

export async function createOffering(
  db: Database,
  input: NewOfferingInput,
): Promise<ClassOffering> {
  const [row] = await db.insert(classOfferings).values(input).returning();
  if (!row) throw new Error("createOffering: insert returned no row");
  return row;
}

export async function updateOffering(
  db: Database,
  offeringId: string,
  input: Partial<NewOfferingInput>,
): Promise<ClassOffering | null> {
  const [row] = await db
    .update(classOfferings)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(classOfferings.id, offeringId))
    .returning();
  return row ?? null;
}
```

- [ ] **Step 7: Run the tests**

Run: `npm test` — Expected: PASS, all suites
Run: `npm run typecheck` — Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add seasons and class offerings with capacity and price constraints"
```

---

### Task 5: Class occurrence generation

**Files:**
- Create: `lib/occurrences.ts`
- Create: `db/schema/class-occurrences.ts`
- Modify: `db/schema/index.ts`
- Create: `db/queries/class-occurrences.ts`
- Test: `tests/unit/occurrences.test.ts`, `tests/integration/class-occurrences.test.ts`

**Interfaces:**
- Consumes: `DayOfWeek` and `classOfferings` from Task 4.
- Produces: `generateOccurrenceDates(startDate: string, endDate: string, day: DayOfWeek): string[]`
  from `@/lib/occurrences`; the `classOccurrences` table and
  `occurrenceStatusEnum` from `@/db/schema`; and
  `syncOccurrencesForOffering(db, offeringId): Promise<number>` plus
  `listOccurrencesBetween(db, from: string, to: string)` from
  `@/db/queries/class-occurrences`.

- [ ] **Step 1: Write the failing unit test**

`tests/unit/occurrences.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateOccurrenceDates } from "@/lib/occurrences";

describe("generateOccurrenceDates", () => {
  it("returns every matching weekday inside the range", () => {
    // 2026-09-01 is a Tuesday.
    const dates = generateOccurrenceDates("2026-09-01", "2026-09-30", "tuesday");
    expect(dates).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
    ]);
  });

  it("skips forward when the range starts before the first matching day", () => {
    const dates = generateOccurrenceDates("2026-09-01", "2026-09-30", "friday");
    expect(dates[0]).toBe("2026-09-04");
    expect(dates).toHaveLength(4);
  });

  it("includes the end date when it falls on the target weekday", () => {
    const dates = generateOccurrenceDates("2026-09-01", "2026-09-08", "tuesday");
    expect(dates).toEqual(["2026-09-01", "2026-09-08"]);
  });

  it("returns an empty array when no matching day falls in the range", () => {
    expect(generateOccurrenceDates("2026-09-01", "2026-09-03", "sunday")).toEqual([]);
  });

  it("crosses month and year boundaries", () => {
    const dates = generateOccurrenceDates("2026-12-28", "2027-01-11", "monday");
    expect(dates).toEqual(["2026-12-28", "2027-01-04", "2027-01-11"]);
  });

  it("handles a leap day correctly", () => {
    // 2028-02-29 is a Tuesday.
    const dates = generateOccurrenceDates("2028-02-22", "2028-03-07", "tuesday");
    expect(dates).toEqual(["2028-02-22", "2028-02-29", "2028-03-07"]);
  });

  it("is timezone independent", () => {
    // Dates must not shift by a day regardless of the machine's timezone.
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14
      const ahead = generateOccurrenceDates("2026-09-01", "2026-09-15", "tuesday");
      process.env.TZ = "Pacific/Midway"; // UTC-11
      const behind = generateOccurrenceDates("2026-09-01", "2026-09-15", "tuesday");
      expect(ahead).toEqual(behind);
      expect(ahead[0]).toBe("2026-09-01");
    } finally {
      process.env.TZ = original;
    }
  });

  it("rejects an end date before the start date", () => {
    expect(() =>
      generateOccurrenceDates("2026-09-30", "2026-09-01", "tuesday"),
    ).toThrow("end date");
  });

  it("rejects a malformed date", () => {
    expect(() =>
      generateOccurrenceDates("September 1", "2026-09-30", "tuesday"),
    ).toThrow("YYYY-MM-DD");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/occurrences.test.ts`
Expected: FAIL — `Cannot find module '@/lib/occurrences'`

- [ ] **Step 3: Write the implementation**

`lib/occurrences.ts`:

```ts
import type { DayOfWeek } from "@/db/schema";

const DAY_INDEX: Record<DayOfWeek, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a YYYY-MM-DD string into a UTC-midnight Date.
 * Using Date.UTC rather than `new Date(string)` keeps schedule math
 * independent of the machine's local timezone.
 */
function parseIsoDate(value: string): Date {
  if (!ISO_DATE.test(value)) {
    throw new Error(`Expected a date in YYYY-MM-DD format, got "${value}"`);
  }
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date "${value}"`);
  }
  return date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Returns every date in [startDate, endDate] that falls on the given weekday,
 * inclusive of both endpoints, as YYYY-MM-DD strings in ascending order.
 */
export function generateOccurrenceDates(
  startDate: string,
  endDate: string,
  day: DayOfWeek,
): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (end < start) {
    throw new Error(
      `generateOccurrenceDates: end date ${endDate} precedes start date ${startDate}`,
    );
  }

  const cursor = new Date(start);
  const offset = (DAY_INDEX[day] - cursor.getUTCDay() + 7) % 7;
  cursor.setUTCDate(cursor.getUTCDate() + offset);

  const dates: string[] = [];
  while (cursor <= end) {
    dates.push(toIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return dates;
}
```

- [ ] **Step 4: Run the unit test**

Run: `npm test -- tests/unit/occurrences.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Write the occurrences schema**

`db/schema/class-occurrences.ts`:

```ts
import { date, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { classOfferings } from "./class-offerings";

export const occurrenceStatusEnum = pgEnum("occurrence_status", [
  "scheduled",
  "cancelled",
]);

export const classOccurrences = pgTable(
  "class_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classOfferingId: uuid("class_offering_id")
      .notNull()
      .references(() => classOfferings.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    status: occurrenceStatusEnum("status").notNull().default("scheduled"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("class_occurrences_offering_date_key").on(
      table.classOfferingId,
      table.date,
    ),
    index("class_occurrences_date_idx").on(table.date),
  ],
);

export type ClassOccurrence = typeof classOccurrences.$inferSelect;
```

The unique index on (offering, date) is what makes regeneration idempotent —
re-running the sync inserts nothing rather than duplicating the calendar.

Add to `db/schema/index.ts`:

```ts
export * from "./class-occurrences";
```

Then:

```bash
npm run db:generate
npm run db:migrate
```

- [ ] **Step 6: Write the failing integration test**

`tests/integration/class-occurrences.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { classOccurrences } from "@/db/schema";
import { createSeason } from "@/db/queries/seasons";
import { createOffering } from "@/db/queries/class-offerings";
import {
  listOccurrencesBetween,
  syncOccurrencesForOffering,
} from "@/db/queries/class-occurrences";

async function seedOffering(db: TestDb) {
  const season = await createSeason(db, {
    name: "Fall 2026",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
  });
  return createOffering(db, {
    seasonId: season.id,
    name: "Ballet I",
    dayOfWeek: "tuesday",
    startTime: "16:00:00",
    endTime: "17:00:00",
    capacity: 12,
    monthlyPriceCents: 6500,
    published: true,
  });
}

describe("class occurrence sync", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("creates one occurrence per matching weekday in the season", async () => {
    const offering = await seedOffering(db);

    const created = await syncOccurrencesForOffering(db, offering.id);

    expect(created).toBe(5);
    const rows = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.classOfferingId, offering.id));
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.status === "scheduled")).toBe(true);
  });

  it("is idempotent when run twice", async () => {
    const offering = await seedOffering(db);

    await syncOccurrencesForOffering(db, offering.id);
    const secondRun = await syncOccurrencesForOffering(db, offering.id);

    expect(secondRun).toBe(0);
    const rows = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.classOfferingId, offering.id));
    expect(rows).toHaveLength(5);
  });

  it("preserves a cancellation when re-synced", async () => {
    const offering = await seedOffering(db);
    await syncOccurrencesForOffering(db, offering.id);

    await db
      .update(classOccurrences)
      .set({ status: "cancelled", note: "Studio closed" })
      .where(eq(classOccurrences.date, "2026-09-15"));

    await syncOccurrencesForOffering(db, offering.id);

    const [cancelled] = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.date, "2026-09-15"));
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.note).toBe("Studio closed");
  });

  it("lists occurrences in a date window in ascending order", async () => {
    const offering = await seedOffering(db);
    await syncOccurrencesForOffering(db, offering.id);

    const window = await listOccurrencesBetween(db, "2026-09-08", "2026-09-22");

    expect(window.map((row) => row.occurrence.date)).toEqual([
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
    ]);
    expect(window[0]?.offering.name).toBe("Ballet I");
  });

  it("throws for an unknown offering", async () => {
    await expect(
      syncOccurrencesForOffering(db, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow("not found");
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test -- tests/integration/class-occurrences.test.ts`
Expected: FAIL — `Cannot find module '@/db/queries/class-occurrences'`

- [ ] **Step 8: Write the implementation**

`db/queries/class-occurrences.ts`:

```ts
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  classOccurrences,
  classOfferings,
  seasons,
  type ClassOccurrence,
  type ClassOffering,
} from "@/db/schema";
import { generateOccurrenceDates } from "@/lib/occurrences";

type Database = NodePgDatabase<typeof schema>;

export type ScheduledClass = {
  occurrence: ClassOccurrence;
  offering: ClassOffering;
};

/**
 * Creates any missing occurrences for an offering across its season's date
 * range. Existing rows are left untouched, so cancellations and notes survive
 * a re-sync. Returns the number of rows actually inserted.
 */
export async function syncOccurrencesForOffering(
  db: Database,
  offeringId: string,
): Promise<number> {
  const [row] = await db
    .select({ offering: classOfferings, season: seasons })
    .from(classOfferings)
    .innerJoin(seasons, eq(classOfferings.seasonId, seasons.id))
    .where(eq(classOfferings.id, offeringId))
    .limit(1);

  if (!row) {
    throw new Error(`syncOccurrencesForOffering: offering ${offeringId} not found`);
  }

  const dates = generateOccurrenceDates(
    row.season.startDate,
    row.season.endDate,
    row.offering.dayOfWeek,
  );
  if (dates.length === 0) return 0;

  const inserted = await db
    .insert(classOccurrences)
    .values(dates.map((date) => ({ classOfferingId: offeringId, date })))
    .onConflictDoNothing({
      target: [classOccurrences.classOfferingId, classOccurrences.date],
    })
    .returning({ id: classOccurrences.id });

  return inserted.length;
}

/** Returns every occurrence of a published class in a date window, ascending. */
export async function listOccurrencesBetween(
  db: Database,
  from: string,
  to: string,
): Promise<ScheduledClass[]> {
  return db
    .select({ occurrence: classOccurrences, offering: classOfferings })
    .from(classOccurrences)
    .innerJoin(
      classOfferings,
      eq(classOccurrences.classOfferingId, classOfferings.id),
    )
    .where(
      and(
        gte(classOccurrences.date, from),
        lte(classOccurrences.date, to),
        eq(classOfferings.published, true),
      ),
    )
    .orderBy(asc(classOccurrences.date), asc(classOfferings.startTime));
}
```

- [ ] **Step 9: Run all tests**

Run: `npm test` — Expected: PASS, all suites
Run: `npm run typecheck` — Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: generate class occurrences idempotently from season dates"
```

---

### Task 6: Authentication with Better Auth

**Files:**
- Create: `lib/auth.ts`, `lib/auth-client.ts`, `lib/email.ts`
- Create: `db/schema/auth.ts` (generated), modify `db/schema/index.ts`
- Create: `app/api/auth/[...all]/route.ts`
- Create: `app/(auth)/sign-up/page.tsx`, `app/(auth)/sign-in/page.tsx`, `app/(auth)/verify/page.tsx`
- Test: `tests/integration/auth.test.ts`

**Interfaces:**
- Consumes: the `families` table from Task 3; `env` from Task 2.
- Produces: `auth` (the Better Auth server instance) from `@/lib/auth`;
  `authClient` from `@/lib/auth-client`; the `user`, `session`, `account`, and
  `verification` tables from `@/db/schema`. The `user` table carries two extra
  columns used by every later task: `familyId: string | null` and
  `role: "parent" | "staff" | "admin"`.

- [ ] **Step 1: Install dependencies**

```bash
npm install better-auth@1.6.29 resend@6.20.0
```

- [ ] **Step 2: Write the email sender**

`lib/email.ts`:

```ts
import { Resend } from "resend";
import { env } from "@/lib/env";

const resend = new Resend(env.RESEND_API_KEY);

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

/**
 * Sends a transactional email. Failures are logged and rethrown — the caller
 * decides whether a send failure should fail the surrounding operation.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });

  if (error) {
    console.error("sendEmail failed", { to: message.to, error });
    throw new Error(`Failed to send email: ${error.message}`);
  }
}
```

- [ ] **Step 3: Write the Better Auth server configuration**

`lib/auth.ts`:

```ts
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
    requireEmailVerification: true,
    minPasswordLength: 10,
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
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
```

- [ ] **Step 4: Generate the auth schema and migrate**

`lib/auth.ts` will not type-check until this step completes — it imports the
`user` table that this command generates. That is expected; the CLI reads the
config without type-checking it. Run `npm run typecheck` only after this step.

```bash
npx @better-auth/cli@1.6.29 generate --config lib/auth.ts --output db/schema/auth.ts --yes
```

Add to `db/schema/index.ts`:

```ts
export * from "./auth";
```

Then:

```bash
npm run db:generate
npm run db:migrate
```

Open the generated `db/schema/auth.ts` and confirm the `user` table contains
`familyId` and `role` columns. If the CLI omitted them, add them by hand:

```ts
familyId: uuid("family_id").references(() => families.id, { onDelete: "set null" }),
role: text("role").notNull().default("parent"),
```

and regenerate the migration.

- [ ] **Step 5: Wire the auth route handler and client**

`app/api/auth/[...all]/route.ts`:

```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

`lib/auth-client.ts`:

```ts
"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
export const { signIn, signUp, signOut, useSession } = authClient;
```

- [ ] **Step 6: Write the failing test**

`tests/integration/auth.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { families, user } from "@/db/schema";

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => undefined),
}));

describe("account provisioning", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("defaults a new user to the parent role", async () => {
    const [family] = await db.insert(families).values({ name: "Alvarez" }).returning();
    const [row] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: "Ana Alvarez",
        email: "ana@example.com",
        emailVerified: false,
        familyId: family!.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    expect(row?.role).toBe("parent");
    expect(row?.familyId).toBe(family!.id);
  });

  it("keeps the user when their family is deleted", async () => {
    const [family] = await db.insert(families).values({ name: "Brooks" }).returning();
    const id = crypto.randomUUID();
    await db.insert(user).values({
      id,
      name: "Ben Brooks",
      email: "ben@example.com",
      emailVerified: true,
      familyId: family!.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.delete(families).where(eq(families.id, family!.id));

    const [row] = await db.select().from(user).where(eq(user.id, id));
    expect(row).toBeDefined();
    expect(row?.familyId).toBeNull();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails, then passes**

Run: `npm test -- tests/integration/auth.test.ts`
Expected first: FAIL — the `user` table does not exist or lacks `role`.
After Step 4's migration has been applied: PASS, 2 tests.

- [ ] **Step 8: Build the sign-up, sign-in, and verify pages**

`app/(auth)/sign-up/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    const result = await signUp.email({
      name: String(data.get("name")),
      email: String(data.get("email")),
      password: String(data.get("password")),
    });

    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not create your account.");
      return;
    }
    router.push("/verify");
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Create your family account</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Your name</span>
          <input name="name" required autoComplete="name"
            className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input name="email" type="email" required autoComplete="email"
            className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input name="password" type="password" required minLength={10}
            autoComplete="new-password"
            className="mt-1 w-full rounded border px-3 py-2" />
          <span className="mt-1 block text-xs text-gray-600">
            At least 10 characters.
          </span>
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={pending}
          className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>
    </main>
  );
}
```

`app/(auth)/sign-in/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    const result = await signIn.email({
      email: String(data.get("email")),
      password: String(data.get("password")),
    });

    setPending(false);
    if (result.error) {
      // Deliberately vague: never reveal whether an email is registered.
      setError("That email and password combination did not work.");
      return;
    }
    router.push("/portal");
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input name="email" type="email" required autoComplete="email"
            className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input name="password" type="password" required
            autoComplete="current-password"
            className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={pending}
          className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
```

`app/(auth)/verify/page.tsx`:

```tsx
export default function VerifyPage() {
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Check your email</h1>
      <p className="mt-4">
        We sent you a confirmation link. Open it to finish setting up your
        account, then sign in.
      </p>
    </main>
  );
}
```

- [ ] **Step 9: Verify the flow manually**

Set a real `RESEND_API_KEY` in `.env` (Resend's free tier allows sending to
your own verified address). Run `npm run dev`, visit
`http://localhost:3000/sign-up`, create an account, and confirm:

- the verification email arrives;
- a row appears in `families` and the new `user` row's `family_id` points at it;
- signing in before verifying is rejected;
- signing in after verifying redirects to `/portal` (which 404s until Task 8).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add email/password auth with verification and family provisioning"
```

---

### Task 7: Session guards and role-based access

**Files:**
- Create: `lib/guards.ts`
- Test: `tests/unit/guards.test.ts`

**Interfaces:**
- Consumes: `auth` and `Session` from Task 6.
- Produces: from `@/lib/guards` — `getSessionUser(): Promise<SessionUser | null>`,
  `requireUser(): Promise<SessionUser>`, `requireFamilyId(): Promise<string>`,
  `requireStaff(): Promise<SessionUser>`, and `requireAdmin(): Promise<SessionUser>`.
  `SessionUser = { id: string; email: string; name: string; role: Role; familyId: string | null }`
  and `Role = "parent" | "staff" | "admin"`. Also exports the pure predicate
  `hasAtLeastRole(actual: Role, required: Role): boolean`. Every portal and
  admin page in Tasks 11 and 12 calls one of these first.

- [ ] **Step 1: Write the failing test**

`tests/unit/guards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hasAtLeastRole } from "@/lib/guards";

describe("hasAtLeastRole", () => {
  it("lets a role satisfy itself", () => {
    expect(hasAtLeastRole("parent", "parent")).toBe(true);
    expect(hasAtLeastRole("staff", "staff")).toBe(true);
    expect(hasAtLeastRole("admin", "admin")).toBe(true);
  });

  it("lets a higher role satisfy a lower requirement", () => {
    expect(hasAtLeastRole("admin", "staff")).toBe(true);
    expect(hasAtLeastRole("admin", "parent")).toBe(true);
    expect(hasAtLeastRole("staff", "parent")).toBe(true);
  });

  it("does not let a lower role satisfy a higher requirement", () => {
    expect(hasAtLeastRole("parent", "staff")).toBe(false);
    expect(hasAtLeastRole("parent", "admin")).toBe(false);
    expect(hasAtLeastRole("staff", "admin")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/guards.test.ts`
Expected: FAIL — `Cannot find module '@/lib/guards'`

- [ ] **Step 3: Write the implementation**

`lib/guards.ts`:

```ts
import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type Role = "parent" | "staff" | "admin";

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
```

- [ ] **Step 4: Enable the `forbidden()` and `unauthorized()` APIs**

These require the `authInterrupts` flag. Modify `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { authInterrupts: true },
};

export default nextConfig;
```

Create `app/forbidden.tsx`:

```tsx
export default function Forbidden() {
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Not allowed</h1>
      <p className="mt-4">
        Your account does not have access to this page.
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test` — Expected: PASS, all suites
Run: `npm run typecheck` — Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add session guards and role hierarchy"
```

---

### Task 8: Public site shell and marketing pages

**Files:**
- Create: `components/site-header.tsx`, `components/site-footer.tsx`
- Create: `app/(public)/layout.tsx`
- Modify: `app/(public)/page.tsx`
- Create: `app/(public)/staff/page.tsx`, `app/(public)/contact/page.tsx`
- Create: `content/studio.ts`

**Interfaces:**
- Consumes: `getSessionUser` from Task 7.
- Produces: `SiteHeader` and `SiteFooter` components; the `studio` content
  object from `@/content/studio` with the shape
  `{ name: string; tagline: string; phone: string; email: string; address: string[]; hours: string[]; staff: { name: string; title: string; bio: string }[] }`.
  Tasks 9 and 10 render inside this layout.

**Design note:** This is the first task where visual design matters. Before
writing the components, invoke the `frontend-design` skill to establish a
typographic scale, color palette, and spacing rhythm for the site. The markup
below is structurally correct but visually plain on purpose — treat it as the
skeleton the design pass dresses.

- [ ] **Step 1: Create the content file**

`content/studio.ts`:

```ts
export const studio = {
  name: "Dance Studio",
  tagline: "Classes for every age, from first steps to advanced technique.",
  phone: "(555) 555-0134",
  email: "hello@example.com",
  address: ["123 Main Street", "Springfield, IL 62701"],
  hours: [
    "Monday – Thursday: 3:30 PM – 9:00 PM",
    "Friday: 3:30 PM – 7:00 PM",
    "Saturday: 9:00 AM – 2:00 PM",
    "Sunday: Closed",
  ],
  staff: [
    {
      name: "Placeholder Instructor",
      title: "Artistic Director",
      bio: "Replace this entry with real staff details before launch.",
    },
  ],
} as const;
```

Real studio copy replaces these values before launch. They live in one file so
the owner can edit them without touching page code.

- [ ] **Step 2: Build the header and footer**

`components/site-header.tsx`:

```tsx
import Link from "next/link";
import { getSessionUser } from "@/lib/guards";
import { studio } from "@/content/studio";

const links = [
  { href: "/classes", label: "Classes" },
  { href: "/schedule", label: "Schedule" },
  { href: "/staff", label: "Staff" },
  { href: "/contact", label: "Contact" },
];

export async function SiteHeader() {
  const user = await getSessionUser();

  return (
    <header className="border-b">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-5xl items-center justify-between gap-6 p-4"
      >
        <Link href="/" className="text-lg font-semibold">
          {studio.name}
        </Link>
        <ul className="flex items-center gap-4 text-sm">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href}>{link.label}</Link>
            </li>
          ))}
          <li>
            {user ? (
              <Link href="/portal" className="font-medium">
                My account
              </Link>
            ) : (
              <Link href="/sign-in" className="font-medium">
                Sign in
              </Link>
            )}
          </li>
        </ul>
      </nav>
    </header>
  );
}
```

`components/site-footer.tsx`:

```tsx
import { studio } from "@/content/studio";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t">
      <div className="mx-auto max-w-5xl p-4 text-sm">
        <p>{studio.name}</p>
        <p>{studio.address.join(", ")}</p>
        <p>
          <a href={`tel:${studio.phone.replace(/[^\d+]/g, "")}`}>{studio.phone}</a>
          {" · "}
          <a href={`mailto:${studio.email}`}>{studio.email}</a>
        </p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Build the public layout**

`app/(public)/layout.tsx`:

```tsx
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
```

- [ ] **Step 4: Build the marketing pages**

`app/(public)/page.tsx`:

```tsx
import Link from "next/link";
import { studio } from "@/content/studio";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-4xl font-semibold">{studio.name}</h1>
      <p className="mt-4 max-w-2xl text-lg">{studio.tagline}</p>
      <div className="mt-8 flex gap-4">
        <Link href="/classes" className="rounded bg-black px-5 py-2.5 text-white">
          Browse classes
        </Link>
        <Link href="/schedule" className="rounded border px-5 py-2.5">
          See the schedule
        </Link>
      </div>
      <section className="mt-16">
        <h2 className="text-2xl font-semibold">Studio hours</h2>
        <ul className="mt-4 space-y-1">
          {studio.hours.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

`app/(public)/staff/page.tsx`:

```tsx
import type { Metadata } from "next";
import { studio } from "@/content/studio";

export const metadata: Metadata = { title: `Staff — ${studio.name}` };

export default function StaffPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-semibold">Our staff</h1>
      <ul className="mt-8 grid gap-8 sm:grid-cols-2">
        {studio.staff.map((member) => (
          <li key={member.name}>
            <h2 className="text-xl font-medium">{member.name}</h2>
            <p className="text-sm text-gray-600">{member.title}</p>
            <p className="mt-2">{member.bio}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

`app/(public)/contact/page.tsx`:

```tsx
import type { Metadata } from "next";
import { studio } from "@/content/studio";

export const metadata: Metadata = { title: `Contact — ${studio.name}` };

export default function ContactPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-semibold">Contact us</h1>
      <div className="mt-8 space-y-6">
        <section>
          <h2 className="text-lg font-medium">Phone</h2>
          <p><a href={`tel:${studio.phone.replace(/[^\d+]/g, "")}`}>{studio.phone}</a></p>
        </section>
        <section>
          <h2 className="text-lg font-medium">Email</h2>
          <p><a href={`mailto:${studio.email}`}>{studio.email}</a></p>
        </section>
        <section>
          <h2 className="text-lg font-medium">Address</h2>
          <address className="not-italic">
            {studio.address.map((line) => <span key={line} className="block">{line}</span>)}
          </address>
        </section>
        <section>
          <h2 className="text-lg font-medium">Hours</h2>
          <ul>{studio.hours.map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npm run dev` and visit `/`, `/staff`, `/contact`.
Expected: each page renders with header and footer; the header shows "Sign in"
when signed out and "My account" when signed in.
Run: `npm run typecheck` — Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add public site shell with home, staff, and contact pages"
```

---

### Task 9: Public class catalog

**Files:**
- Create: `components/class-card.tsx`
- Create: `app/(public)/classes/page.tsx`
- Create: `lib/dates.ts`
- Test: `tests/unit/dates.test.ts`

**Interfaces:**
- Consumes: `listPublishedOfferings` and `getCurrentSeason` from Task 4;
  `formatCents` and `formatTimeRange` from Task 1; `db` from Task 2.
- Produces: `ClassCard` component taking `{ offering: ClassOffering }`;
  `todayIso(): string` and `formatDayOfWeek(day: DayOfWeek): string` from
  `@/lib/dates`.

- [ ] **Step 1: Write the failing test**

`tests/unit/dates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatDayOfWeek, todayIso } from "@/lib/dates";

describe("formatDayOfWeek", () => {
  it("capitalizes each weekday", () => {
    expect(formatDayOfWeek("monday")).toBe("Monday");
    expect(formatDayOfWeek("saturday")).toBe("Saturday");
  });
});

describe("todayIso", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formats a supplied date in UTC", () => {
    expect(todayIso(new Date("2026-09-01T23:30:00Z"))).toBe("2026-09-01");
    expect(todayIso(new Date("2026-09-01T00:30:00Z"))).toBe("2026-09-01");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/dates.test.ts`
Expected: FAIL — `Cannot find module '@/lib/dates'`

- [ ] **Step 3: Write the implementation**

`lib/dates.ts`:

```ts
import type { DayOfWeek } from "@/db/schema";

/** Returns a date as YYYY-MM-DD in UTC. Defaults to now. */
export function todayIso(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function formatDayOfWeek(day: DayOfWeek): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/unit/dates.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Build the class card**

`components/class-card.tsx`:

```tsx
import type { ClassOffering } from "@/db/schema";
import { formatCents, formatTimeRange } from "@/lib/format";
import { formatDayOfWeek } from "@/lib/dates";

function ageRange(offering: ClassOffering): string | null {
  const { minAge, maxAge } = offering;
  if (minAge !== null && maxAge !== null) return `Ages ${minAge}–${maxAge}`;
  if (minAge !== null) return `Ages ${minAge}+`;
  if (maxAge !== null) return `Ages up to ${maxAge}`;
  return null;
}

export function ClassCard({ offering }: { offering: ClassOffering }) {
  const seatsLeft = offering.capacity - offering.seatsTaken;
  const ages = ageRange(offering);

  return (
    <article className="rounded-lg border p-5">
      <h3 className="text-xl font-medium">{offering.name}</h3>
      <p className="mt-1 text-sm text-gray-600">
        {formatDayOfWeek(offering.dayOfWeek)},{" "}
        {formatTimeRange(offering.startTime, offering.endTime)}
      </p>

      {offering.description && <p className="mt-3">{offering.description}</p>}

      <dl className="mt-4 space-y-1 text-sm">
        {offering.level && (
          <div className="flex gap-2">
            <dt className="font-medium">Level</dt>
            <dd>{offering.level}</dd>
          </div>
        )}
        {ages && (
          <div className="flex gap-2">
            <dt className="font-medium">Ages</dt>
            {/* Advisory only — enrollment does not enforce this. */}
            <dd>{ages.replace("Ages ", "")} (suggested)</dd>
          </div>
        )}
        {offering.instructor && (
          <div className="flex gap-2">
            <dt className="font-medium">Instructor</dt>
            <dd>{offering.instructor}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="font-medium">Tuition</dt>
          <dd>{formatCents(offering.monthlyPriceCents)} per month</dd>
        </div>
        {offering.seasonFeeCents > 0 && (
          <div className="flex gap-2">
            <dt className="font-medium">Season fee</dt>
            <dd>{formatCents(offering.seasonFeeCents)} once</dd>
          </div>
        )}
      </dl>

      <p className="mt-4 text-sm font-medium">
        {seatsLeft <= 0
          ? "Full"
          : seatsLeft <= 3
            ? `${seatsLeft} ${seatsLeft === 1 ? "spot" : "spots"} left`
            : "Space available"}
      </p>
    </article>
  );
}
```

Enrollment buttons are deliberately absent — signup arrives in Phase 2.

- [ ] **Step 6: Build the catalog page**

`app/(public)/classes/page.tsx`:

```tsx
import type { Metadata } from "next";
import { db } from "@/db";
import { getCurrentSeason, listSeasons } from "@/db/queries/seasons";
import { listPublishedOfferings } from "@/db/queries/class-offerings";
import { ClassCard } from "@/components/class-card";
import { todayIso } from "@/lib/dates";
import { studio } from "@/content/studio";

export const metadata: Metadata = { title: `Classes — ${studio.name}` };
export const revalidate = 300;

export default async function ClassesPage() {
  const season =
    (await getCurrentSeason(db, todayIso())) ?? (await listSeasons(db))[0] ?? null;

  if (!season) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <h1 className="text-3xl font-semibold">Classes</h1>
        <p className="mt-4">
          Our next season has not been published yet. Please check back soon.
        </p>
      </main>
    );
  }

  const offerings = await listPublishedOfferings(db, season.id);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-semibold">Classes</h1>
      <p className="mt-2 text-gray-600">{season.name}</p>

      {offerings.length === 0 ? (
        <p className="mt-8">No classes are published for this season yet.</p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {offerings.map((offering) => (
            <ClassCard key={offering.id} offering={offering} />
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Verify with seed data**

Insert a season and two published offerings using `npm run db:studio`, then run
`npm run dev` and visit `/classes`.
Expected: both classes render, sorted by weekday then start time, with prices
formatted as dollars. Setting `seats_taken` equal to `capacity` shows "Full".

Run: `npm test` — Expected: PASS, all suites
Run: `npm run typecheck` — Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add public class catalog with live availability"
```

---

### Task 10: Public weekly schedule

**Files:**
- Create: `lib/week.ts`
- Create: `components/weekly-schedule.tsx`
- Create: `app/(public)/schedule/page.tsx`
- Test: `tests/unit/week.test.ts`

**Interfaces:**
- Consumes: `listOccurrencesBetween` and `ScheduledClass` from Task 5;
  `formatTimeRange` from Task 1.
- Produces: `weekBounds(date: string): { from: string; to: string }` and
  `addDaysIso(date: string, days: number): string` from `@/lib/week`;
  `WeeklySchedule` component taking `{ classes: ScheduledClass[]; from: string }`.

- [ ] **Step 1: Write the failing test**

`tests/unit/week.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDaysIso, weekBounds } from "@/lib/week";

describe("addDaysIso", () => {
  it("adds days across a month boundary", () => {
    expect(addDaysIso("2026-09-29", 3)).toBe("2026-10-02");
  });

  it("subtracts days across a year boundary", () => {
    expect(addDaysIso("2027-01-02", -3)).toBe("2026-12-30");
  });

  it("handles a leap day", () => {
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("weekBounds", () => {
  it("returns Sunday through Saturday for a midweek date", () => {
    // 2026-09-02 is a Wednesday.
    expect(weekBounds("2026-09-02")).toEqual({
      from: "2026-08-30",
      to: "2026-09-05",
    });
  });

  it("returns the same week when given its Sunday", () => {
    expect(weekBounds("2026-08-30")).toEqual({
      from: "2026-08-30",
      to: "2026-09-05",
    });
  });

  it("returns the same week when given its Saturday", () => {
    expect(weekBounds("2026-09-05")).toEqual({
      from: "2026-08-30",
      to: "2026-09-05",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/week.test.ts`
Expected: FAIL — `Cannot find module '@/lib/week'`

- [ ] **Step 3: Write the implementation**

`lib/week.ts`:

```ts
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parse(value: string): Date {
  if (!ISO_DATE.test(value)) {
    throw new Error(`Expected a date in YYYY-MM-DD format, got "${value}"`);
  }
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

/** Shifts a YYYY-MM-DD date by a signed number of days, in UTC. */
export function addDaysIso(date: string, days: number): string {
  const shifted = parse(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Returns the Sunday-to-Saturday week containing the given date. */
export function weekBounds(date: string): { from: string; to: string } {
  const parsed = parse(date);
  const from = addDaysIso(date, -parsed.getUTCDay());
  return { from, to: addDaysIso(from, 6) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/unit/week.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Build the schedule component**

`components/weekly-schedule.tsx`:

```tsx
import type { ScheduledClass } from "@/db/queries/class-occurrences";
import { formatTimeRange } from "@/lib/format";
import { addDaysIso } from "@/lib/week";

const WEEKDAY_LABEL = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function label(isoDate: string): string {
  return WEEKDAY_LABEL.format(new Date(`${isoDate}T00:00:00Z`));
}

export function WeeklySchedule({
  classes,
  from,
}: {
  classes: ScheduledClass[];
  from: string;
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDaysIso(from, index));
  const byDate = new Map<string, ScheduledClass[]>();
  for (const entry of classes) {
    const bucket = byDate.get(entry.occurrence.date) ?? [];
    bucket.push(entry);
    byDate.set(entry.occurrence.date, bucket);
  }

  return (
    <div className="mt-8 grid gap-6 md:grid-cols-7">
      {days.map((date) => {
        const entries = byDate.get(date) ?? [];
        return (
          <section key={date}>
            <h2 className="text-sm font-semibold">{label(date)}</h2>
            {entries.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No classes</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {entries.map(({ occurrence, offering }) => {
                  const cancelled = occurrence.status === "cancelled";
                  return (
                    <li key={occurrence.id} className="rounded border p-2 text-sm">
                      <p className={cancelled ? "font-medium line-through" : "font-medium"}>
                        {offering.name}
                      </p>
                      <p className={cancelled ? "text-gray-500 line-through" : "text-gray-600"}>
                        {formatTimeRange(offering.startTime, offering.endTime)}
                      </p>
                      {offering.room && !cancelled && (
                        <p className="text-gray-600">{offering.room}</p>
                      )}
                      {cancelled && (
                        <p className="mt-1 font-medium text-red-700">
                          Cancelled{occurrence.note ? ` — ${occurrence.note}` : ""}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

Cancelled classes stay visible with a strike-through rather than disappearing.
A parent who arrives expecting a class needs to see that it was cancelled, not
find an empty slot.

- [ ] **Step 6: Build the schedule page**

`app/(public)/schedule/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/db";
import { listOccurrencesBetween } from "@/db/queries/class-occurrences";
import { WeeklySchedule } from "@/components/weekly-schedule";
import { todayIso } from "@/lib/dates";
import { addDaysIso, weekBounds } from "@/lib/week";
import { studio } from "@/content/studio";

export const metadata: Metadata = { title: `Schedule — ${studio.name}` };
export const revalidate = 300;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const anchor =
    params.week && ISO_DATE.test(params.week) ? params.week : todayIso();
  const { from, to } = weekBounds(anchor);

  const classes = await listOccurrencesBetween(db, from, to);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-3xl font-semibold">Schedule</h1>

      <nav aria-label="Week" className="mt-4 flex items-center gap-4 text-sm">
        <Link href={`/schedule?week=${addDaysIso(from, -7)}`}>← Previous week</Link>
        <span className="text-gray-600">
          {from} to {to}
        </span>
        <Link href={`/schedule?week=${addDaysIso(from, 7)}`}>Next week →</Link>
      </nav>

      <WeeklySchedule classes={classes} from={from} />
    </main>
  );
}
```

- [ ] **Step 7: Verify**

Run `npm run db:studio` and confirm occurrences exist for the current season
(run `syncOccurrencesForOffering` from Task 12's admin UI, or insert rows
manually). Then run `npm run dev` and visit `/schedule`.
Expected: seven day columns; classes appear on their weekday; previous/next
week links move the window; a row with `status = 'cancelled'` shows struck
through with its note.

Run: `npm test` — Expected: PASS, all suites
Run: `npm run typecheck` — Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add public weekly schedule with cancellation display"
```

---

### Task 11: Parent portal — family and student management

**Files:**
- Create: `app/portal/layout.tsx`, `app/portal/page.tsx`
- Create: `app/portal/students/page.tsx`, `app/portal/students/new/page.tsx`
- Create: `app/portal/students/[studentId]/page.tsx`
- Create: `app/portal/actions.ts`
- Create: `lib/validation.ts`
- Test: `tests/unit/validation.test.ts`

**Interfaces:**
- Consumes: `requireUser` and `requireFamilyId` from Task 7; the student
  queries from Task 3; `db` from Task 2.
- Produces: `studentInputSchema` from `@/lib/validation` (a Zod schema parsing
  `{ firstName, lastName, birthdate, notes }`); from `@/app/portal/actions` the
  type `ActionState = { error: string | null }`, the constant `idleState`, and
  the server actions
  `createStudentAction(prev: ActionState, formData: FormData): Promise<ActionState>`
  and
  `updateStudentAction(studentId: string, prev: ActionState, formData: FormData): Promise<ActionState>`
  (both redirect on success rather than returning); and the client component
  `StudentForm` from `@/components/student-form`, taking
  `{ action: (prev: ActionState, formData: FormData) => Promise<ActionState>; student?: Student; submitLabel: string }`.

- [ ] **Step 1: Write the failing validation test**

`tests/unit/validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { studentInputSchema } from "@/lib/validation";

describe("studentInputSchema", () => {
  it("accepts a valid student", () => {
    const parsed = studentInputSchema.parse({
      firstName: "Maya",
      lastName: "Alvarez",
      birthdate: "2015-04-12",
      notes: "",
    });
    expect(parsed.firstName).toBe("Maya");
    expect(parsed.notes).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    const parsed = studentInputSchema.parse({
      firstName: "  Maya  ",
      lastName: " Alvarez ",
      birthdate: "2015-04-12",
    });
    expect(parsed.firstName).toBe("Maya");
    expect(parsed.lastName).toBe("Alvarez");
  });

  it("rejects an empty name", () => {
    expect(() =>
      studentInputSchema.parse({
        firstName: "   ",
        lastName: "Alvarez",
        birthdate: "2015-04-12",
      }),
    ).toThrow();
  });

  it("rejects a malformed birthdate", () => {
    expect(() =>
      studentInputSchema.parse({
        firstName: "Maya",
        lastName: "Alvarez",
        birthdate: "04/12/2015",
      }),
    ).toThrow();
  });

  it("rejects a birthdate in the future", () => {
    expect(() =>
      studentInputSchema.parse({
        firstName: "Maya",
        lastName: "Alvarez",
        birthdate: "2999-01-01",
      }),
    ).toThrow();
  });

  it("rejects an implausibly old birthdate", () => {
    expect(() =>
      studentInputSchema.parse({
        firstName: "Maya",
        lastName: "Alvarez",
        birthdate: "1900-01-01",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/validation.test.ts`
Expected: FAIL — `Cannot find module '@/lib/validation'`

- [ ] **Step 3: Write the implementation**

`lib/validation.ts`:

```ts
import { z } from "zod";
import { todayIso } from "@/lib/dates";

const EARLIEST_BIRTHDATE = "1920-01-01";

const trimmedName = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1, "Required").max(80));

export const studentInputSchema = z.object({
  firstName: trimmedName,
  lastName: trimmedName,
  birthdate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")
    .refine((value) => value <= todayIso(), "Birthdate cannot be in the future")
    .refine((value) => value >= EARLIEST_BIRTHDATE, "Birthdate is not plausible"),
  notes: z
    .string()
    .max(2000)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    }),
});

export type StudentInput = z.infer<typeof studentInputSchema>;
```

Run: `npm test -- tests/unit/validation.test.ts` — Expected: PASS, 6 tests

- [ ] **Step 4: Write the server actions**

`app/portal/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { createStudent, updateStudent } from "@/db/queries/students";
import { requireFamilyId } from "@/lib/guards";
import { studentInputSchema } from "@/lib/validation";

/**
 * Actions take `prevState` first so they can be driven by `useActionState`,
 * which is what lets the form render the error instead of silently
 * discarding it. A form action passed straight to `<form action={...}>`
 * throws its return value away.
 */
export type ActionState = { error: string | null };

export const idleState: ActionState = { error: null };

function readForm(formData: FormData) {
  return {
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    birthdate: String(formData.get("birthdate") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

export async function createStudentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const familyId = await requireFamilyId();
  const parsed = studentInputSchema.safeParse(readForm(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  await createStudent(db, familyId, parsed.data);
  revalidatePath("/portal/students");
  redirect("/portal/students");
}

export async function updateStudentAction(
  studentId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const familyId = await requireFamilyId();
  const parsed = studentInputSchema.safeParse(readForm(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  // Scoping lives in the query's WHERE clause: a student belonging to another
  // family matches nothing and returns null.
  const updated = await updateStudent(db, familyId, studentId, parsed.data);
  if (!updated) {
    return { error: "That student could not be found." };
  }

  revalidatePath("/portal/students");
  redirect("/portal/students");
}
```

- [ ] **Step 5: Build the portal layout and pages**

`app/portal/layout.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/guards";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="flex items-center justify-between border-b pb-4">
        <div>
          <p className="text-sm text-gray-600">Signed in as {user.email}</p>
          <h1 className="text-2xl font-semibold">My account</h1>
        </div>
        <nav className="flex gap-4 text-sm">
          <Link href="/portal">Overview</Link>
          <Link href="/portal/students">Students</Link>
          <Link href="/">Back to site</Link>
        </nav>
      </header>
      <div className="mt-8">{children}</div>
    </div>
  );
}
```

`app/portal/page.tsx`:

```tsx
import Link from "next/link";
import { db } from "@/db";
import { listStudents } from "@/db/queries/students";
import { requireFamilyId } from "@/lib/guards";

export default async function PortalHome() {
  const familyId = await requireFamilyId();
  const students = await listStudents(db, familyId);

  return (
    <section>
      <h2 className="text-xl font-medium">Overview</h2>
      <p className="mt-2">
        {students.length === 0
          ? "You have not added any students yet."
          : `You have ${students.length} ${students.length === 1 ? "student" : "students"} on file.`}
      </p>
      <p className="mt-4">
        <Link href="/portal/students" className="underline">
          Manage students
        </Link>
      </p>
      <p className="mt-8 text-sm text-gray-600">
        Online class enrollment arrives in a future update. To enroll now,
        please contact the studio. Payment is always handled in person at the
        studio.
      </p>
    </section>
  );
}
```

`app/portal/students/page.tsx`:

```tsx
import Link from "next/link";
import { db } from "@/db";
import { listStudents } from "@/db/queries/students";
import { requireFamilyId } from "@/lib/guards";

export default async function StudentsPage() {
  const familyId = await requireFamilyId();
  const students = await listStudents(db, familyId);

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium">Students</h2>
        <Link href="/portal/students/new" className="rounded bg-black px-4 py-2 text-sm text-white">
          Add a student
        </Link>
      </div>

      {students.length === 0 ? (
        <p className="mt-6">Add each dancer in your family to get started.</p>
      ) : (
        <ul className="mt-6 divide-y rounded border">
          {students.map((student) => (
            <li key={student.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">
                  {student.firstName} {student.lastName}
                </p>
                <p className="text-sm text-gray-600">Born {student.birthdate}</p>
              </div>
              <Link href={`/portal/students/${student.id}`} className="text-sm underline">
                Edit
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`components/student-form.tsx` — one client component serving both the add and
edit pages, so the error display and field list exist in a single place:

```tsx
"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/portal/actions";
import { idleState } from "@/app/portal/actions";
import type { Student } from "@/db/schema";

export function StudentForm({
  action,
  student,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  student?: Student;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);

  return (
    <form action={formAction} className="mt-6 max-w-md space-y-4">
      <label className="block">
        <span className="text-sm font-medium">First name</span>
        <input name="firstName" required defaultValue={student?.firstName ?? ""}
          className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Last name</span>
        <input name="lastName" required defaultValue={student?.lastName ?? ""}
          className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Date of birth</span>
        <input name="birthdate" type="date" required defaultValue={student?.birthdate ?? ""}
          className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Notes for instructors (optional)</span>
        <textarea name="notes" rows={3} defaultValue={student?.notes ?? ""}
          className="mt-1 w-full rounded border px-3 py-2" />
        <span className="mt-1 block text-xs text-gray-600">
          Allergies, injuries, or anything the studio should know.
        </span>
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-red-700">{state.error}</p>
      )}

      <button type="submit" disabled={pending}
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
```

`app/portal/students/new/page.tsx`:

```tsx
import { StudentForm } from "@/components/student-form";
import { createStudentAction } from "@/app/portal/actions";

export default function NewStudentPage() {
  return (
    <section>
      <h2 className="text-xl font-medium">Add a student</h2>
      <StudentForm action={createStudentAction} submitLabel="Save student" />
    </section>
  );
}
```

`app/portal/students/[studentId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { db } from "@/db";
import { getStudent } from "@/db/queries/students";
import { requireFamilyId } from "@/lib/guards";
import { StudentForm } from "@/components/student-form";
import { updateStudentAction } from "@/app/portal/actions";

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const familyId = await requireFamilyId();
  const student = await getStudent(db, familyId, studentId);

  // A student belonging to another family returns null, so this is a 404 —
  // not "forbidden", which would confirm the record exists.
  if (!student) notFound();

  // Binding the ID server-side means the browser never supplies it, so a
  // tampered form cannot retarget the update at another student.
  const action = updateStudentAction.bind(null, student.id);

  return (
    <section>
      <h2 className="text-xl font-medium">
        Edit {student.firstName} {student.lastName}
      </h2>
      <StudentForm action={action} student={student} submitLabel="Save changes" />
    </section>
  );
}
```

- [ ] **Step 6: Verify the authorization boundary by hand**

Run `npm run dev`. Create two accounts in different browser profiles, add a
student to each, and copy the student ID out of one account's edit URL. Paste
it into the other account's `/portal/students/<id>` URL.
Expected: a 404 page, not the other family's student.

Run: `npm test` — Expected: PASS, all suites
Run: `npm run typecheck` — Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add parent portal with family-scoped student management"
```

---

### Task 12: Admin backoffice — seasons and class offerings

**Files:**
- Create: `app/admin/layout.tsx`, `app/admin/page.tsx`
- Create: `app/admin/seasons/page.tsx`, `app/admin/classes/page.tsx`
- Create: `app/admin/actions.ts`
- Create: `lib/admin-validation.ts`
- Test: `tests/unit/admin-validation.test.ts`

**Interfaces:**
- Consumes: `requireStaff` and `requireAdmin` from Task 7; the season, offering,
  and occurrence queries from Tasks 4 and 5.
- Produces: `seasonInputSchema` and `offeringInputSchema` from
  `@/lib/admin-validation`; from `@/app/admin/actions` the type
  `ActionState = { error: string | null }`, the constant `idleState`, and the
  server actions
  `createSeasonAction(prev: ActionState, formData: FormData): Promise<ActionState>`,
  `createOfferingAction(prev: ActionState, formData: FormData): Promise<ActionState>`,
  `publishOfferingAction(offeringId: string, published: boolean): Promise<void>`,
  and `syncOccurrencesAction(offeringId: string): Promise<{ created: number }>`;
  and the client component `AdminForm` from `@/components/admin-form`.

- [ ] **Step 1: Write the failing test**

`tests/unit/admin-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { offeringInputSchema, seasonInputSchema } from "@/lib/admin-validation";

describe("seasonInputSchema", () => {
  it("accepts a valid season", () => {
    const parsed = seasonInputSchema.parse({
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });
    expect(parsed.name).toBe("Fall 2026");
  });

  it("rejects an end date before the start date", () => {
    expect(() =>
      seasonInputSchema.parse({
        name: "Backwards",
        startDate: "2026-12-19",
        endDate: "2026-09-01",
      }),
    ).toThrow();
  });
});

describe("offeringInputSchema", () => {
  const valid = {
    seasonId: "8f1b0f4e-1c2d-4a5b-9e6f-7a8b9c0d1e2f",
    name: "Ballet I",
    dayOfWeek: "tuesday",
    startTime: "16:00",
    endTime: "17:00",
    capacity: "12",
    monthlyPrice: "65.00",
    seasonFee: "50.00",
  };

  it("converts dollar strings to integer cents", () => {
    const parsed = offeringInputSchema.parse(valid);
    expect(parsed.monthlyPriceCents).toBe(6500);
    expect(parsed.seasonFeeCents).toBe(5000);
  });

  it("handles amounts that would drift in floating point", () => {
    expect(
      offeringInputSchema.parse({ ...valid, monthlyPrice: "70.10" }).monthlyPriceCents,
    ).toBe(7010);
    expect(
      offeringInputSchema.parse({ ...valid, monthlyPrice: "0.29" }).monthlyPriceCents,
    ).toBe(29);
  });

  it("normalizes a time without seconds", () => {
    const parsed = offeringInputSchema.parse(valid);
    expect(parsed.startTime).toBe("16:00:00");
    expect(parsed.endTime).toBe("17:00:00");
  });

  it("rejects an end time at or before the start time", () => {
    expect(() =>
      offeringInputSchema.parse({ ...valid, endTime: "16:00" }),
    ).toThrow();
    expect(() =>
      offeringInputSchema.parse({ ...valid, endTime: "15:00" }),
    ).toThrow();
  });

  it("rejects a capacity below one", () => {
    expect(() => offeringInputSchema.parse({ ...valid, capacity: "0" })).toThrow();
  });

  it("rejects a negative price", () => {
    expect(() =>
      offeringInputSchema.parse({ ...valid, monthlyPrice: "-5.00" }),
    ).toThrow();
  });

  it("rejects a price with more than two decimal places", () => {
    expect(() =>
      offeringInputSchema.parse({ ...valid, monthlyPrice: "65.005" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/admin-validation.test.ts`
Expected: FAIL — `Cannot find module '@/lib/admin-validation'`

- [ ] **Step 3: Write the implementation**

`lib/admin-validation.ts`:

```ts
import { z } from "zod";

const DOLLARS = /^\d+(\.\d{1,2})?$/;

/**
 * Parses a dollar string into integer cents using string arithmetic.
 * `Math.round(Number("70.10") * 100)` happens to work, but the same pattern
 * silently loses a cent on other values — so the digits are handled as text.
 */
function dollarsToCents(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  const paddedFraction = fraction.padEnd(2, "0");
  return Number(whole) * 100 + Number(paddedFraction);
}

const dollarAmount = z
  .string()
  .regex(DOLLARS, "Enter an amount like 65.00")
  .transform(dollarsToCents);

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Enter a time like 16:00")
  .transform((value) => (value.length === 5 ? `${value}:00` : value));

export const seasonInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    registrationOpen: z.coerce.boolean().optional(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "The season must end on or after it starts",
    path: ["endDate"],
  });

export const offeringInputSchema = z
  .object({
    seasonId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional().transform((v) => v || null),
    level: z.string().trim().max(60).optional().transform((v) => v || null),
    minAge: z.coerce.number().int().min(0).max(120).optional(),
    maxAge: z.coerce.number().int().min(0).max(120).optional(),
    dayOfWeek: z.enum([
      "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
    ]),
    startTime: clockTime,
    endTime: clockTime,
    room: z.string().trim().max(60).optional().transform((v) => v || null),
    instructor: z.string().trim().max(120).optional().transform((v) => v || null),
    capacity: z.coerce.number().int().min(1).max(500),
    monthlyPrice: dollarAmount,
    seasonFee: dollarAmount.optional(),
  })
  .refine((value) => value.endTime > value.startTime, {
    message: "The class must end after it starts",
    path: ["endTime"],
  })
  .transform(({ monthlyPrice, seasonFee, ...rest }) => ({
    ...rest,
    monthlyPriceCents: monthlyPrice,
    seasonFeeCents: seasonFee ?? 0,
  }));
```

Run: `npm test -- tests/unit/admin-validation.test.ts` — Expected: PASS, 9 tests

- [ ] **Step 4: Write the admin actions**

`app/admin/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { createSeason } from "@/db/queries/seasons";
import { createOffering, updateOffering } from "@/db/queries/class-offerings";
import { syncOccurrencesForOffering } from "@/db/queries/class-occurrences";
import { requireStaff } from "@/lib/guards";
import { offeringInputSchema, seasonInputSchema } from "@/lib/admin-validation";

// Same shape as the portal actions, for the same reason: `useActionState`
// needs the previous state first so the form can render the error.
export type ActionState = { error: string | null };

export const idleState: ActionState = { error: null };

function toObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && value !== "") result[key] = value;
  }
  return result;
}

export async function createSeasonAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const parsed = seasonInputSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  await createSeason(db, parsed.data);
  revalidatePath("/admin/seasons");
  return { error: null };
}

export async function createOfferingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const parsed = offeringInputSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const offering = await createOffering(db, parsed.data);
  // Build the calendar immediately so the class appears on /schedule.
  await syncOccurrencesForOffering(db, offering.id);

  revalidatePath("/admin/classes");
  revalidatePath("/classes");
  revalidatePath("/schedule");
  return { error: null };
}

export async function publishOfferingAction(
  offeringId: string,
  published: boolean,
): Promise<void> {
  await requireStaff();
  await updateOffering(db, offeringId, { published });

  revalidatePath("/admin/classes");
  revalidatePath("/classes");
  revalidatePath("/schedule");
}

/** Re-runs occurrence generation, e.g. after a season's dates change. */
export async function syncOccurrencesAction(offeringId: string) {
  await requireStaff();
  const created = await syncOccurrencesForOffering(db, offeringId);

  revalidatePath("/schedule");
  return { created };
}
```

- [ ] **Step 5: Build the admin pages**

`components/admin-form.tsx` — a client wrapper that renders the fields it is
given, plus the error and pending state from `useActionState`. Server
components pass already-rendered fields as `children`:

```tsx
"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/admin/actions";
import { idleState } from "@/app/admin/actions";

export function AdminForm({
  action,
  submitLabel,
  className,
  children,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);

  return (
    <form action={formAction} className={className}>
      {children}
      {state.error && (
        <p role="alert" className="text-sm text-red-700">{state.error}</p>
      )}
      <button type="submit" disabled={pending}
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
```

`app/admin/layout.tsx`:

```tsx
import Link from "next/link";
import { requireStaff } from "@/lib/guards";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireStaff();

  return (
    <div className="mx-auto max-w-5xl p-8">
      <header className="flex items-center justify-between border-b pb-4">
        <div>
          <p className="text-sm text-gray-600">
            {user.email} · {user.role}
          </p>
          <h1 className="text-2xl font-semibold">Studio admin</h1>
        </div>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/seasons">Seasons</Link>
          <Link href="/admin/classes">Classes</Link>
          <Link href="/">Back to site</Link>
        </nav>
      </header>
      <div className="mt-8">{children}</div>
    </div>
  );
}
```

`app/admin/page.tsx`:

```tsx
import Link from "next/link";
import { db } from "@/db";
import { listSeasons } from "@/db/queries/seasons";

export default async function AdminHome() {
  const seasons = await listSeasons(db);

  return (
    <section>
      <h2 className="text-xl font-medium">Overview</h2>
      <p className="mt-2">
        {seasons.length === 0
          ? "No seasons yet. Create one to start adding classes."
          : `${seasons.length} ${seasons.length === 1 ? "season" : "seasons"} configured.`}
      </p>
      <p className="mt-4">
        <Link href="/admin/seasons" className="underline">Manage seasons</Link>
      </p>
    </section>
  );
}
```

`app/admin/seasons/page.tsx`:

```tsx
import { db } from "@/db";
import { listSeasons } from "@/db/queries/seasons";
import { AdminForm } from "@/components/admin-form";
import { createSeasonAction } from "@/app/admin/actions";

export default async function AdminSeasonsPage() {
  const seasons = await listSeasons(db);

  return (
    <section>
      <h2 className="text-xl font-medium">Seasons</h2>

      <AdminForm action={createSeasonAction} submitLabel="Add season"
        className="mt-6 flex flex-wrap items-end gap-4 rounded border p-4">
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <input name="name" required placeholder="Fall 2026"
            className="mt-1 rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Starts</span>
          <input name="startDate" type="date" required className="mt-1 rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Ends</span>
          <input name="endDate" type="date" required className="mt-1 rounded border px-3 py-2" />
        </label>
      </AdminForm>

      <ul className="mt-8 divide-y rounded border">
        {seasons.map((season) => (
          <li key={season.id} className="p-4">
            <p className="font-medium">{season.name}</p>
            <p className="text-sm text-gray-600">
              {season.startDate} to {season.endDate}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`app/admin/classes/page.tsx`:

```tsx
import { db } from "@/db";
import { listSeasons } from "@/db/queries/seasons";
import { listAllOfferings } from "@/db/queries/class-offerings";
import { AdminForm } from "@/components/admin-form";
import { createOfferingAction, publishOfferingAction } from "@/app/admin/actions";
import { formatCents, formatTimeRange } from "@/lib/format";
import { formatDayOfWeek } from "@/lib/dates";

const DAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

export default async function AdminClassesPage() {
  const seasons = await listSeasons(db);
  const activeSeason = seasons[0];

  if (!activeSeason) {
    return (
      <section>
        <h2 className="text-xl font-medium">Classes</h2>
        <p className="mt-4">Create a season first.</p>
      </section>
    );
  }

  const offerings = await listAllOfferings(db, activeSeason.id);

  return (
    <section>
      <h2 className="text-xl font-medium">Classes — {activeSeason.name}</h2>

      <AdminForm action={createOfferingAction} submitLabel="Add class"
        className="mt-6 grid gap-4 rounded border p-4 sm:grid-cols-2">
        <input type="hidden" name="seasonId" value={activeSeason.id} />
        <label className="block">
          <span className="text-sm font-medium">Class name</span>
          <input name="name" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Instructor</span>
          <input name="instructor" className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Day</span>
          <select name="dayOfWeek" required className="mt-1 w-full rounded border px-3 py-2">
            {DAYS.map((day) => (
              <option key={day} value={day}>{formatDayOfWeek(day)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Room</span>
          <input name="room" className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Starts</span>
          <input name="startTime" type="time" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Ends</span>
          <input name="endTime" type="time" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Capacity</span>
          <input name="capacity" type="number" min={1} required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Suggested ages</span>
          <span className="mt-1 flex gap-2">
            <input name="minAge" type="number" min={0} placeholder="min"
              className="w-full rounded border px-3 py-2" />
            <input name="maxAge" type="number" min={0} placeholder="max"
              className="w-full rounded border px-3 py-2" />
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Monthly tuition (dollars)</span>
          <input name="monthlyPrice" required placeholder="65.00"
            className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Season fee (dollars)</span>
          <input name="seasonFee" placeholder="50.00"
            className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium">Description</span>
          <textarea name="description" rows={2} className="mt-1 w-full rounded border px-3 py-2" />
        </label>
      </AdminForm>

      <ul className="mt-8 divide-y rounded border">
        {offerings.map((offering) => (
          <li key={offering.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{offering.name}</p>
              <p className="text-sm text-gray-600">
                {formatDayOfWeek(offering.dayOfWeek)}{" "}
                {formatTimeRange(offering.startTime, offering.endTime)} ·{" "}
                {formatCents(offering.monthlyPriceCents)}/mo ·{" "}
                {offering.seatsTaken}/{offering.capacity} enrolled
              </p>
            </div>
            <form action={publishOfferingAction.bind(null, offering.id, !offering.published)}>
              <button type="submit" className="rounded border px-3 py-1.5 text-sm">
                {offering.published ? "Unpublish" : "Publish"}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 6: Promote yourself to admin and verify**

The first staff account is promoted by hand — there is deliberately no
self-service path to elevated roles. With the dev server stopped:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d jdu_web `
  -c "UPDATE \"user\" SET role = 'admin' WHERE email = 'you@example.com';"
```

Sign out and back in so the session picks up the new role. Then verify:

- `/admin` loads for the admin account and shows the forbidden page for a parent account;
- creating a season, then a class, produces occurrences visible on `/schedule`;
- publishing the class makes it appear on `/classes`;
- entering `65.00` stores `6500` in `monthly_price_cents` (check in `db:studio`).

Run: `npm test` — Expected: PASS, all suites
Run: `npm run typecheck` — Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add admin backoffice for seasons and class offerings"
```

---

### Task 13: End-to-end test of the critical path

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/registration.spec.ts`
- Create: `e2e/fixtures/seed.ts`
- Modify: `lib/auth.ts` (add a test-only verification bypass)
- Modify: `.env.example`

**Interfaces:**
- Consumes: every prior task.
- Produces: `npm run test:e2e` as the end-to-end command; `seedSeasonWithClass()`
  from `@/e2e/fixtures/seed`, which creates a published class and returns its
  name.

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test@1.62.1
npx playwright install chromium
```

- [ ] **Step 2: Add a test-only verification bypass**

End-to-end tests cannot click a link in a real inbox. Modify `lib/auth.ts` so
verification is skipped only when an explicit test flag is set:

```ts
  emailAndPassword: {
    enabled: true,
    // Verification is always required outside the E2E suite. The flag is set
    // only by playwright.config.ts, never in .env.
    requireEmailVerification: process.env.E2E_SKIP_EMAIL_VERIFICATION !== "true",
    minPasswordLength: 10,
  },
```

and in `emailVerification`, skip the send under the same flag:

```ts
    sendVerificationEmail: async ({ user, url }) => {
      if (process.env.E2E_SKIP_EMAIL_VERIFICATION === "true") return;
      await sendEmail({ /* …unchanged… */ });
    },
```

Add to `.env.example` with a comment:

```
# Set only by the E2E suite. Never set this in a real environment.
# E2E_SKIP_EMAIL_VERIFICATION=true
```

- [ ] **Step 3: Write the Playwright config**

`playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env" });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // The E2E run uses the test database, not the development one.
      DATABASE_URL: process.env.TEST_DATABASE_URL!,
      BETTER_AUTH_URL: "http://localhost:3100",
      E2E_SKIP_EMAIL_VERIFICATION: "true",
    },
  },
});
```

- [ ] **Step 4: Write the seed fixture**

`e2e/fixtures/seed.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { createSeason } from "@/db/queries/seasons";
import { createOffering } from "@/db/queries/class-offerings";
import { syncOccurrencesForOffering } from "@/db/queries/class-occurrences";

/**
 * Creates a published class in the test database and returns its name.
 * The season spans a wide range so the class always appears in the
 * current week regardless of when the suite runs.
 */
export async function seedSeasonWithClass(): Promise<string> {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    const year = new Date().getUTCFullYear();
    const season = await createSeason(db, {
      name: `E2E ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year + 1}-12-31`,
    });

    const name = `E2E Ballet ${Date.now()}`;
    const offering = await createOffering(db, {
      seasonId: season.id,
      name,
      dayOfWeek: "tuesday",
      startTime: "16:00:00",
      endTime: "17:00:00",
      capacity: 12,
      monthlyPriceCents: 6500,
      seasonFeeCents: 5000,
      published: true,
    });
    await syncOccurrencesForOffering(db, offering.id);

    return name;
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 5: Write the end-to-end test**

`e2e/registration.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { seedSeasonWithClass } from "./fixtures/seed";

test.describe("family registration", () => {
  let className: string;

  test.beforeAll(async () => {
    className = await seedSeasonWithClass();
  });

  test("a parent can register, add a student, and see the catalog", async ({ page }) => {
    const email = `e2e+${Date.now()}@example.com`;

    await page.goto("/sign-up");
    await page.getByLabel("Your name").fill("Ana Alvarez");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Create account" }).click();

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/portal$/);

    await page.getByRole("link", { name: "Students" }).click();
    await page.getByRole("link", { name: "Add a student" }).click();
    await page.getByLabel("First name").fill("Maya");
    await page.getByLabel("Last name").fill("Alvarez");
    await page.getByLabel("Date of birth").fill("2015-04-12");
    await page.getByRole("button", { name: "Save student" }).click();

    await expect(page.getByText("Maya Alvarez")).toBeVisible();

    await page.goto("/classes");
    await expect(page.getByRole("heading", { name: className })).toBeVisible();
    await expect(page.getByText("$65.00 per month")).toBeVisible();
  });

  test("the public schedule shows the seeded class", async ({ page }) => {
    await page.goto("/schedule");
    await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Week" })).toBeVisible();
  });

  test("an unauthenticated visitor is redirected away from the portal", async ({ page }) => {
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("a parent cannot reach the admin area", async ({ page }) => {
    const email = `e2e-parent+${Date.now()}@example.com`;

    await page.goto("/sign-up");
    await page.getByLabel("Your name").fill("Ben Brooks");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Create account" }).click();

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Not allowed" })).toBeVisible();
  });
});
```

- [ ] **Step 6: Run the end-to-end suite**

Run: `npm run test:e2e`
Expected: PASS, 4 tests. If the dev server fails to start, confirm
`TEST_DATABASE_URL` is set and that port 3100 is free.

- [ ] **Step 7: Run the full verification sweep**

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: all four succeed with no errors. `npm run build` must pass — a page
that renders in dev but fails to build is not shippable.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test: add end-to-end coverage for registration and access control"
```

---

## Phase 1 completion checklist

Before declaring Phase 1 done, confirm each of these by running the command and
reading the output — not by assuming:

- [ ] `npm run typecheck` passes with no errors
- [ ] `npm test` passes every unit and integration suite
- [ ] `npm run test:e2e` passes all four scenarios
- [ ] `npm run build` completes successfully
- [ ] A parent cannot read another family's student by ID (verified by hand in Task 11)
- [ ] A parent account receives the forbidden page at `/admin`
- [ ] Real studio copy has replaced the placeholders in `content/studio.ts`
- [ ] `.env` is not committed (`git status` shows it ignored)

## What Phase 1 deliberately does not do

No money moves, and none ever will — payment is collected in person at the
studio, and this application has no payment integration, no invoices, and no
balances by design rather than by sequencing. Class prices are displayed so
families know what a class costs, and that is the full extent of the system's
involvement with money.

There is also no enrollment button in Phase 1. The `seats_taken` column exists
but stays at zero — it is here so Phase 2 adds behavior rather than
restructuring the table. Families who want to enroll during Phase 1 contact the
studio directly and staff record it manually, which is the same thing Phase 2
automates.
