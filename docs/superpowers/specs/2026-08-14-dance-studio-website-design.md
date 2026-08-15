# Dance Studio Website — Design

**Date:** 2026-08-14
**Status:** Approved for implementation planning
**Scope:** Full system architecture; Phase 1 proceeds to an implementation plan first.

---

## 1. Problem and context

A small dance studio serves roughly 400 students. It needs a website that lets
families pay their bill, sign up for classes, and receive schedule updates and
general announcements. Public traffic is low — a few hundred visitors a day at
most, with bursts at registration time and on the day invoices go out.

Nothing exists yet: no website, no domain, no payment processor account, and no
prior studio-management platform to migrate from. There is no launch deadline,
so the system is built and shipped in phases rather than rushed to a season
start.

### Decisions already made

| Decision | Choice |
|---|---|
| Build vs. buy | Fully custom, built in house |
| Charge types | Monthly tuition and a per-season fee |
| Tuition calculation | Flat price per class; a student's tuition is the sum of their enrolled classes |
| Class signup | Instant enrollment, limited by class capacity |
| Notification channels | Email to affected families, plus class-specific cancellations |
| Stack | Next.js + Postgres, TypeScript end to end |
| Autopay | On by default, with opt-out |
| Mid-month proration | Prorated by remaining class sessions |

### Non-goals

These are deliberately excluded from the first version. Each is straightforward
to add later, and each would meaningfully expand the state machine or the
compliance surface today.

- **SMS alerts.** Requires opt-in consent tracking and 10DLC carrier
  registration, which takes weeks to approve.
- **Waitlists.** Doubles the enrollment state machine for a feature that is not
  yet known to be needed.
- **Drop-in and class-pack purchases.** The studio does not sell them.
- **Automatic age and level gating.** Enrollment is instant by design; age and
  level are advisory.
- **Attendance tracking, costume ordering, recital ticketing, competition
  management.**
- **A native mobile app.** The site is responsive and works on phones.

---

## 2. Architecture

One Next.js application (App Router), one Postgres database, three audiences
served under a single domain.

```
                       ┌─────────────────────────────┐
   Public visitor ───► │  /            marketing     │
   Parent        ───► │  /portal      family portal │ ──► Postgres (Neon)
   Staff / admin ───► │  /admin       backoffice    │        ▲
                       └──────────────┬──────────────┘        │
                                      │                       │
                            server actions / route handlers   │
                                      │                       │
                     ┌────────────────┼────────────────┐      │
                     ▼                ▼                ▼      │
                  Stripe           Resend         Vercel Cron ┘
              (payments)          (email)      (invoicing, retries)
```

**Route groups**

- `/` — public marketing site. Classes, schedule, staff, published
  announcements, contact. Statically rendered and revalidated on content
  change; no authentication.
- `/portal` — authenticated family portal. My students, my enrollments, my
  bill, payment methods, announcements addressed to me.
- `/admin` — authenticated staff backoffice. Students, families, classes,
  rosters, invoices, adjustments, announcements, schedule changes.

**External services**

- **Stripe** — card tokenization, PaymentIntents, saved payment methods,
  webhooks. Called only from server code, never from the browser with secret
  keys.
- **Resend** — transactional and broadcast email.
- **Vercel Cron** — scheduled invoice generation and payment retries, invoking
  protected route handlers.

**Technology choices**

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router), TypeScript |
| Database | Postgres (Neon serverless) |
| Data access | Drizzle ORM, with SQL migrations checked into the repo |
| Auth | Better Auth — email/password, verification, reset |
| Payments | Stripe Elements (client) + Stripe Node SDK (server) |
| Email | Resend |
| Hosting | Vercel |
| Testing | Vitest (unit, integration), Playwright (end to end) |

Expected running cost is roughly $0–20 per month until email volume passes
Resend's free tier, after which about $20 per month.

### PCI scope

Card numbers are entered into Stripe Elements iframes and are tokenized by
Stripe in the browser. They never reach the application server and are never
written to the database. The application stores only Stripe identifiers and
display metadata such as brand and last four digits. This keeps the studio on
the simplest self-assessment questionnaire rather than a full audit.

---

## 3. Data model

The **family** is the center of the model, not the student. A family is the
entity that owes money, holds payment methods, and owns logins. A student is a
person who attends classes and belongs to exactly one family.

### Core entities

**`families`** — the billing entity. Name, address, phone, Stripe customer ID,
autopay enabled flag, created/updated timestamps.

**`users`** — a login. Belongs to a family (null for staff and admin accounts
not tied to one). Email, hashed password, email-verified flag, role
(`parent` | `staff` | `admin`). Two parents may share one family.

**`students`** — belongs to a family. First and last name, birthdate,
notes/medical information, active flag.

**`seasons`** — a billing and scheduling period. Name (e.g. "Fall 2026"), start
date, end date, and the set of months that get billed.

**`class_offerings`** — a scheduled class within a season. Name, description,
level, advisory minimum and maximum age, day of week, start and end time, room,
instructor, season, **capacity**, **seats_taken**, **monthly price in cents**,
**season fee in cents**, published flag.

**`enrollments`** — links a student to a class offering. Status
(`active` | `withdrawn`), start date, end date, and the timestamp at which
billing begins.

**`class_occurrences`** — dated instances of a class offering, generated across
the season for the calendar. Date, status (`scheduled` | `cancelled`), and a
note explaining a cancellation.

### Billing entities

**`invoices`** — one per family per billing period. Family, billing period
(year and month), status (`draft` | `open` | `paid` | `past_due` | `void`),
total in cents, amount paid in cents, due date, issued and paid timestamps.
A **unique index on (family_id, period)** enforces idempotent generation.

**`invoice_lines`** — belongs to an invoice. Description, amount in cents
(negative for credits), source type (`tuition` | `season_fee` | `manual_charge`
| `credit`), and an optional reference to the originating enrollment or
student.

**`payments`** — an attempt to collect against an invoice. Family, invoice,
Stripe PaymentIntent ID, amount in cents, status
(`pending` | `succeeded` | `failed`), failure reason, attempt number,
timestamps.

**`payment_methods`** — a saved card. Family, Stripe payment method ID, card
brand, last four digits, expiry month and year, default flag. **No card number
or CVC is ever stored.**

### Communication and audit

**`announcements`** — title, body, audience type (`all` | `class_offering`)
with an optional class reference, published timestamp, and email-sent
timestamp.

**`email_deliveries`** — one row per recipient per send. Links to the source
(announcement, invoice, or cancellation), recipient user, status
(`queued` | `sent` | `failed`), provider message ID, and timestamps. This is
what makes a partially failed fan-out safely resumable.

**`audit_log`** — actor user, action, entity type and ID, before and after
snapshots, timestamp. Written for every change that touches money or
enrollment. This is the record consulted when a parent disputes a charge.

### Money representation

Every monetary amount in the database and in application code is an **integer
count of cents**. Floating-point numbers are never used for money anywhere in
the system. Formatting to dollars happens only at the display boundary.

---

## 4. Billing engine

### Invoice generation

A Vercel Cron job runs on the 25th of each month and, for every family with at
least one active enrollment, assembles the following month's invoice:

1. One **tuition line** per active enrollment, at that class offering's flat
   monthly price.
2. A **season fee line** for any student whose season fee has not yet been
   charged for the current season.
3. Any **pending manual charges or credits** an administrator has queued for
   that family.

The invoice is created in `draft` status. Administrators have a review window
to correct problems before invoices are issued. On the 1st, a second job flips
draft invoices to `open`, sets the due date, emails the family, and — for
families with autopay enabled — initiates payment.

Generation is **idempotent**. The unique index on (family_id, period) means a
retried, duplicated, or manually re-run job cannot produce two invoices for the
same family and month. The job upserts rather than blindly inserting, and
re-running it after an enrollment change safely rebuilds a `draft` invoice.
Invoices that have left `draft` are never rebuilt; corrections are made through
adjustment lines instead.

### Joining charges

The monthly cron covers families who are already enrolled. A student who enrolls
on the 10th needs a charge for the remainder of *this* month, which no scheduled
invoice covers. Those **joining charges are collected at enrollment**, not
deferred:

1. The parent selects a class and the system computes the prorated tuition for
   the remainder of the current month plus the student's season fee, if unpaid.
2. The parent pays that total immediately, saving a card in the process.
3. Recurring monthly invoicing picks the family up from the following month
   onward, through the normal cron.

If the prorated amount is zero — no sessions remain in the joining month — only
the season fee is collected, and the enrollment still completes. Enrollment and
payment are committed together: a failed payment leaves no enrollment and
releases the seat.

### Proration

When a student enrolls partway through a month, that joining month's tuition is
prorated by **remaining class sessions**, not by calendar days. The calculation:

```
remaining = count of class_occurrences for this offering
            with date >= enrollment start and status = 'scheduled',
            within the joining month

total = count of class_occurrences for this offering
        within the joining month

prorated_cents = round_half_up(monthly_price_cents * remaining / total)
```

Rounding is half-up to the nearest cent, applied once at the end. Where total
is zero — no sessions remain in the joining month — the charge is zero and
billing begins with the next full month.

This ties the charge to something the parent can verify by counting Tuesdays on
the calendar, which is why it was chosen over calendar-day proration.

Season fees are **never prorated**. They are charged in full once per student
per season.

### Payment

Parents pay from the portal using a saved card or a new one entered through
Stripe Elements. The server creates a PaymentIntent with an **idempotency key**
derived from the invoice and attempt number, so a retried request cannot
double-charge.

The invoice is marked paid **when Stripe's webhook says so, not when the
browser does**. The browser can close mid-redirect, lose connectivity, or be
manipulated; the webhook is the authority. The webhook handler:

- verifies Stripe's signature on every request and rejects unsigned ones;
- is idempotent, keyed on the Stripe event ID, so redelivered events are safe;
- handles `payment_intent.succeeded`, `payment_intent.payment_failed`, and
  `payment_method.detached`;
- returns 200 quickly and performs slower work separately, so Stripe does not
  time out and retry unnecessarily.

### Autopay

Autopay is **enabled by default** for new families and can be turned off from
the portal at any time. Consent language is presented at the point a card is
saved, stating clearly that the card will be charged automatically each month
and that autopay can be cancelled at any time. A receipt is emailed after every
successful automatic charge — this is both a legal expectation and the main
thing that keeps automatic billing from feeling opaque to parents.

Families without a saved card, or with autopay off, receive a "your bill is
ready" email with a payment link.

### Failed payments

A declined or failed payment marks the invoice `past_due`, records the failure
reason on the payment row, and emails the family. Retries run on a backoff at
**day 3, day 7, and day 14** after the initial failure. After the third failed
retry, the system stops charging automatically and flags the family in the
admin dashboard for a human to follow up.

Enrollment is never automatically cancelled for non-payment. That is a
relationship decision the studio owner makes, not something software should do
silently.

### Mid-cycle changes

- **Withdrawal** is immediate for attendance and seat release: the student stops
  attending and the seat becomes available to another family right away. Billing
  stops after the current month — the current month is already paid for and is
  not automatically refunded.
- **Refunds and goodwill credits** are issued by an administrator as a negative
  invoice line, applied to the next invoice. Cash refunds through Stripe are a
  separate, explicit admin action.
- **Class price changes** apply to future invoices only. Already-issued
  invoices are never silently rewritten.

Every adjustment writes to the audit log with the acting user's identity.

---

## 5. Enrollment

Enrollment is instant and limited only by class capacity.

### The last-seat race

Two parents clicking "Enroll" on the final seat at the same moment must not
both succeed. Reading the seat count and then writing is not safe, because
another transaction can slip between the two steps. Instead, capacity is
claimed with a single conditional statement:

```sql
UPDATE class_offerings
   SET seats_taken = seats_taken + 1
 WHERE id = $1
   AND seats_taken < capacity;
```

If this updates zero rows, the class is full and the enrollment is rejected
with a clear message. The seat increment and the `enrollments` insert happen in
one transaction, so the counter and the roster can never disagree. Withdrawal
decrements the counter in the same transactional way.

The public catalog displays live availability — a remaining-seat count when
seats are scarce, and a "Full" state otherwise.

### Age and level

Because enrollment is instant by choice, the minimum and maximum age on a class
are **advisory and displayed, not enforced**. A parent may enroll a student
outside the suggested range; staff correct placement afterward. This is a
deliberate trade of automated correctness for a frictionless signup, and it
should be revisited if misplacement turns out to be common.

### Withdrawal

Parents may withdraw a student from a class through the portal. The seat is
released immediately so another family can take it, and the studio is notified.
Billing stops after the current month, which has already been paid and is not
automatically refunded. Administrators can issue a credit where circumstances
warrant.

---

## 6. Notifications

### Announcements

An announcement has a title, a body, and an audience of either **everyone** or
**one specific class**. Publishing always posts it to the public site and the
parent portal — the site is the system of record. An "also send by email"
option fans the announcement out to the audience's families.

### Class cancellations

Cancelling a class occurrence is a distinct action from posting an
announcement. An administrator opens the schedule, marks a specific dated
occurrence cancelled, and supplies a reason. This updates the public calendar
and the portal, and emails **only the families on that class's roster**.

### Email delivery

Email is sent through Resend by a background job that writes one
`email_deliveries` row per recipient before sending. If a fan-out to 400
families fails at recipient 200, the retry resumes from where it stopped rather
than re-sending to the first 200. Bounces and provider failures are recorded
against the individual delivery row.

Two categories of mail are treated differently, because the law treats them
differently:

- **Transactional** — invoices, receipts, payment failures, class
  cancellations, password resets. Always delivered; no unsubscribe link.
- **Broadcast** — general announcements and studio news. Carries an
  unsubscribe link and honours a per-user preference.

---

## 7. Authentication and authorization

Authentication is email and password through Better Auth, with email
verification on signup and a password reset flow. Sessions are HTTP-only
cookies.

Three roles:

- **`parent`** — sees only their own family's students, enrollments, invoices,
  and payment methods.
- **`staff`** — sees all students, classes, rosters, and the schedule; can post
  announcements and cancel classes; cannot issue refunds or credits.
- **`admin`** — everything staff can do, plus billing adjustments, refunds,
  credits, pricing, and user management.

**The authorization rule that matters most:** every portal query is scoped by
the session's family ID **at the data-access layer**, not by hiding elements in
the user interface. A parent editing an invoice ID in a URL must receive a 404,
not another family's bill. This is enforced by requiring every family-scoped
query function to take the session family ID as an argument, so omitting it is
a type error rather than a silent security hole.

Administrative route handlers and cron endpoints are protected server-side.
Cron endpoints additionally require a shared secret header, so they cannot be
triggered by anyone who guesses the URL.

---

## 8. Error handling

- **Never trust the client.** Prices, totals, capacity, and family ownership
  are always recomputed server-side. A submitted amount from the browser is
  treated as a hint at most, never as the amount charged.
- **Stripe webhook failures** return a non-2xx status so Stripe retries;
  handlers are idempotent so retries are harmless.
- **Cron job failures** are logged with the affected family IDs and surfaced in
  the admin dashboard. A failed invoice run is re-runnable by design.
- **Email failures** are recorded per recipient and retried; they never block
  the action that triggered them. An invoice is still valid if its notification
  email bounced.
- **Payment errors** are shown to parents in plain language ("your card was
  declined — try another card or contact your bank") rather than raw processor
  codes.
- **All money and enrollment mutations** write to the audit log, including
  failures.

---

## 9. Testing strategy

Development is test-driven throughout, in three tiers.

**Unit tests (Vitest).** Pure functions with no database or network. This tier
covers all billing arithmetic: proration across varying session counts,
invoice-line assembly, credit application, rounding at boundaries, and
zero/negative totals. Money bugs live here, and these tests are fast enough to
run on every save.

**Integration tests (Vitest against real Postgres).** Cover the guarantees that
only exist at the database level:

- two concurrent enrollments competing for one remaining seat — exactly one
  succeeds, and `seats_taken` matches the roster count;
- a double-fired invoice cron produces exactly one invoice per family per
  period;
- a redelivered Stripe webhook event does not double-apply a payment;
- a parent-scoped query cannot return another family's rows.

**End-to-end tests (Playwright).** The critical path only: register a family,
add a student, enroll in a class, pay the invoice. Stripe runs in test mode
with webhooks replayed through the Stripe CLI.

---

## 10. Delivery phases

Each phase is independently shippable and gets its own implementation plan.

### Phase 1 — Foundation

Public marketing site (home, classes, schedule, staff, contact), authentication
with email verification, family accounts, student profiles, class catalog and
season management, and the schedule display. No money moves in this phase. On
its own this is already a usable studio website.

### Phase 2 — Enrollment

Instant capacity-limited signup with the atomic seat claim, live availability
on the catalog, parent-initiated withdrawal, class rosters, and admin class
management. Still no automated billing — the studio would invoice manually,
which is a genuine fallback if Phase 3 is delayed.

### Phase 3 — Billing

Invoice generation and the draft review window, Stripe payment with saved
cards, autopay, the pay-my-bill page, receipts, admin adjustments and credits,
failed-payment retries, and the audit log surfaced in the admin UI.

### Phase 4 — Notifications

Announcements with targeted email fan-out, class-occurrence cancellations with
roster-scoped notification, per-recipient delivery tracking, and broadcast
email preferences.

---

## 11. Open items for later

- Whether misplacement by age or level becomes common enough to justify
  gating enrollment.
- Whether a waitlist is needed once classes routinely fill.
- Whether SMS is worth the 10DLC registration effort for snow-day closures.
- Domain registration, and whether email should send from the studio's own
  domain (recommended, and it materially improves deliverability).
