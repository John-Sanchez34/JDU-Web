# Phase 3b — Announcements and Cancellations: Design

**Date:** 2026-09-15
**Status:** Approved for implementation planning
**Scope:** The broadcast layer on top of Phase 3a's delivery substrate:
announcements with targeted fan-out, class-occurrence cancellation and
restoration, the broadcast preference and unsubscribe, and a per-announcement
delivery view with resumable sending.

---

## 1. Where this sits

Phase 3a built the delivery substrate — a row per recipient written before
sending, claimed exactly once, marked afterward — and proved it on the three
enrollment lifecycle emails, whose fan-out is at most the two parent logins on
one family.

Phase 3b is the layer that actually fans out. Nothing in the substrate changes:
`email_deliveries.source_type` already admits `announcement` and
`class_occurrence`, and `category` already distinguishes transactional from
broadcast. That was 3a's bet, and this phase is where it pays.

Provider webhooks — bounces and complaints recorded against a delivery row — are
deliberately **not** here. They are an inbound public endpoint with signature
verification, replay protection, and idempotency concerns, sharing only the
delivery table with this work. They are Phase 3c.

## 2. What Phase 3b delivers

- An `announcements` table with a draft → published lifecycle and a separate,
  once-only email send.
- Audience resolution: everyone currently enrolled, or the families of one
  class.
- Class-occurrence cancellation with a reason, notifying that class's roster,
  and restoration that corrects the record.
- A per-login broadcast preference, a one-click unsubscribe that does not
  require signing in, and a portal toggle to opt back in.
- A per-announcement delivery view showing sent, failed, and remaining, with a
  resume button — because the system still has no scheduled jobs.

## 3. Data model

### `announcements`

| Column | Notes |
|---|---|
| `id` | uuid, primary key |
| `title` | text, not null |
| `body` | text, not null — plain text; blank lines separate paragraphs |
| `audience_type` | `all` or `class_offering` |
| `class_offering_id` | uuid, null unless the audience is a class |
| `status` | `draft` or `published` |
| `published_at` | set when it goes on the site |
| `emailed_at` | set when the fan-out is *queued* |
| `created_by_user_id` | text, references `user.id`, on delete set null |
| `created_at`, `updated_at` | |

A check constraint pairs the two audience columns: `class_offering` requires the
reference and `all` forbids it, in the style of the existing `class_offerings`
checks. Indexed on `(status, published_at desc)` for the public list.

**`body` is plain text, not markdown.** Blank lines become paragraphs; the text
is escaped and wrapped at render time, in both the HTML email and the page. A
markdown dependency buys formatting nobody has asked for and brings an HTML
sanitisation problem with it.

**`emailed_at` is the send guard.** It is set when the delivery rows are
written, not when they are sent, because what must happen exactly once is the
*queueing*. Sending is already exactly-once at the row level.

### `user.broadcast_opted_out_at`

A nullable timestamp. Null means subscribed. A timestamp rather than a boolean
because the fact worth keeping is *when* somebody opted out — which is the
question asked if a complaint ever arrives. The preference is per login, not per
family: two parents on one family may disagree about studio news, and the
design's wording is "a per-user preference."

`db/schema/auth.ts` already carries hand-corrected additions to Better Auth's
generated table (`role`, `family_id`), so this follows an established pattern.

### `email_deliveries` is unchanged

No migration, no new column. The polymorphic source and the `category` column
were added in 3a for exactly this.

### Audit actions

Four new `audit_log` actions, written inside the transactions that cause them:
`announcement.published`, `announcement.emailed` (recording the audience and the
resolved recipient count), `occurrence.cancelled` (recording the reason), and
`occurrence.restored`. The opt-out is not audited — it is the recipient's own
choice about their own address, and `broadcast_opted_out_at` already records
when it happened.

## 4. Audience

Three resolvers, each returning distinct `{ userId, email }` pairs.

**Announcement, `all`** — every parent login whose family holds a `pending` or
`active` enrollment in an offering of the current season, excluding logins with
`broadcast_opted_out_at` set.

"Current families" rather than every registered account: an account that
enrolled three seasons ago and never returned has no reason to receive recital
mail, and mail to people who have forgotten the studio is where spam complaints
come from.

**Announcement, `class_offering`** — the same, narrowed to one offering. Still
broadcast, so it still honours the opt-out.

**Cancellation** — `pending` or `active` enrollments in the affected offering,
**ignoring** the opt-out, because a cancellation is transactional. A family
holding an unconfirmed seat is included: they have been told the seat is held
and may well plan to attend, and letting them drive to a dark studio because
staff had not yet processed payment is the worse failure.

### Between seasons

`getCurrentSeason` returns null when no season's date range contains today, which
would make a July announcement about autumn registration resolve to zero
recipients. So the `all` audience falls back to the most recently started season.

The send screen states the resolved count and the season it came from — "47
recipients, Fall 2026" — before anything goes out. A zero-recipient send must be
visible, never silent.

## 5. The announcement lifecycle

Create and edit write a draft. **Publish** is a conditional update
`WHERE status = 'draft'` that sets `published_at`, writes an audit row, and
revalidates the affected paths. It sends no email.

**Send** is a separate, confirmed step:

```
UPDATE announcements SET emailed_at = now()
 WHERE id = $1 AND status = 'published' AND emailed_at IS NULL
```

This update runs **first** inside the transaction, before the audience is
resolved and before a single delivery row is written. Two staff members pressing
Send at the same moment means the second updates zero rows and aborts having
queued nothing — the same affected-row-count discipline as Phase 2's seat claim
and 3a's delivery claim. The audience then resolves, rows are rendered and
inserted, an audit row is written, and the transaction commits.

Three steps rather than one because nobody should mail a hundred and fifty
families from a form they have not seen rendered.

**Editing after sending** is allowed — typos happen, and the site is the system
of record — but never re-sends. The page states that the announcement was
emailed and that the message families received said what it said at that time.
The delivery rows keep their snapshot, for the same reason 3a stores the
rendered body rather than re-deriving it.

## 6. Fan-out

The batch runner selects `queued` rows for one `(source_type, source_id)`,
oldest first, limited to fifty, and hands them to 3a's `deliverQueued`.

**`failed` rows are deliberately excluded.** A resume sends what has not been
attempted; an address the provider actively rejected is retried deliberately
from `/admin/emails`, one row at a time, by someone who has read the error.
Otherwise every press of "Send the rest" would silently re-attempt the same dead
address and re-fail it.

Two things are added to that path:

**Pacing.** A minimum interval of roughly 550ms between sends. Resend's default
allowance is about two requests a second; fifty unpaced sends would collect
429s and mark perfectly good addresses `failed`. Fifty paced sends is about
twenty-eight seconds, which sits comfortably inside `after()`.

**Rate-limit rejection stops the batch** rather than burning through the
remainder. Rows that were never attempted stay `queued`.

For the runner to act on that, it has to be able to *recognise* it. `sendEmail`
currently throws a plain `Error` carrying the provider's message, so telling a
rate limit from a bad address would mean matching on a string — brittle, and
wrong the first time Resend rewords anything. So `lib/email.ts` throws a typed
error carrying the provider's status code, and the runner branches on the code.
A rate limit stops the batch and leaves the row `queued`; anything else marks
that one row `failed` and moves on, as it does today.

Whatever is left is picked up by **Send the rest** on the announcement page,
which runs another batch. This needs no new concept of a stranded row: a queued
row nobody ever resumes ages onto `/admin/emails` after fifteen minutes, exactly
as 3a already defines.

The delivery view is a `GROUP BY status` over `email_deliveries` filtered by
`(source_type, source_id)`, which is already indexed — sent, failed, remaining.
No counter columns, because a counter and the rows it summarises will drift the
first time a process dies between the two writes.

## 7. Unsubscribe and the broadcast preference

The token is an HMAC of the user id under `BETTER_AUTH_SECRET`, compared in
constant time. No table, nothing to expire, nothing to clean up.

`/unsubscribe?u=<token>` renders a confirmation page on GET and **opts out only
on POST**. This matters more than it looks: corporate mail scanners and link
prefetchers follow every GET in a message, so a GET that unsubscribes will
quietly unsubscribe people who never clicked anything.

The same route handler serves RFC 8058 one-click unsubscribe. Broadcast mail —
and only broadcast mail — carries `List-Unsubscribe` and `List-Unsubscribe-Post`
headers pointing at it, so Gmail and Apple Mail show their own unsubscribe
button. That native button is the single most effective thing available for
keeping studio mail out of spam folders. It is a route handler rather than a
server action precisely because it must accept an unauthenticated POST from a
mailbox provider; the HMAC is the authentication. `lib/email.ts` gains a
`headers` passthrough.

Opting back in is a toggle at `/portal/preferences`. Both directions are
idempotent.

Transactional mail carries no unsubscribe link and no such headers. A family
cannot opt out of being told that their own class was cancelled.

## 8. Class cancellations

An occurrence is cancelled from `/admin/classes/[offeringId]`, where each
upcoming occurrence gets a Cancel control with a required reason. One
transaction: a conditional update `WHERE id = $1 AND status = 'scheduled'`
setting the status and the note, an audit row, and `class.cancelled` deliveries
queued for the roster. `after()` sends them through the same paced runner; a
roster cannot exceed capacity, so one batch always covers it.

The email names the class, the date, and the reason. It says nothing about
money — no credit, no make-up class, no refund, because nothing in this system
tracks any of those.

### Restoring

Un-cancelling sets the occurrence back to `scheduled` and clears the note, and
has to reckon with mail that may be in flight. In the same transaction:

- Cancellation deliveries for that occurrence still in `queued` are **deleted**.
  They describe a message that was never sent and now must never be sent. No
  history is lost: the audit log records both the cancellation and the
  restoration.
- `class.restored` is queued only for recipients whose cancellation row reached
  `sent`.
- A row in `sending` is left alone and its recipient treated as having been
  told, because the message may already be with the provider.

The effect is that a cancel-then-undo within seconds is silent, while a genuine
reinstatement reaches exactly the people who were told otherwise. Telling
families a class is cancelled and then quietly reinstating it is worse than the
cancellation was.

## 9. Where announcements appear

Publishing posts to the site, which is the system of record; email is a copy.

- **Public** `/announcements` — published announcements with the `all` audience
  only. A class-targeted announcement is for the families in that class, not for
  the open web. The page follows the existing `revalidate = 300` convention, and
  publish revalidates it explicitly.
- **Portal** — announcements addressed to this family: every `all` announcement,
  plus those targeting a class the family holds a seat in.

## 10. Templates

`lib/emails/announcement.ts` renders `announcement.posted`.
`lib/emails/class-occurrence.ts` renders `class.cancelled` and `class.restored`.

`lib/emails/layout.ts` gains a broadcast variant carrying the unsubscribe
footer; the transactional layout is untouched. Rendering stays a pure function
of typed data — no database, no clock — so wording is unit-testable without a
transaction, as in 3a.

## 11. Testing

**Unit.** That a broadcast render carries the unsubscribe link and a cancellation
render carries none; that no cancellation email mentions money; that a plain-text
body becomes escaped paragraphs, so a `<script>` tag in an announcement body
comes out inert; and that an unsubscribe token round-trips while tampered and
truncated tokens are rejected.

**Integration.** That the `all` audience includes current-season families and
excludes an opted-out login; that a family with two logins, one opted out, gets
one broadcast row and two cancellation rows; that publishing queues nothing;
that two concurrent sends queue exactly one set of rows; that a batch limit
leaves a resumable remainder; that restoring deletes queued cancellations and
mails only those whose cancellation was sent; and that the audience falls back
to the most recent season when no season contains today.

**End to end.** Staff draft, publish, and send an announcement; a parent sees it
in the portal; the public page shows an `all` announcement and not a
class-targeted one; and a parent who unsubscribes is skipped by the next
announcement. Through the capture transport, as in 3a — no test run reaches the
real provider.

## 12. What Phase 3b deliberately does not do

**No provider webhooks.** Bounces and complaints are Phase 3c, where an inbound
endpoint gets the attention its signature verification and idempotency deserve.

**No scheduled or delayed sends.** The system still has no scheduled jobs, and
§10 of the system design still records the condition under which the first one
would earn its keep.

**No markdown or rich text.** Plain text with paragraphs.

**No per-class preference granularity.** One broadcast preference per login.
Someone who wants only their own class's news is asking for something nobody has
asked for yet.

**No unpublish and no delete.** A published announcement is edited, not
retracted. Retraction is a different feature — it has to say something to the
people who already received it — and it is not needed to ship this.

**No SMS.** Still an open item in the system design, still gated on 10DLC
registration.
