# Phase 3a — Enrollment Notifications: Design

**Date:** 2026-08-28
**Status:** Approved for implementation planning
**Scope:** The delivery substrate and the three enrollment lifecycle emails.
Announcements, class cancellations, fan-out retry, and broadcast preferences are
Phase 3b.

---

## 1. Why this is split from Phase 3b

The system design (§5, §9 of the 2026-08-14 spec) treats Notifications as one
phase covering four things: the three enrollment emails, announcements with
targeted fan-out, class-occurrence cancellations, and per-recipient delivery
tracking with an admin-triggered retry.

Those four are not equally coupled. The delivery substrate — a row per
recipient, written before sending, marked afterward — is plumbing every one of
them needs. The lifecycle emails are its simplest possible consumer: one event,
one family, no fan-out, no audience query, no unsubscribe. Announcements and
cancellations add a second layer on top of a substrate that by then already
works in production.

So Phase 3a builds the substrate and proves it on the lifecycle emails. Phase 3b
adds the broadcast layer. Each is independently shippable, and each is about the
size of Phase 2.

## 2. What Phase 3a delivers

- An `email_deliveries` table: one row per recipient per send.
- Three transactional emails — request received, request confirmed, request
  released — sent to every parent login on the family.
- A send path that never makes a parent wait on the email provider.
- An admin page listing deliveries that need retrying, with a Retry action.

## 3. Data model

### `email_deliveries`

One row per recipient per send.

| Column | Notes |
|---|---|
| `id` | uuid, primary key |
| `source_type` | `enrollment` now; `announcement` and `class_occurrence` in 3b |
| `source_id` | text — polymorphic, same reasoning as `audit_log.entity_id` |
| `template` | e.g. `enrollment.requested` — which email this is |
| `category` | `transactional` or `broadcast` |
| `recipient_user_id` | text, references `user.id`, on delete set null |
| `recipient_email` | text, not null — the address it actually went to |
| `subject`, `body_text`, `body_html` | the rendered message |
| `status` | `queued`, `sending`, `sent`, or `failed` |
| `provider_message_id` | Resend's id, once accepted |
| `error` | the provider or transport failure, when there is one |
| `attempts` | integer, incremented on each claim |
| `created_at`, `sent_at`, `updated_at` | |

Indexed on `status` (the retry page reads it) and on
`(source_type, source_id)` (every delivery for one enrollment).

### Three choices worth stating

**The rendered message is stored on the row.** A retry resends exactly what was
promised rather than re-rendering against a class whose price may have changed
in between. It also makes the row a truthful record of what the family actually
received, which is the same reason `audit_log` stores before and after snapshots
rather than pointers.

**`recipient_email` is snapshotted, not read through the user at send time.**
The address a message went to is a fact about that send. A row must stay
readable after the account is deleted, which is also why `recipient_user_id`
nulls rather than cascades.

**`category` exists in 3a even though nothing reads it yet.** Transactional and
broadcast mail are treated differently by law, and 3b's unsubscribe rule is a
predicate on this column. Adding it now costs one column; adding it later costs
a migration and a backfill whose answer has to be inferred.

## 4. The send path

### Queueing is inside the transition's transaction

Each of the three transitions — request, confirm, release — writes its delivery
rows in the same transaction that changes the enrollment's status, immediately
after the audit row.

This gives two guarantees at once. A rolled-back transition leaves no delivery
behind, so the studio can never email a family about a confirmation that did not
happen. And a committed transition always has its rows, so an email cannot be
silently lost between two separate commits.

### Sending is after the response

The action hands the delivery IDs to Next's `after()` (stable in 16.3.1, and
usable inside a server function). The transition commits and the action returns
immediately; the send runs once the response is finished and marks each row
`sent` or `failed`.

A parent therefore never waits on Resend, and a provider outage cannot make
"Request seat" appear to hang. The cost is that a failure is not visible in the
form that triggered it — which is what §6 is for.

### Claiming a row is exactly-once

`sending` exists so that two concurrent sends of one row cannot both proceed.
Claiming is a single conditional update:

```
UPDATE email_deliveries
   SET status = 'sending', attempts = attempts + 1
 WHERE id = $1 AND status IN ('queued', 'failed')
RETURNING *
```

The affected-row count is the decision, never a read followed by a write — the
same discipline as Phase 2's seat claim. Zero rows means someone else has it, or
it has already been sent.

## 5. Recipients and templates

Every parent login on the family receives its own row. Two parents on one family
both learn that a seat was confirmed or released; a family with a single login is
simply the one-row case; and addressing families rather than actors is the shape
3b's fan-out needs anyway.

Addressing the family rather than the acting user also settles the release case,
which has no acting parent at all — staff release a hold, and the family still
has to be told.

A family with no logins at all queues no rows, and that is not an error: the
transition still succeeds and still writes its audit entry. Nobody has asked to
be told, so there is nobody to tell.

Three templates:

- **Request received** — the seat is held, with the monthly price and the season
  fee, and a plain statement that payment happens at the studio in person.
- **Request confirmed** — staff have taken payment; the student is enrolled.
- **Request released** — the hold is gone, so nobody is left assuming a seat.

Each renders a text part and an HTML part sharing a small layout. Sending both is
what spam filters expect from transactional mail, and it costs a template string
rather than a dependency. None of the three carries an unsubscribe link: these
are transactional, and a family cannot opt out of being told what happened to
their own request.

Rendering is a pure function of typed data — no database access, no clock — so
the wording is unit-testable without a transaction.

## 6. Failures

`/admin/emails` lists deliveries needing attention, each with a Retry button that
re-enters the same claim path.

Two things appear there:

- anything `failed`
- anything still `sending` after fifteen minutes, which means the process died
  mid-send

Without the second case a crash would strand a row in a state nothing ever looks
at again. Retry is safe to press twice, because the claim is exactly-once.

## 7. Testing

**Unit** — the three render functions: that each names the student and the class,
that the request email states both amounts and the pay-in-person rule, and that
none of them contains an unsubscribe link.

**Integration** — that each transition queues one row per parent login; that a
rolled-back transition leaves zero rows; that two concurrent claims on one row
result in exactly one send, in the manner of Phase 2's last-seat race test; that
`sent` and `failed` transitions record the provider id and the error; and that
the retriable list catches both failed rows and rows stuck in `sending`.

**End to end** — a parent requests a seat and the delivery reaches `sent`,
through a capture transport selected by an environment variable, following the
existing `E2E_SKIP_EMAIL_VERIFICATION` precedent rather than inventing a new
mechanism.

## 8. What Phase 3a deliberately does not do

**No announcements and no cancellations.** Both are 3b, and both are the reason
the substrate is polymorphic rather than enrollment-shaped.

**No unsubscribe and no broadcast preference.** Nothing in 3a is broadcast mail.
The `category` column is in place so 3b can add the predicate without a
migration.

**No scheduled retry.** Nothing sweeps for failures on a timer; a person presses
Retry. The system still has no scheduled jobs, and §10 of the system design
records the condition under which the first one would earn its keep.

**No provider webhooks.** Bounces and complaints are recorded against a delivery
row in 3b, when there is a fan-out large enough for them to matter.
