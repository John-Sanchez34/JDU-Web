# JDU Web

The website for a small dance studio: a public marketing site and class
catalog, a parent portal where families manage students and their class seats,
and a staff backoffice for seasons, offerings, enrollment, and studio news.

**Status:** Phases 1 through 3b complete.

- **Phase 1 — foundation.** Families register, add students, and browse the
  class catalog and weekly schedule. Staff create seasons and classes and
  publish them.
- **Phase 2 — enrollment.** Families request a seat, staff confirm it, and
  either side can release it. Seat counts move with the requests.
- **Phase 3a — notifications.** Enrollment email, queued and sent after the
  response, with a staff retry page for anything that failed.
- **Phase 3b — announcements and cancellations.** Staff post studio news to
  the site and optionally email it, cancel and restore individual class dates,
  and families can opt out of studio news without losing the mail they need.

## What this application does not do

**No money moves through this system, and none ever will.** Payment is
collected in person at the studio. There is no payment integration, no
invoices, and no balances — by design, not by sequencing. Class prices are
*displayed* so families know what a class costs, and nothing sums or
accumulates them.

A confirmed seat therefore means "staff saw the payment", not "the system took
one". Requesting a seat holds it immediately; confirming it is a staff action
taken after the family brings payment to the studio in person.

## Stack

Node 24 · Next.js 16 (App Router) · React 19 · TypeScript 5.9 · Tailwind CSS 4
· Postgres 18 · Drizzle ORM · Better Auth · Resend · Zod · Vitest · Playwright

## Getting started

### Prerequisites

- **Node.js 24** (`node --version` should report v24.x)
- **Postgres 18**, running locally

### 1. Install dependencies

```bash
npm install
```

### 2. Create two databases

The test suite **truncates** its database between tests, so it must never point
at your development data. The harness refuses to run if `TEST_DATABASE_URL`
equals `DATABASE_URL`.

```sql
CREATE DATABASE jdu_web;
CREATE DATABASE jdu_web_test;
```

### 3. Configure the environment

```bash
cp .env.example .env
```

Then fill in `.env`:

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | Connection string for the development database |
| `TEST_DATABASE_URL` | Connection string for the test database — **must differ** from the above |
| `BETTER_AUTH_SECRET` | Session signing secret; generate with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Base URL of the app (`http://localhost:3000` in development). Also the origin of every unsubscribe link, so a wrong value mints links that go nowhere |
| `RESEND_API_KEY` | Resend API key, used to send all outbound email |
| `EMAIL_FROM` | From address on outbound email |

Two more are set only by the test suites and must never be set in a real
environment — `.env.example` documents both:

| Variable | What it is |
| --- | --- |
| `E2E_SKIP_EMAIL_VERIFICATION` | Disables the email verification requirement at sign-in. Set by `playwright.config.ts` only |
| `EMAIL_TRANSPORT` | `capture` short-circuits sending and returns a synthetic message id, so no test can reach the real provider |

`.env` is gitignored. Every variable is validated at startup by `lib/env.ts`,
so a missing one fails immediately with a clear message rather than at the
first request that needs it.

### 4. Run the migrations

```bash
npm run db:migrate
```

This migrates the **development** database only. The test database is migrated
automatically by the test harness the first time you run `npm test`.

### 5. Start the app

```bash
npm run dev
```

The site is at http://localhost:3000. It will be empty until you create a
season and some classes — see [Making yourself an admin](#making-yourself-an-admin).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Browse the database in Drizzle Studio |
| `npm run set-role` | Set an account's role (see "Making yourself an admin") |

## Testing

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

All four should pass before anything ships. A page that renders in development
but fails to build is not shippable, so `npm run build` is part of the sweep.

**Unit and integration tests** live in `tests/`. Integration tests share one
Postgres database, which the harness migrates on first use and truncates
between tests. Test files run sequentially rather than in parallel — two
workers would otherwise race to apply the same migration, and one file's
truncate would empty tables another file is mid-test on.

**End-to-end tests** live in `e2e/`. Playwright starts its own development
server on port 3100 pointed at the test database, so:

- Run `npm test` at least once first on a cold test database — the E2E server
  does not run migrations itself.
- Stop any `npm run dev` you have running. Next refuses to start a second
  development server in the same directory.

The E2E run sets `E2E_SKIP_EMAIL_VERIFICATION=true` so the suite can sign up
without clicking a link in a real inbox. **Never set this outside the E2E
suite** — it disables the email verification requirement at sign-in.

## Project structure

```
app/
  (public)/        Marketing site, catalog, schedule, announcements
  (auth)/          Sign in, sign up, verify
  portal/          Parent portal (requires a session)
    enrollments/   Seat requests and their status
    announcements/ Studio news, including class-targeted posts
    preferences/   Opt in or out of studio news
  admin/           Staff backoffice (requires the staff or admin role)
    seasons/       Create a season, open registration
    classes/       Offerings, and cancelling or restoring a date
    enrollments/   Confirm or release requested seats
    announcements/ Draft, publish, and send studio news
    emails/        Delivery log and retry
  unsubscribe/     One-click opt-out page (GET renders, POST acts)
  api/auth/        Better Auth route handler
  api/unsubscribe/ The endpoint List-Unsubscribe-Post points at
components/        Shared React components
content/           Studio copy — the owner edits this, not page code
db/
  schema/          Drizzle table definitions
  queries/         All database access
lib/
  emails/          Per-template rendering
  notifications/   The delivery runner — queueing, pacing, retry
  ...              Auth, guards, validation, formatting, date helpers
tests/             Unit and integration tests
e2e/               Playwright end-to-end tests
drizzle/           Generated SQL migrations
docs/              Design specs and implementation plans
```

## Conventions that matter

These are load-bearing. Breaking one is a bug even when it typechecks.

**Money is always integer cents.** Every monetary value in the database, in
application code, and in test fixtures is an integer count of cents. Floating
point is never used for money. Dollars appear only at the display boundary, via
`formatCents` in `lib/format.ts`. Dollar strings from admin forms are converted
with string arithmetic, not `Number(x) * 100`, which silently loses a cent on
some values.

**Family-scoped queries take `familyId` as their required first parameter.**
Any query reading family-owned data filters on it *in SQL*, never in
application code after fetching. Because the parameter is required, forgetting
to scope a query is a compile error. A record belonging to another family
returns `null`, which pages turn into a 404 rather than a "forbidden" — the
latter would confirm the record exists.

**Roles are a hierarchy**, not a set: `parent` < `staff` < `admin`. Guards in
`lib/guards.ts` (`requireUser`, `requireFamilyId`, `requireStaff`,
`requireAdmin`) check "at least this role", so an admin passes a staff check.

**A `"use server"` module may only export async functions.** Exporting a
constant or object from one makes every page that imports it fail to load at
runtime. This is why `ActionState` and `idleState` live in
`lib/action-state.ts` rather than beside the actions that use them.

**Every email is either `broadcast` or `transactional`, and the two obey
opposite rules.** Broadcast mail — studio news — carries an unsubscribe link
in its footer and `List-Unsubscribe` / `List-Unsubscribe-Post` headers, and
skips anyone who has opted out. Transactional mail — enrollment, a cancelled
class date — carries neither header nor link and reaches people regardless of
their preference, because it is the mail they need to know their child's class
changed. The opt-out filter lives in `resolveAnnouncementAudience` and nowhere
else; `resolveOccurrenceAudience` deliberately has none.

**Visiting an unsubscribe link must never opt anyone out.** `/unsubscribe`
renders a form and touches nothing; only the POST to `/api/unsubscribe` acts.
Corporate mail scanners follow every link in every message, so a GET that
unsubscribed would silently unsubscribe families who never clicked.

## Making yourself an admin

There is deliberately no self-service path to an elevated role. The first staff
account is promoted by hand.

Sign up through the site, verify your email, then run:

```bash
npm run set-role -- you@example.com admin
```

The command prints the change it made (`parent -> admin`), refuses any role
outside `parent`, `staff`, and `admin`, and tells you if no account has that
email. Run it again with `parent` to revoke access when someone leaves.

It reads `DATABASE_URL` from `.env`; override it on the command line to target
another database:

```bash
DATABASE_URL="postgres://..." npm run set-role -- you@example.com admin
```

Sign out and back in so the session picks up the new role — the role is carried
in the session cookie, so a session opened before the change still sees the old
one.

You can then reach `/admin` to create a season and add classes. Publishing a
class makes it appear on `/classes` and its occurrences on `/schedule`. Opening
registration on the season lets families request seats, which arrive at
`/admin/enrollments` for confirmation.

## Brand assets

The logo lives in two places:

- `assets/logo-jdu-source.avif` — the original artwork as supplied: black line
  art on an **opaque white** field.
- `public/logo-jdu.png` — what the site actually serves. The white field is
  knocked out to transparency and the ink repainted chalk (`#f2f0ec`), because
  the original would otherwise render as a white box on the dark floor.
- `app/icon.png` — the same mark in maple (`#d89a4e`) for the browser tab,
  which reads on both light and dark browser chrome.

Both derived files were generated from the source by mapping luminance to
alpha, which preserves the anti-aliased edges. Regenerate them from the source
if the artwork changes.

The source is a 190×292 raster, so the mark is only crisp at small sizes and
its arc text is unreadable below roughly 64px tall — which is why the header
pairs the mark with the studio name in type rather than relying on the logo
alone. A vector (SVG) original would remove that constraint.

## Before launch

`content/studio.ts` holds every piece of studio copy that appears on the public
site, so the owner can change it without touching page code. The studio name is
real; **the tagline, phone, email, address, hours, and staff entries are still
placeholders and must be replaced before launch.**

## Documentation

Design specs carry the reasoning; plans carry the task-by-task implementation.

- `specs/2026-08-14-dance-studio-website-design.md` — the system design and the
  reasoning behind it
- `specs/2026-08-28-phase-3a-notifications-design.md` — how email is queued,
  paced, and retried
- `specs/2026-09-15-phase-3b-announcements-design.md` — announcements,
  cancellations, and the opt-out model
- `plans/2026-08-14-phase-1-foundation.md` — Phase 1
- `plans/2026-08-19-phase-2-enrollment.md` — Phase 2 (plan only; its design is
  covered by the system design above)
- `plans/2026-08-28-phase-3a-notifications.md` — Phase 3a
- `plans/2026-09-15-phase-3b-announcements.md` — Phase 3b

All paths are relative to `docs/superpowers/`.
