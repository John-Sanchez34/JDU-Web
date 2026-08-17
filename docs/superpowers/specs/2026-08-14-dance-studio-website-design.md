# Dance Studio Website — Design

**Date:** 2026-08-14
**Status:** Approved for implementation planning
**Scope:** Full system architecture; Phase 1 proceeds to an implementation plan first.

---

## 1. Problem and context

A small dance studio serves roughly 400 students. It needs a website that
publishes its classes and prices, lets families sign up for those classes, and
delivers schedule updates and general announcements. Public traffic is low — a
few hundred visitors a day at most, with bursts at registration time.

**No money moves through this website, and no money is tracked in it.** Families
pay at the studio, in person, by whatever means the studio already accepts. The
site publishes what each class costs; everything after that — invoicing,
balances, receipts, collections — happens off-system, however the studio handles
it today. The application never learns whether a given family has paid, with one
exception: staff mark an enrollment request confirmed once payment has been
received, which is a statement about enrollment, not an accounting record.

This single decision removes the payment processor, the card vault, the billing
engine, and nearly all of the compliance surface from the system.

Nothing exists yet: no website, no domain, and no prior studio-management
platform to migrate from. There is no launch deadline, so the system is built
and shipped in phases rather than rushed to a season start.

### Decisions already made

| Decision | Choice |
|---|---|
| Build vs. buy | Fully custom, built in house |
| Payment collection | In person at the studio; the site never takes money |
| Money tracking | None — no invoices, no balances, no payment records |
| Published pricing | Each class displays a monthly price and a per-season fee |
| Class signup | Enrollment **request**, confirmed by staff once paid |
| Seat holds | A pending request holds its seat until staff act on it |
| Notification channels | Email to affected families, plus class-specific cancellations |
| Stack | Next.js + Postgres, TypeScript end to end |

### Non-goals

These are deliberately excluded from the first version. Each would meaningfully
expand the state machine or the compliance surface today.

- **Online payment of any kind.** No card entry, no saved cards, no autopay, no
  payment processor account. This is a standing product decision, not a
  sequencing one: the studio collects in person. Adding it later would mean
  reintroducing a processor integration, a webhook surface, and PCI
  self-assessment, so it should be a deliberate decision rather than a drift.
- **Invoicing and balance tracking.** The site publishes prices; it does not
  compute what any family owes, does not generate invoices, and stores no
  payment history. This also removes proration, credits, and adjustments, which
  existed only to make a billing engine correct.
- **Automatic expiry of seat holds.** Staff release stale requests by hand. See
  §4 for why, and §10 for the condition under which this should be revisited.
- **SMS alerts.** Requires opt-in consent tracking and 10DLC carrier
  registration, which takes weeks to approve.
- **Waitlists.** Doubles the enrollment state machine for a feature that is not
  yet known to be needed.
- **Drop-in and class-pack purchases.** The studio does not sell them.
- **Automatic age and level gating.** Age and level are advisory; staff confirm
  every enrollment anyway, which is where misplacement gets caught.
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
   Staff / admin ───► │  /admin       backoffice    │
                       └──────────────┬──────────────┘
                                      │
                            server actions / route handlers
                                      │
                                      ▼
                                   Resend
                                   (email)
```

Two absences define this architecture. There is **no payment processor**, which
is the single biggest simplification in the system — no webhook endpoint, no
idempotency keys on charges, no reconciliation between a processor's ledger and
ours, no card data anywhere. And there are **no scheduled jobs**: every write in
the system is initiated by a person clicking something. Nothing needs to happen
on the 1st of the month, so nothing has to run unattended, be monitored, or be
made re-runnable.

**Route groups**

- `/` — public marketing site. Classes with their prices, schedule, staff,
  published announcements, contact. Statically rendered and revalidated on
  content change; no authentication.
- `/portal` — authenticated family portal. My students, my enrollments and their
  status, announcements addressed to me.
- `/admin` — authenticated staff backoffice. Students, families, classes,
  rosters, the **pending enrollment request queue**, announcements, schedule
  changes.

**External services**

- **Resend** — transactional and broadcast email. The only external service in
  the system.

**Technology choices**

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router), TypeScript |
| Database | Postgres (Neon serverless) |
| Data access | Drizzle ORM, with SQL migrations checked into the repo |
| Auth | Better Auth — email/password, verification, reset |
| Payments | None — collected in person, outside this system |
| Email | Resend |
| Hosting | Vercel |
| Testing | Vitest (unit, integration), Playwright (end to end) |

Expected running cost is roughly $0–20 per month until email volume passes
Resend's free tier, after which about $20 per month.

---

## 3. Data model

The **family** is the center of the model, not the student. A family is the
entity that holds logins and is the unit the studio deals with. A student is a
person who attends classes and belongs to exactly one family.

### Core entities

**`families`** — the household. Name, address, phone, created/updated
timestamps. No payment or billing fields of any kind.

**`users`** — a login. Belongs to a family (null for staff and admin accounts
not tied to one). Email, hashed password, email-verified flag, role
(`parent` | `staff` | `admin`). Two parents may share one family.

**`students`** — belongs to a family. First and last name, birthdate,
notes/medical information, active flag.

**`seasons`** — a scheduling period. Name (e.g. "Fall 2026"), start date, end
date, registration-open flag.

**`class_offerings`** — a scheduled class within a season. Name, description,
level, advisory minimum and maximum age, day of week, start and end time, room,
instructor, season, **capacity**, **seats_taken**, **monthly price in cents**,
**season fee in cents**, published flag.

The two price fields are **display values only**. They tell a parent what the
class costs so they know what to bring to the studio. Nothing in the system
multiplies, sums, or accumulates them.

**`enrollments`** — links a student to a class offering. Status
(`pending` | `active` | `withdrawn` | `released`), requested-at timestamp,
confirmed-at timestamp and confirming user, start date, end date. The status
field carries the whole enrollment state machine described in §4.

**`class_occurrences`** — dated instances of a class offering, generated across
the season for the calendar. Date, status (`scheduled` | `cancelled`), and a
note explaining a cancellation.

### Communication and audit

**`announcements`** — title, body, audience type (`all` | `class_offering`)
with an optional class reference, published timestamp, and email-sent
timestamp.

**`email_deliveries`** — one row per recipient per send. Links to the source
(announcement, enrollment event, or cancellation), recipient user, status
(`queued` | `sent` | `failed`), provider message ID, and timestamps. This is
what makes a partially failed fan-out safely resumable.

**`audit_log`** — actor user, action, entity type and ID, before and after
snapshots, timestamp. Written for every change that touches enrollment status,
class rosters, capacity, or published prices. This is the record consulted when
a parent says they were told there was a seat, or that the price was different
when they signed up.

### Money representation

Every monetary amount in the database and in application code is an **integer
count of cents**, and floating-point numbers are never used for money.

This rule survives even though the system does no arithmetic on money, and it is
worth keeping precisely because it costs nothing: prices are stored as cents,
passed around as cents, and converted to dollars by a single formatter at the
display boundary. If balance tracking is ever added, the foundation is already
correct rather than needing a data migration.

---

## 4. Enrollment

Enrollment is a **request that staff confirm**, because payment happens in
person and the studio wants the seat and the payment to line up.

### The flow

1. A parent picks a class in the portal and submits an enrollment request for
   one of their students. The seat is claimed **at request time**.
2. The enrollment is created with status `pending`. The parent sees "requested —
   bring payment to the studio to confirm", and receives an email saying the
   same, including the class's monthly price and season fee so they know what to
   bring.
3. Staff take payment in person. In the admin queue they mark the request
   **confirmed**, moving it to `active`. The family is emailed a confirmation.
4. If the family never appears, or changes their mind, staff **release** the
   request. It moves to `released`, the seat is returned, and the family is
   emailed.

A `pending` enrollment holds a real seat and counts against `seats_taken`
exactly as an `active` one does. The difference between the two is whether the
studio has been paid, which is information the system is told rather than
information it derives.

### The last-seat race

Two parents clicking "Request enrollment" on the final seat at the same moment
must not both succeed. Reading the seat count and then writing is not safe,
because another transaction can slip between the two steps. Instead, capacity is
claimed with a single conditional statement:

```sql
UPDATE class_offerings
   SET seats_taken = seats_taken + 1
 WHERE id = $1
   AND seats_taken < capacity;
```

If this updates zero rows, the class is full and the request is rejected with a
clear message. The seat increment and the `enrollments` insert happen in one
transaction, so the counter and the roster can never disagree. Releasing and
withdrawing decrement the counter in the same transactional way.

This mechanism is unchanged by the move to staff confirmation — it simply now
guards a hold rather than a finished enrollment, which is exactly when the
contention happens.

The public catalog displays live availability — a remaining-seat count when
seats are scarce, and a "Full" state otherwise. **Pending requests count as
taken.** A class showing "2 seats left" must not accept a third request, or the
studio ends up promising seats it does not have.

### Seat holds never expire

An unconfirmed request holds its seat until a human acts on it. Nothing releases
it on a timer.

This is a deliberate trade. It means a family that requests a seat and never
follows through can lock that seat up indefinitely, which in a full class blocks
someone who would have paid. It is accepted because the alternative — automatic
expiry — requires a scheduled job, and that one job would be the only piece of
unattended infrastructure in the entire system: something to monitor, to make
idempotent, and to debug when it silently stops firing.

The mitigation is visibility rather than automation. The admin queue sorts
oldest-first and shows the age of every pending request, so a stale hold is the
first thing staff see. At roughly 400 students the studio is small enough that a
person notices. §10 records the condition under which this should be revisited.

### Age and level

The minimum and maximum age on a class are **advisory and displayed, not
enforced**. A parent may request a class outside the suggested range. Because
staff confirm every request by hand, misplacement is caught at confirmation
rather than needing to be prevented at signup — which is a better place for it,
since the person confirming knows the student.

### Withdrawal and released seats

Parents may withdraw a student from a class through the portal. The seat is
released immediately so another family can take it, and the studio is notified.
Whether any money is refunded is entirely a conversation at the studio; the
system has no opinion and no record.

Class **price changes** apply to what is displayed from that point forward.
Because nothing has been billed, there is no issued document to contradict — but
the change is written to the audit log, so if a parent says they signed up at a
different price there is a record of when it changed and who changed it.

---

## 5. Notifications

### Enrollment emails

Three transactional emails follow a request through its lifecycle:

- **Request received** — confirms the seat is held, and states the monthly price
  and season fee so the family knows what to bring to the studio.
- **Request confirmed** — sent when staff mark it paid and active.
- **Request released** — sent when staff release the hold, so the family is
  never left assuming they have a seat.

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
than re-sending to the first 200.

Because the system has no scheduled jobs, that retry is **triggered by an
administrator** from the announcement's delivery view, which shows how many
recipients succeeded and failed. Bounces and provider failures are recorded
against the individual delivery row.

Two categories of mail are treated differently, because the law treats them
differently:

- **Transactional** — enrollment requests, confirmations, releases, class
  cancellations, password resets. Always delivered; no unsubscribe link.
- **Broadcast** — general announcements and studio news. Carries an
  unsubscribe link and honours a per-user preference.

---

## 6. Authentication and authorization

Authentication is email and password through Better Auth, with email
verification on signup and a password reset flow. Sessions are HTTP-only
cookies.

Three roles:

- **`parent`** — sees only their own family's students and enrollments.
- **`staff`** — sees all students, classes, rosters, and the schedule; can
  confirm and release enrollment requests, post announcements, and cancel
  classes.
- **`admin`** — everything staff can do, plus pricing, class management, and
  user management.

**The authorization rule that matters most:** every portal query is scoped by
the session's family ID **at the data-access layer**, not by hiding elements in
the user interface. A parent editing a student ID in a URL must receive a 404,
not another family's record. This is enforced by requiring every family-scoped
query function to take the session family ID as an argument, so omitting it is
a type error rather than a silent security hole.

Administrative route handlers are protected server-side.

---

## 7. Error handling

- **Never trust the client.** Prices, capacity, and family ownership are always
  read server-side. A price submitted from the browser is ignored entirely —
  the displayed price comes from the database on every render.
- **A lost race must fail loudly.** Two staff members acting on the same pending
  request at once — one confirming, one releasing — must not both succeed and
  double-decrement `seats_taken`. Status transitions are guarded by the current
  status in the `WHERE` clause, so the second write updates zero rows and
  reports that the request was already handled.
- **Email failures** are recorded per recipient and retried on demand; they
  never block the action that triggered them. An enrollment is still valid if
  its confirmation email bounced.
- **All enrollment and pricing mutations** write to the audit log, including
  failures.

---

## 8. Testing strategy

Development is test-driven throughout, in three tiers.

**Unit tests (Vitest).** Pure functions with no database or network: money
formatting at its boundaries (zero, sub-dollar, thousands separators,
non-integer input rejected), time and weekday formatting, and occurrence-date
generation across month, year, and leap-day boundaries. With the billing engine
gone, this tier is small and fast.

**Integration tests (Vitest against real Postgres).** Cover the guarantees that
only exist at the database level:

- two concurrent requests competing for one remaining seat — exactly one gets
  the hold, and `seats_taken` matches the roster count;
- confirming an already-released request, and releasing an already-confirmed
  one, both fail without corrupting `seats_taken`;
- confirming the same request twice increments nothing and reports the second
  attempt as already handled;
- a released hold returns its seat and the class becomes requestable again;
- a parent-scoped query cannot return another family's rows.

**End-to-end tests (Playwright).** The critical path only: register a family,
add a student, request enrollment in a class, and confirm that request as staff.

---

## 9. Delivery phases

Each phase is independently shippable and gets its own implementation plan.

### Phase 1 — Foundation

Public marketing site (home, classes with prices, schedule, staff, contact),
authentication with email verification, family accounts, student profiles, class
catalog and season management, and the schedule display. No enrollment yet. On
its own this is already a usable studio website.

### Phase 2 — Enrollment

Request-based signup with the atomic seat claim, live availability that counts
pending holds, the staff confirmation queue sorted oldest-first, confirm and
release actions, parent-initiated withdrawal, class rosters, and admin class
management.

### Phase 3 — Notifications

Announcements with targeted email fan-out, the three enrollment lifecycle
emails, class-occurrence cancellations with roster-scoped notification,
per-recipient delivery tracking with admin-triggered retry, and broadcast email
preferences.

---

## 10. Open items for later

- **Whether seat holds need automatic expiry.** Revisit if staff find themselves
  regularly releasing abandoned requests, or if a full class is observed
  blocking a paying family. That is the point at which one scheduled job earns
  its keep — and it would be the first in the system.
- Whether the studio eventually wants the site to track balances after all. If
  so, the integer-cents convention means prices are already stored correctly;
  what would be new is invoices, payments, and everything that follows from
  them.
- Whether misplacement by age or level survives staff confirmation often enough
  to justify gating requests.
- Whether a waitlist is needed once classes routinely fill — closely related to
  the seat-hold question above.
- Whether SMS is worth the 10DLC registration effort for snow-day closures.
- Domain registration, and whether email should send from the studio's own
  domain (recommended, and it materially improves deliverability).
