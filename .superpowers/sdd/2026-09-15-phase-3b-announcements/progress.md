# SDD ledger — plan: docs/superpowers/plans/2026-09-15-phase-3b-announcements.md

Spec: docs/superpowers/specs/2026-09-15-phase-3b-announcements-design.md (read)
Branch: phase-3b-announcements
Merge base: f4b7208

## Pre-flight conflict scan

### Cross-task rows (pairs sharing a file or interface)

| Tasks | Produces → Consumes | Finding |
|---|---|---|
| 1 → 4 | `user.broadcastOptedOutAt`, `AnnouncementAudience` | Clean; names match |
| 1 → 6 | `announcements` table, `Announcement` type | Clean |
| 2 → 6 | `unsubscribeUrl(userId)` | Clean |
| 2 → 7 | `unsubscribePostUrl(userId)` | Clean |
| 2 → 10 | `verifyUnsubscribeToken` | Clean |
| 3 → 5 | `RenderedEmail` moves to `lib/emails/layout` | Clean; T3 precedes T5, and T3 re-exports from `enrollment.ts` so existing importers keep working |
| 3 → 6 | `renderAnnouncementEmail`, `ANNOUNCEMENT_TEMPLATE` | Clean |
| 3 → 11 | `renderClassOccurrenceEmail` / `ClassOccurrenceEmailData` | Clean; T11's `occurrenceEmailData` selects exactly className, dayOfWeek, startTime, endTime, date, and spreads `reason` |
| 4 → 5 | `Recipient` type | Clean; `audience.ts` does not import `email-deliveries`, so the dependency is one-way — no cycle |
| 4 → 6 | `resolveAnnouncementAudience(exec, input, today)` | Clean; T6 passes an `Announcement`, structurally compatible with the `{audienceType, classOfferingId}` param |
| 4 → 8 | `audienceSeasonId`, `resolveAnnouncementAudience` | Clean |
| 4 → 11 | `resolveOccurrenceAudience` | Clean |
| 5 → 7 | `listQueuedForSource`, `releaseToQueued` | Clean |
| 5 → 8 | `countDeliveriesByStatus` | Clean |
| 5 → 11 | `queueDeliveries` | Clean |
| 6 → 8 | `PublishResult`, `SendAnnouncementResult` reasons | Clean; the actions handle every declared reason |
| 7 → 8 | `deliverBatchForSource` | Clean |
| 7 → 11 | `deliverBatchForSource` for `class_occurrence` | Clean |
| 8 → 12 | Button labels "Save draft", "Publish", "Send the email" | Clean; e2e selectors match the components verbatim |
| 9 → 12 | `/announcements`, `/portal/announcements` | Clean |
| 10 → 12 | Button "Unsubscribe from studio news" | Clean |
| 11 → 12 | Placeholder "Why? Families will read this.", button "Cancel this date" | Clean |
| 3 → existing | `wrapHtml` gains a third optional parameter | Clean; `enrollment.ts`'s two-argument calls still compile |
| 11 → existing | New imports in `class-occurrences.ts` | **CONFLICT** — see Ruling 1 |
| 12 → existing | `signUp`/`signIn` duplicated from `e2e/enrollment.spec.ts` | **CONFLICT** — see Ruling 2 |
| 12 → existing | `email_deliveries` shared between e2e spec files | **RISK** — see Ruling 3 |

### Per-task self-consistency

| Task | Tests vs code, files created vs later touched | Finding |
|---|---|---|
| 1 | Schema module + migration + constraint tests | Consistent; `isCheckViolation` already exported from `enrollments.ts` |
| 2 | Pure module + unit tests | Consistent; `lib/env.ts` is loaded by `tests/setup/env.ts`, so the unit test can import it |
| 3 | Three template modules + unit tests | Consistent |
| 4 | One query module + integration tests | Consistent |
| 5 | Modifies `email-deliveries.ts` + integration tests | Consistent |
| 6 | One query module + integration tests | Consistent |
| 7 | Modifies transport and runner + unit and integration tests | Consistent; re-runs the two 3a delivery suites because it changes code under them |
| 8 | Validation + actions + pages + components | Consistent; the edit path uses `announcementEditSchema` because the form disables the audience fieldset and a disabled field submits nothing |
| 9 | Two pages + two nav edits | Consistent; exact arrays given |
| 10 | Query + route handler + page + portal form | Consistent; `/unsubscribe` is a page and `/api/unsubscribe` a route handler, so they never collide on one segment |
| 11 | Transitions + actions + UI + integration tests | Consistent apart from Ruling 1 |
| 12 | E2E spec + seed helpers | Consistent apart from Rulings 2 and 3 |

### Rulings made before execution

Ruling 1: Task 11's new imports are to be MERGED into the existing import
statements at the top of `db/queries/class-occurrences.ts`, not added as a
second block. That file already imports `{ and, asc, eq, gte, lte }` from
`drizzle-orm` and a set of tables from `@/db/schema`; the task text lists a
full import line that would duplicate them. Only `inArray` is genuinely new
from `drizzle-orm`, and only `emailDeliveries` from the schema. — Why:
duplicate import statements from the same module are a TypeScript error for
the named bindings and noise otherwise. — Cost if wrong: none; this is
mechanical.

Ruling 2: Task 12 is to extract `signUp` and `signIn` into a shared
`e2e/fixtures/auth.ts` and have BOTH `e2e/announcements.spec.ts` and
`e2e/enrollment.spec.ts` import them, rather than copying the two helpers
verbatim into the new spec as the task text shows. — Why: the plan's own
"No Placeholders" discipline forbids verbatim duplication of a logic block,
and a reviewer would flag it; extracting costs one small file and one edit to
an existing spec. — Cost if wrong: if the extraction destabilises
`enrollment.spec.ts`, the fallback is to leave that spec untouched and keep
the helpers local to the new spec — a revert of one file.

Ruling 3: The e2e suites share one `email_deliveries` table, and
`enrollment.spec.ts` asserts the retry page's global empty state
("Everything has been delivered."). The new announcements spec leaves
announcement and cancellation rows behind. This is accepted as-is: fresh
`queued` rows are excluded from the retry list until they are fifteen minutes
old, and everything the capture transport sends reaches `sent`, so the empty
state should hold whichever order the files run in. — Why: adding
cross-suite cleanup now would be speculative. — Cost if wrong: an
order-dependent flake in `enrollment.spec.ts`; the fix is to scope that
assertion to its own rows, never to weaken it.

## Progress

Task 1: implemented (commit a31ed22, DONE, no concerns) — migration 0006 additive; 161 tests pass, typecheck + build clean. Task review dispatched.

Ruling 4: Task 2's implementer is dispatched in parallel with Task 1's task
review. The skill forbids parallel *implementers* because they conflict in the
working tree and in the shared, truncating test database; a reviewer is
read-only and runs no suite, so it conflicts with neither. — Why: the review
and the next implementation are independent, and serialising them doubles the
wall-clock cost of every task for no safety gained. — Cost if wrong: if the
Task 1 review returns findings, the fix-round diff range will also contain
Task 2's commits, so the scoped re-review must be taken per-path
(db/schema, drizzle, tests/integration/announcements-schema.test.ts) rather
than by commit range. That is bookkeeping, not rework.

Task 1: review clean — spec ✅, quality Approved, zero findings.
Task 1: ⚠️ resolved — reviewer could not verify from the diff that the
migration actually applied or that the suite passed. Journal check confirms
`0006_needy_whistler` is registered at idx 6 in `drizzle/meta/_journal.json`,
and the suite result is re-verified by Task 2's own full sweep, which runs
`npm test` across every file including
`tests/integration/announcements-schema.test.ts`. Not a gap.
Task 1: complete (commits f4b7208..a31ed22, review clean)

Ruling 4 amendment: the controller must not run `npm test` either while an
implementer is live — the harness truncates the shared test database between
tests, so a controller-run suite would corrupt a running implementer's
fixtures exactly as a second implementer would. Verification that needs the
database waits for a quiet moment or rides on the next implementer's sweep.

Task 2: implemented (commit 04a506b, DONE, no concerns) — 167 tests / 32 files
pass, typecheck + build clean. That sweep also re-ran Task 1's integration
tests, which closes Task 1's ⚠️ for good. Task 2 review dispatched; Task 3
implementer dispatched alongside it.

### Pre-verification done while implementers ran (controller, read-only)

All ten names later tasks import exist with the right casing:
`announcements`, `announcementAudienceEnum`, `announcementStatusEnum`,
`Announcement`, `AnnouncementAudience`, `AnnouncementStatus`,
`user.broadcastOptedOutAt`, `signUnsubscribeToken`, `verifyUnsubscribeToken`,
`unsubscribeUrl`, `unsubscribePostUrl`.

Library APIs the plan assumes, checked against the installed versions:
- `z.uuid()` and `z.url()` exist (zod 4 top-level style, matching `lib/env.ts`).
- `count()` and `exists()` are exported by drizzle-orm 0.45.
- Task 8's `announcementInputSchema` — the `.transform().refine()` ordering —
  was executed directly against installed zod: all four cases its tests assert
  behave exactly as planned ('all' nulls the class id, 'class_offering' without
  an id fails with "Choose which class this is for.", 'all' with a stray id
  nulls it, a blank title fails with its own message).
- `formatIsoDate`'s Intl call produces exactly "Monday, 12 October 2026" on
  this machine's Node 24 with full ICU, which is what Task 3's tests assert.

Carry into Task 7's dispatch — Resend 6.20's real types, read from
`node_modules/resend/dist/index.d.mts`:
- `ErrorResponse` is `{ message: string; statusCode: number | null; name:
  RESEND_ERROR_CODE_KEY }`. `statusCode` is already typed, so the brief's
  `(error as { statusCode?: number }).statusCode` cast is unnecessary — read
  `error.statusCode` directly. `error.name` is non-nullable, so its `?? null`
  is dead code.
- `rate_limit_exceeded` IS a real `RESEND_ERROR_CODE_KEY`, so the name-based
  rate-limit check is sound and not a guess.
- `headers?: Record<string, string>` is accepted on the email options, so the
  `List-Unsubscribe` passthrough works as designed.

Ruling 5 (carry into Task 5's dispatch): `queueEnrollmentEmails` must be
refactored to delegate its INSERT to the new `queueDeliveries`, rather than
keeping its own copy of the same row-building loop. Its final step is exactly
`queueDeliveries` with a constant render — same `sourceType`/`category`
literals, same per-recipient row shape — so leaving both is duplication a
reviewer would rightly flag as Important, and the plan's Task 5 text simply
does not mention the existing function. — Why: the whole point of Task 5 is
to generalise 3a's queueing; generalising it and then not using it for the
case it was generalised from leaves the codebase worse than either choice
alone. — Cost if wrong: `queueEnrollmentEmails` is covered by
`tests/integration/email-queueing.test.ts` and
`tests/integration/enrollment-email-wiring.test.ts`, both of which must stay
green; if the refactor disturbs them, revert to the inline insert and accept
the duplication with a note.

Ruling 6 (carry into Task 4's dispatch): the brief builds `scope` in
`resolveAnnouncementAudience` as a ternary with an awaited async IIFE in one
branch. Implement the same logic as a plain `if`/`else` assigning to a `let`,
keeping the behaviour identical — both branches still resolve to a predicate
or to null, and null still means "no audience, not an error". — Why: the IIFE
reads as cleverness for its own sake in a function whose whole job is to be
obviously correct about who receives mail. — Cost if wrong: none; it is the
same logic either way, and the task's tests pin the behaviour.

Task 2: review clean — spec ✅, quality Approved. Reviewer checked the
cryptography specifically: the signature is over the raw user id and verify
recomputes it after decoding (so an id/signature cross-substitution between two
users is rejected), the length check precedes `timingSafeEqual`, and every
rejection path returns null rather than throwing.
Task 2: minor (deferred): `signUnsubscribeToken("")` mints a token that
`verifyUnsubscribeToken` then rejects — an untested asymmetry. Harmless today
because no caller passes an unvalidated id; flag to the final review.
Task 2: ⚠️ carried, not a gap — the reviewer could not confirm from the diff
that nothing client-side imports `lib/unsubscribe-token.ts` (it pulls in the
server-only `lib/env.ts`), because no consumer exists yet. Constraint to
enforce in Tasks 8 and 10: no `"use client"` module may import it. To be
verified before the final review with:
`grep -rl "unsubscribe-token" app components | xargs grep -l "use client"` —
which must return nothing.
Task 2: complete (commits a31ed22..04a506b, review clean, 1 minor deferred)

Ruling 7 (carry into Task 12's dispatch — plan defect): the e2e spec in the
plan clicks `getByRole("button", { name: "Add student" })`. No such button
exists. `app/portal/students/new/page.tsx:8` renders `StudentForm` with
`submitLabel="Save student"`, and `components/student-form.tsx:81` renders that
label. The selector must be **"Save student"**. — Why: the plan's author (me)
wrote the selector from memory instead of from the component. — Cost if wrong:
none; this is verified against the two files above. Left unfixed it would have
failed only at `npm run test:e2e`, the slowest feedback loop in the project.

Verified-good Task 12 selectors, checked against the live components so the
implementer does not have to: `getByLabel("First name" | "Last name" | "Date of
birth")` (`components/student-form.tsx:22,34,46`); `getByRole("button", { name:
"Request seat" })` (`components/enrollment-request-form.tsx:55`);
`getByRole("link", { name: className })` on `/admin/classes`, whose link text is
`{offering.name}` (`app/admin/classes/page.tsx:141-145`). The sign-up and
sign-in selectors are inherited from `e2e/enrollment.spec.ts`, which passes
today.

Ruling 8 (plan defect, already fixed in the plan and in the Task 8/10/12
briefs): the plan used a bare `className="btn"` in five places. This codebase
never uses `btn` alone — it is always `btn btn-solid` for a primary action or
`btn btn-ghost` for a secondary one (sign-in, sign-up, forbidden, admin-form,
enrollment-queue-actions, enrollment-request-form all follow this). All five
are now `btn btn-solid`, and the affected briefs were regenerated. — Why:
bare `btn` renders the unstyled base and would have looked wrong next to every
other button on the site. — Cost if wrong: cosmetic only, and reversible.

Also verified against the live stylesheet so implementers need not guess:
`barre`, `eyebrow`, `tabular`, `display`, `panel`, `btn`, `btn-solid`,
`btn-ghost`, `label`, `input`, `hint` all exist in `app/globals.css`, as do the
theme colors `chalk`, `mirror`, `maple`, `maple-deep`, `barre`, `alarm`.
`listPublishedOfferings(db, seasonId)` and `getSeason(db, seasonId)` match the
signatures Tasks 8 and 9 call them with.

Task 3: implemented (commit be6befc, DONE, no concerns) — 176 tests / 33 files
pass, typecheck + build clean. Correctly left the controller's concurrent plan
edits unstaged and committed only its own files.

Ruling 9 (plan defect, fixed and briefs 9/10 regenerated): the two new
full-page routes — `/announcements` and `/unsubscribe` — wrapped their content
in `<section>`. Every other page in this codebase opens with
`<main className="mx-auto max-w-… px-6 py-…">` (contact, schedule, forbidden),
and the public layout supplies no wrapper of its own, so a `<section>` root
would leave those two pages with no `<main>` landmark at all. Both are `<main>`
now, and the public one matches the `max-w-5xl px-6 py-20` the sibling public
pages use. — Why: an accessibility landmark and a layout inconsistency, both
invisible until someone tabs through the page. — Cost if wrong: cosmetic,
reversible.

Plan corrections committed as 8c2ec5f (Rulings 7, 8, 9 together).

Task 3: review clean — spec ✅, quality Approved, three Minors, no Critical or
Important. Reviewer traced the escaping path end to end and found no route by
which unescaped staff input reaches markup.
Task 3: minor (routed into Task 11, not deferred): `ClassOccurrenceEmailData`
declares `dayOfWeek` and never reads it — `formatIsoDate` already yields the
weekday. Confirmed dead by inspection (`lib/emails/class-occurrence.ts:12` vs
`whenLine`). Routed rather than deferred because Task 11's brief told its
implementer to SELECT that column from the database to feed it, so leaving it
would have spread the dead field into a query. Task 11 now deletes the field,
its `DayOfWeek` import, and the test fixture entry, and no longer selects it.
Task 3: minor (routed into Task 11): the "mentions no money" test asserts only
against `rendered.text`, never `rendered.html`; and no test exercises escaping
of the staff-written `reason`, which is free text landing in markup exactly as
the announcement body does. Task 11 adds both assertions.
Task 3: complete (commits 04a506b..be6befc, review clean, 3 minors routed)

Ruling 10: Task 3's three Minors are routed into Task 11 rather than deferred
to the final review. — Why: all three live in the cancellation template that
Task 11 is about to build on, and one of them would otherwise propagate into a
new database query. Fixing them in the task that owns the area costs nothing
extra; deferring them means a second pass over the same file. — Cost if wrong:
Task 11 grows by one small step; if it destabilises, the assertions can be
dropped and the dead field left in place, which is where it is today anyway.

Task 4: implemented (commit 1ea6139, DONE, no concerns) — 6 new audience tests
pass, full sweep 182 tests green, typecheck + build clean. Its parent is the
controller's docs commit 8c2ec5f, so its review range is 8c2ec5f..1ea6139.

Ruling 11 (plan polish, briefs 5 and 8 regenerated): the announcement detail
page formatted `emailedAt` with `toLocaleDateString("en-GB")`. Every other date
on this site goes through `formatIsoDate`, which is UTC-pinned; a bare
`toLocaleDateString` depends on the server's locale data and would read
differently from the date directly above it on the same page. Now
`formatIsoDate(emailedAt.toISOString().slice(0, 10))`, with the import widened.
— Why: one date format per site. — Cost if wrong: cosmetic.

Task 4: review — spec ✅; quality found ONE Important, and it is plan-mandated
(the test came verbatim from the plan I wrote).

Ruling 12: the Important finding is accepted, not contested. The reviewer is
right that `audience.test.ts`'s "narrows to one class" proves nothing: family B
is given a login but never enrolled anywhere, so it would be excluded whether
or not the query filtered by `classOfferingId`. The spec requires the class
audience to narrow to that class, and a test that cannot fail on a query
ignoring the predicate does not hold the spec up. — Why: this is the audience
path for live mail; a silently-wrong narrowing mails the wrong families and
nothing catches it. — Cost if wrong: a slightly longer test.
Plan and Task 4 brief corrected; committed separately. Fix goes to the Task 4
implementer as fix round 1.

Fix round for Task 4 is QUEUED, not dispatched: Task 5's implementer is live
and running full sweeps, and a Task 4 fix would also edit tests and run
`npm test` against the same truncating database. Two implementers, which is
the one thing Ruling 4 does not license. Dispatch it the moment Task 5 reports.

Task 5: implemented (commit f8f2740, DONE, no concerns) — 187/187 pass,
typecheck + build clean, and the two Phase 3a suites pass UNEDITED, which is
the evidence that the `queueEnrollmentEmails` refactor preserved behaviour.
Task 5 review dispatched (range 17ced07..f8f2740).
Task 4: fix round 1/5 dispatched to the original implementer (resumed) — one
Important finding, test-only, `tests/integration/audience.test.ts`. Held until
Task 5's implementer finished so two implementers were never running sweeps
against the truncating test database at once.

Note on ordering: controller docs commits are interleaved with task commits, so
each task's review range is (its parent .. its commit), read from `git log`,
never `HEAD~1`.

Task 4: fix round 1/5 applied (commit ff8c3e4) — 6/6 tests in
`tests/integration/audience.test.ts` pass; only the test file was staged, the
query module untouched. Scoped re-review dispatched over 624e322..ff8c3e4.
Task 6 implementer dispatched alongside it.

Task 5: review clean — spec ✅, quality Approved, zero findings. Reviewer
verified the refactored `queueEnrollmentEmails` writes byte-for-byte the same
rows, that the recipient mapping is not transposed, and that the per-recipient
render test would genuinely fail a render-once implementation.
Task 5: complete (commits 17ced07..f8f2740, review clean)

Task 4: fix round 1/5 re-reviewed — finding ADDRESSED
(`tests/integration/audience.test.ts`), no new breakage, only the test file
touched. A query ignoring `classOfferingId` would now fail both of the test's
assertions.
Task 4: complete (commits 8c2ec5f..1ea6139 plus fix ff8c3e4, review clean)

Ruling 11b (plan polish, brief 7 regenerated): Task 7's transport code cast
`statusCode` off an untyped shape and defaulted `name` to null, which read as
if both fields were undocumented guesses. They are documented: Resend 6.20's
`ErrorResponse` is `{ message: string; statusCode: number | null; name:
RESEND_ERROR_CODE_KEY }` and `rate_limit_exceeded` is a member of that union.
Both are now read directly, with the provenance in a comment. — Why: a cast
tells the next reader "we are not sure this exists", which would be false and
would invite someone to delete the rate-limit branch as speculative. — Cost if
wrong: a typecheck failure at Task 7, caught immediately by its own sweep.

Task 6: implemented (commit 57dd3da, DONE, no concerns) — 194/194 pass across
36 files, typecheck + build clean; dropped the unused `classOfferings` import
as directed. Review dispatched over 236eac8..57dd3da, pointed specifically at
the statement ordering inside `sendAnnouncement`'s transaction.
Task 7 implementer dispatched alongside it.

Task 6: review clean — spec ✅, quality Approved, zero findings. Reviewer traced
`sendAnnouncement`'s statement order and confirmed the conditional UPDATE
precedes both the audience resolution and the queueing, and reasoned it through
Postgres READ COMMITTED locking: the second concurrent transaction blocks on
the row lock, re-evaluates `emailed_at IS NULL` as false, affects zero rows, and
returns `already-emailed` having queued nothing.
Task 6: complete (commits 236eac8..57dd3da, review clean)

Ruling 13 (plan defect, found by controller, brief 8 regenerated): the
announcement panel took a single `remaining = queued + sending` and showed
"Send the rest" whenever it was non-zero. But that button runs
`listQueuedForSource`, which returns `queued` rows ONLY — by design, so a
resume never re-attempts an address the provider rejected. A row stranded in
`sending` would therefore have rendered a button that did nothing when
pressed, with no explanation. The panel now takes `queued` and `sending`
separately: both count toward the "still waiting" sentence, only `queued`
gates the button, and a mid-send row gets a line saying it will surface on the
Email page after fifteen minutes. — Why: a control that visibly does nothing
teaches staff the page is broken and is worse than no control. — Cost if
wrong: cosmetic and contained to one component.

Task 7: BLOCKED on first attempt, correctly. `tests/integration/
deliver-queued-failure.test.ts` (Phase 3a) mocks `@/lib/email` with a factory
that replaces the WHOLE module with a single `sendEmail` export. Task 7 makes
`deliverQueued` reference `EmailSendError` from that module; on the mock that
name is undefined, so `error instanceof EmailSendError` throws a TypeError,
which the outer bookkeeping catch swallows, leaving the row `sending` instead
of `failed` and failing the assertion. The implementer stopped rather than
editing a file its brief called a fixed contract — which is exactly what the
brief asked for, and is why the problem surfaced as a decision instead of a
silently rewritten 3a test.

Ruling 14: the mock is widened with `importOriginal` so it re-exports the real
module and overrides only `sendEmail`. Verified the mock myself at
`tests/integration/deliver-queued-failure.test.ts:4-11` before ruling. This
changes the mock's PLUMBING, not its contract: no assertion, fixture, or
behaviour under test moves. The mock was complete when `lib/email.ts` had one
export; the spec requires a second one, because the runner must tell a rate
limit from a rejected address. The mock keeps throwing a plain `Error` rather
than an `EmailSendError`, deliberately — that path must still mark the row
`failed` rather than be mistaken for a rate limit, and it is now the only test
covering it. — Cost if wrong: if widening the mock breaks an assertion, that
signals a real behaviour change rather than a plumbing problem, and the
implementer is instructed to stop again rather than push through.

Task 7: implemented after the ruling (commit 42a9aab, DONE, no concerns) —
`npm test` 38 files / 202 tests pass, typecheck + build clean (20 routes), and
the five targeted files 16/16. Mock widened exactly as ruled: `importOriginal`
spread, plain `Error` preserved, no assertions touched. Review dispatched over
920e1d7..42a9aab, told to verify the mock change was plumbing-only.
Task 8 implementer dispatched alongside it — the largest task in the plan.

Task 7: review — spec ✅; quality Approved with ONE Important, which the
reviewer explicitly declined to block on: nothing exercises the rate-limit
branch through `deliverQueued`, so `releaseToQueued` + `break` is verified by
inspection only.

Ruling 15: the Important finding is accepted and goes to the fix loop, despite
the reviewer waiving it. — Why: this is the branch that decides what a provider
hiccup does to a 150-family send. If it marks rows `failed` instead of
releasing them, every healthy address behind the hiccup lands on /admin/emails
to be retried by hand one at a time, and the only signal is a page full of
failures nobody can explain. "Short code path mirroring a tested one" is an
argument that it probably works, not evidence that it does — and a branch that
only runs when the provider misbehaves is precisely the one that never gets
exercised in manual testing either. Test written into the plan; brief 7
regenerated. — Cost if wrong: one extra integration file, ~90 seconds of
suite time.

Test design note (mine, from writing it): it counts sendEmail calls rather than
matching a recipient address, because `queueDeliveries` inserts every row in a
single statement so they share a `createdAt`, and `listQueuedForSource` breaks
that tie on a random uuid. "The second row sent" is deterministic; "the row for
u2@example.com" is not. The decisive assertion is that the two surviving queued
rows have attempts [0, 1] — one claimed and handed back, one never reached.

Task 7 fix round 1 QUEUED until Task 8's implementer reports (two implementers
must never run suites against the truncating test database at once).

Ruling 16 (plan defect, brief 12 regenerated): the e2e spec created a browser
context inline for the staff sign-up — `await signUp(await (await
browser.newContext()).newPage(), ...)` — and never closed it. A leaked context
lives for the rest of the run and can leave Playwright waiting at teardown.
Named and closed now, with a comment recording why two contexts are needed in
the first place: the session cookie carries the role, so the working context
must be signed in AFTER `promoteToStaff`. — Why: an e2e suite that intermittently
hangs at teardown is worse than one that fails, because nobody can tell whether
it is broken or slow. — Cost if wrong: none; the other three contexts in the
file already follow this pattern.

Further controller pre-verification, read-only, while Task 8 built:
- `/unsubscribe` sits outside the (public) route group, so it gets the bare
  root layout — which is correct, and `globals.css` styles `body` with
  `--color-floor` regardless, so the page is themed without the site chrome.
- The hand-written HTML in the `/api/unsubscribe` route handler uses `#14161a`
  and `#f2f0ec`; these are exactly `--color-floor` and `--color-chalk`, so the
  one-click confirmation matches the site rather than merely resembling it.
- `app/portal/actions.ts` already imports `revalidatePath` and `requireUser`,
  so Task 10 adds only the `setBroadcastOptOut` import, as its brief says.
- `Transaction` is exported from `db/queries/executor.ts`, which Task 11 needs.

Task 8: implemented (commit a0a5018, DONE_WITH_CONCERNS in substance) —
208/208 pass, typecheck clean, build succeeds with the three new routes.

Task 8 finding, raised BY the implementer against the brief: the
`announcementInputSchema` transform used `input.classOfferingId!`, which
leaves `undefined` when the field is absent, while the refine tests
`!== null` — which `undefined` passes. A class-audience announcement with no
class selected would have parsed cleanly, reached the insert, and been
rejected by the `announcements_audience_pairing` check constraint as a 500
rather than as "Choose which class this is for." Fixed with `?? null`.

CORRECTION TO MY OWN PRE-VERIFICATION: I "verified" this schema earlier in the
run by executing it under node and reported it sound. That check passed
because I retyped the refine as loose `!= null`, which catches `undefined`;
the plan text says strict `!==`. I validated a paraphrase, not the artifact.
Re-ran both variants side by side to confirm: plan-as-written accepts a
classless class announcement, shipped version rejects it. For the rest of this
run, pre-verification of plan code executes the plan's exact text, never a
retyping of it.

Plan corrected and brief 8 regenerated so the record matches what shipped.

Task 7: fix round 1/5 applied (commit 6e28256) — `deliver-rate-limit.test.ts`
added, 4 files / 9 tests pass, attempts on the two survivors are [0, 1],
`failed: 0`, `rateLimited: true`, `remaining: 2`. No implementation file
touched. Scoped re-review dispatched over 4b95c45..6e28256, asked specifically
whether deleting the `break` would fail the test.

Task 8: review clean — spec ✅, quality Approved, zero findings of any
severity. Reviewer traced `requireStaff()` as the first statement in all five
actions and all three pages, confirmed `updateAnnouncementAction` parses with
`announcementEditSchema`, confirmed the send panel gates on `queued > 0` alone
with a `sending`-only hint and no button, and confirmed every failure reason
from both query unions is turned into a sentence with no drift.
Task 8: complete (commits 08ac29e..a0a5018, review clean)

Task 2's carried ⚠️ is now RESOLVED, not merely carried: the reviewer traced
the import chain of both new client components, and I re-ran the check with
them present — `grep -rl "unsubscribe-token\|lib/env" app components | xargs
grep -l '"use client"'` returns nothing. `announcement-form.tsx` and
`announcement-send-panel.tsx` import only `react`, `@/lib/action-state` (which
itself imports nothing), and the `"use server"` actions module. No server-only
module reaches the browser bundle. Re-run this check once more before the final
review, since Task 10 adds another client component.

Task 7: fix round 1/5 re-reviewed — finding ADDRESSED. The re-reviewer
confirmed explicitly that deleting the `break` would fail the test: both
survivors would gain an attempt and `expect(queuedAttempts).toEqual([0, 1])`
would fail. That is the property that makes the test worth its runtime. No new
breakage; only the new test file touched.
Task 7: complete (commits 920e1d7..42a9aab plus fix 6e28256, review clean)

Precise facts for Task 11's dispatch, read from the current file rather than
assumed (this is Ruling 1 made concrete):
- `db/queries/class-occurrences.ts:1` imports `{ and, asc, eq, gte, lte }` from
  drizzle-orm. Only `inArray` is genuinely new — merge it into that line.
- Its schema import (lines 4-10) already names `classOccurrences`,
  `classOfferings`, `seasons`, `ClassOccurrence`, `ClassOffering`. Only
  `emailDeliveries` is new — merge it into that block.
- The module declares its own local `type Database = NodePgDatabase<typeof
  schema>` at line 13ish, which the global constraints say to leave alone, so
  `Transaction` must come from a new `import type { Transaction } from
  "./executor";`.
- `listRoster` exists at `db/queries/enrollments.ts:383`, which the admin class
  page already uses.

Task 12 selector pre-verification against SHIPPED Task 8 code (not against the
plan, which is how the "Add student" defect slipped through earlier):
- "Save draft" — `app/admin/announcements/new/page.tsx:23` ✓
- "Publish" — `components/announcement-send-panel.tsx:74` ✓
- "Send the email" — `announcement-send-panel.tsx:101` ✓
- "Send the rest" — `announcement-send-panel.tsx:124` ✓
- /Every message has gone out|still waiting/ — `:115-116` ✓
- /0 recipients|Nobody matches this audience/ — the panel renders
  `{recipientCount} recipients` at `:88` and the zero-alert at `:94`, so both
  alternatives of that regex exist ✓
- `getByLabel("Title")` / `getByLabel("Body")` — `components/announcement-form.tsx:39-52`
  wraps `<span class="label">Title</span>` plus the control inside a `<label>`,
  which Playwright resolves by implicit association ✓

Still unverifiable until Task 11 ships: the placeholder "Why? Families will
read this." and the button "Cancel this date". Both come from a component
Task 11 creates, so they will match if it follows its brief.

FOR THE FINAL REPORT TO JOHN (not a ruling, not in scope, do not act on it):
`README.md` still opens with "**Status:** Phase 1 complete" and its "Project
structure" section lists neither the announcement routes nor `/unsubscribe`.
It was already stale before this branch — Phase 2 and Phase 3a shipped without
updating it — and this branch makes it staler. John was offered "Refresh README
+ docs" as a work item at the start of the session and chose Phase 3b design
instead, so updating it here would be scope he declined. Raise it as a
recommendation when the branch is finished, not as a commit on it.

Tally at eight tasks closed: 17 distinct rulings, exactly one deferred minor
(Task 2's empty-userId token asymmetry). The count is low because Task 3's
three minors were ROUTED into Task 11 rather than deferred — they lived in the
file Task 11 was about to build on, and one of them would otherwise have
spread a dead field into a new database query.

Precise facts for Task 12's dispatch, read from the current files:
- `e2e/fixtures/seed.ts:1` imports `{ asc, desc, eq, like }` from drizzle-orm —
  only `and` is new. Its schema import (lines 8-15) already names
  `classOfferings`, `emailDeliveries`, `enrollments`, `seasons`, `students`,
  `user` — only `announcements` is new. Merge both, do not add second imports.
- Existing e2e coverage is 8 scenarios (4 in `enrollment.spec.ts`, 4 in
  `registration.spec.ts`). Task 12 adds 5, so a green run is 13.

Ruling 2 refined, now that I have checked both specs: the `signUp`/`signIn`
extraction touches `e2e/enrollment.spec.ts` ONLY. `registration.spec.ts` has no
such helpers — it is the suite that *tests* signing up and signing in, so it
drives those forms directly and must keep doing so. A helper that abstracts the
flow under test would hollow it out. So: create `e2e/fixtures/auth.ts`, have
`enrollment.spec.ts` and the new `announcements.spec.ts` import from it, and
leave `registration.spec.ts` alone.

Task 9: review clean — spec ✅, quality Approved, zero findings. Reviewer
confirmed the public page calls `listPublicAnnouncements` (which enforces
`audienceType = 'all'` in SQL) and added NO redundant page-level filter, which
is the point — a second filter in page code would signal the author did not
trust the query, and would be the thing that drifts. Also confirmed no
`dangerouslySetInnerHTML` anywhere and that the two pages deliberately differ
on a null `publishedAt` (public falls back to today, portal omits the line).
Task 9: ⚠️ x2 resolved — both were "the report claims the build listed the
routes and the sweep passed, which the diff cannot show". The diff contains
exactly one commit touching exactly the four expected files, consistent with
the claim, and Task 10's own full sweep re-runs build and suite over the same
tree. Not gaps.
Task 9: complete (commits 6e28256..a517c2c, review clean)

Ruling 17 (plan defect, brief 12 regenerated): the e2e scenario named
"cancelling a date still reaches the unsubscribed parent" asserted only that
the ADMIN page displayed "Cancelled — <reason>". It never checked that the
parent was told. It would have passed with the entire roster notification
broken, which is the single failure it exists to catch — the parent
unsubscribed in the previous scenario, and the whole point is that a
cancellation is transactional and reaches them regardless. It now polls
`deliveriesForSource("class_occurrence", ...)` for a row addressed to that
parent with template `class.cancelled` and status `sent`, and asserts the row
is categorised `transactional` with no "unsubscribe" text in either body part.
One seed helper added to find the cancelled occurrence by class name. — Why:
a test whose name claims more than its assertions is worse than no test, because
it is read as coverage. — Cost if wrong: if the poll proves flaky because
`after()` has not finished, the fix is a longer poll timeout, never dropping the
assertion.

Verified while waiting: the em dash in the component's `Cancelled{note ? ` —
${note}` : ""}` and the em dash in the e2e's expected string are the same
character (U+2014), so that assertion will match.

Ruling 3 UPGRADED from "should hold" to verified by trace. The concern was that
the new announcements spec leaves delivery rows behind and
`e2e/enrollment.spec.ts:120-121` asserts the retry page's GLOBAL empty state
("Everything has been delivered."). Traced it properly:
- Playwright runs files alphabetically, so the order is announcements.spec,
  enrollment.spec, registration.spec — the new spec runs FIRST, not last.
- `enrollment.spec`'s first scenario calls `seedOpenSeasonWithClass` with no
  `seasonId`, which takes the new-season branch and deletes BOTH the "E2E %"
  seasons and the whole `email_deliveries` table before it does anything else.
  So the announcements spec's rows are gone before the empty-state assertion is
  ever reached.
- `registration.spec.ts` touches neither the deliveries table nor that page.
- Deleting the E2E seasons also cascades away the announcements spec's
  offerings and occurrences, and `announcements.class_offering_id` cascades
  with them, so no orphan rows survive either.
This is safe but ORDER-DEPENDENT: it holds because the wiping spec runs after
the spec that dirties the table. If a future spec is added whose name sorts
after "enrollment" and which leaves failed or stuck rows behind, that assertion
breaks. The durable fix, if it ever bites, is to scope the assertion to its own
rows — not to weaken it, and not to reorder files by renaming them.

Traced the announcements spec's own internal ordering too: test 4 reads
`latestAnnouncementId()` BEFORE creating "Second notice" to get the first
announcement's unsubscribe link, then reads it again after publishing the
second. Correct as written. Single-recipient sends incur no pacing delay
either, since `deliverQueued` paces only after something has actually been
sent, so the polls should settle quickly.

Task 10: review clean — spec ✅, quality Approved, no Critical or Important.
Reviewer traced both routes by hand: the GET path is read-only, the write
exists only in POST, and the bad-token and unknown-account cases share one
branch, one literal string, and one status code — so the endpoint is not an
oracle. It also confirmed the idempotence test genuinely proves timestamp
preservation (an implementation that overwrote on every call would produce a
new Date after the intervening await and fail the `toEqual`), and that the
unknown-user test indirectly forces the existence-check fallback to exist.
Task 10: minor (deferred): no test covers `setBroadcastOptOut(db, "nobody",
false)` — unknown user opting back IN. Low risk; the false branch is an
unconditional update symmetric with the tested true branch. Flag to the final
review.
Task 10: complete (commits 10ad401..2c11798, review clean, 1 minor deferred)

Final-review prep: merge base is f4b7208; 23 commits on the branch so far.
E2E prerequisites checked ahead of Task 12 — neither port 3000 nor 3100 is
listening, so Playwright's webServer can start its own dev server on 3100.
(Next refuses a second dev server in one directory, and that failure reads as
an unrelated timeout, so it is worth knowing before the slowest task runs.)
The test database has been migrated continuously by every task's sweep, so the
cold-database caveat in the README does not apply here.

Deferred minors for the final review, complete list at eleven tasks:
1. Task 2 — `signUnsubscribeToken("")` mints a token `verifyUnsubscribeToken`
   rejects; untested asymmetry, no caller can reach it today.
2. Task 10 — no test for `setBroadcastOptOut(db, <unknown>, false)`.

Controller observation on Task 11's in-flight diff (NOT acted on — the
implementer was still running, and editing files under a live implementer is
how you corrupt a working tree): `app/admin/actions.ts` now imports from
`@/lib/notifications/deliver` TWICE — `deliverQueued` at line 7 and
`deliverBatchForSource` at line 37. It compiles and it is only untidy, but it
is the same class of thing Ruling 1 was about. Deliberately NOT flagged to the
task reviewer in advance: telling a reviewer what to find is pre-judging, and
the point of the review is that it looks independently. If the task review
misses it, it goes to the final whole-branch review as a deferred minor rather
than into a fix round of its own — a duplicate import does not justify a
round trip.

Working-tree hygiene checked before the final stretch:
- Task 11's uncommitted files are exactly the ones its brief names (six
  modified, two new) with nothing extra.
- `.superpowers/` is gitignored, so this workspace never pollutes the branch.
  So are `.env` and `.next/`.
- `AGENTS.md` is NOT modified — worth confirming explicitly, because `next dev`
  rewrites its agent block and the project instructions warn that removing it
  from a diff only re-creates the change.
- Branch shape at eleven tasks: 55 files, +5549/-74, weighted toward tests
  (9 integration files, 5 unit) over implementation, which is the ratio you
  want for a phase whose failure modes are all silent ones.

Task 11: implemented (commit 9e7a6e7, DONE, no concerns, no deviations
needed) — 220/220 pass, typecheck + build clean. Review dispatched over
2c11798..9e7a6e7, pointed at the restore logic and asked two falsification
questions: would the "restore before anything was sent" test still pass if the
delete were removed, and would the "restore after it went out" test still pass
if `sending` rows were excluded from the recipient set. Those two questions are
the difference between tests that describe the behaviour and tests that pin it.

Task 12 (final task) dispatched. Carries Ruling 2's refinement (extract the auth
helpers, leave registration.spec alone), Ruling 17's strengthened final
assertion, the verified selectors, and the exact import facts for seed.ts.
Told explicitly: a failing e2e is information about the eleven tasks
underneath it — diagnose and report, never loosen an assertion to get green.

Task 11: review — spec ✅; quality found ONE Important and one Minor.

Ruling 18: the Important finding is accepted and goes to the fix loop. The
`sent`-vs-`sending` split in `restoreOccurrence` is untested: the suite only
ever calls `markSent`, so `inArray(..., ["sent", "sending"])` at
`db/queries/class-occurrences.ts:254` could be narrowed to `["sent"]` and every
test would still pass. This is the branch that decides what happens to a
recipient whose cancellation was with the provider at the moment staff
un-cancelled: exclude them and they are never told the class is back on, so
they stay home from a class that is running — the precise harm the restore
exists to prevent. The reviewer confirmed the OTHER half is genuinely pinned
(remove the `DELETE ... status = 'queued'` and the "restore before anything was
sent" test fails on a length assertion), which is what makes the gap worth
closing rather than assumed. — Cost if wrong: one more case in an existing
integration file.

Task 11: minor (deferred): some lines in `class-occurrences.ts` (e.g. 282, 380)
exceed the file's usual ~100-column wrapping. Cosmetic.

CONTROLLER FINDING THE TASK REVIEW MISSED: `app/admin/actions.ts` imports from
`@/lib/notifications/deliver` twice — `deliverQueued` at line 7,
`deliverBatchForSource` at line 37. I recorded this from the in-flight diff
before the review ran and deliberately did not point the reviewer at it; the
review then reported "no other issues found in app/admin/actions.ts", so the
independent read missed it. Confirmed still present in the committed file.
Folding it into the Task 11 fix round rather than opening a round of its own —
one dispatch, two trivial changes.

Both QUEUED until Task 12 reports: that task runs the e2e suite against the
same TEST_DATABASE_URL, and a fix round's `npm test` would truncate the
database mid-run.

Independent structural audit of the transactional/broadcast split (controller,
read-only — not a re-run of any test):
- `wrapBroadcastHtml` and `broadcastTextFooter` are called from exactly ONE
  place in the whole codebase: `lib/emails/announcement.ts` (lines 2, 6, 32,
  35). Nothing else can emit the footer, so the separation is structural rather
  than merely asserted.
- The only occurrence of the word "unsubscribe" in
  `lib/emails/class-occurrence.ts` is at line 23, inside the comment explaining
  that these messages carry none. Nothing reaches a rendered body.
- `lib/emails/enrollment.ts` (Phase 3a) contains no occurrence at all, so the
  three enrollment templates are untouched by this phase's footer work.
This closes two checklist lines ahead of the final sweep: "no email in this
phase contains an unsubscribe link except broadcast", and "transactional mail
carries neither header nor link".

Ruling 19 (gap found by the controller walking the plan's OWN completion
checklist, brief 6 regenerated): the checklist line "a family with two logins
gets two rows, each with its own unsubscribe link" was never tested. The
announcements integration suite seeds exactly one login, so its only
unsubscribe assertion is that a link is present
(`tests/integration/announcements.test.ts:123`).

The per-recipient render mechanism IS tested generically in
`queue-deliveries.test.ts`, and Task 6's reviewer confirmed by inspection that
`sendAnnouncement` passes a callback rather than a value — but the composition
was never pinned. If it ever regressed to passing a pre-rendered message, both
parents on a family would share one unsubscribe token, so either parent's click
would silently unsubscribe the other. Two families would never notice; the
studio would see its list shrinking for no reason.

New case added to Task 6's suite: two logins on one family, assert the two
tokens differ AND that each verifies back to its own user id. — Cost if wrong:
one more integration case.

This is the third coverage gap of the run in the same shape — a branch or
composition whose failure is silent and whose only symptom is mail going to the
wrong people (the others being Task 7's rate-limit release and Task 11's
in-flight restore). Worth noting as a pattern for the final review: in this
phase, "the code is obviously right" and "the test would fail if it weren't"
came apart three times.

Folded into the queued Task 11 fix round, which now carries three changes:
the `sending` restore test, this two-login test, and the duplicate
`@/lib/notifications/deliver` import in `app/admin/actions.ts`.

Ruling 20 (FOURTH gap of the same shape, found walking the checklist): the
checklist line "visiting an unsubscribe link does NOT opt anyone out; pressing
the button does" was only half-tested. The e2e visited the link and then
clicked the button, so it would have passed identically against a page that
opted the parent out on load — the exact failure the page/route split exists to
prevent, and the one with the worst blast radius in this phase: corporate mail
scanners follow every link in every message, so a GET that unsubscribes
unsubscribes families who never clicked, silently, at scale.

Now asserts the column is still false between `page.goto(link)` and the click,
and true after. Adds an `isBroadcastOptedOut(email)` seed helper reading the
column directly rather than inferring state from a later send — inference would
not distinguish "not opted out" from "opted out but the next send had no
recipients anyway".

NOT dispatchable as part of Task 12's current run: that implementer is live and
already working from the brief as it was. This becomes Task 12's fix round
after its review, which is the correct sequencing anyway.

Pattern now four for four. Every coverage gap this run has been a place where
the implementation was correct and the test could not have detected it being
wrong, and in every case the production symptom is silent mail misdelivery:
- Task 7: rate limit marks healthy addresses failed instead of releasing them.
- Task 11: a family mid-send is never told their class is back on.
- Task 6: two parents share one unsubscribe token, so each can opt the other out.
- Task 12: a link scanner unsubscribes families who never clicked.
The final review should be told this explicitly — it is the shape of defect
this phase is prone to, and the place to look for a fifth.

PUSHED TO GITHUB at John's explicit request:
- `phase-3b-announcements` → new remote branch, 27 commits. Local and remote
  now 0/0.
- `main` → fast-forwarded ba2d8cb..f4b7208, carrying the two Phase 3b doc
  commits (the design spec and the implementation plan) that were committed to
  main before the branch was cut and never pushed. `origin/main` was an
  ancestor, so no force and no rewrite. This matches the project's own
  convention: Phase 3a's design and plan also went to main ahead of the feature
  PR.
- NOT pushed: Task 12's four in-progress files (`e2e/announcements.spec.ts`,
  `e2e/fixtures/auth.ts`, and modifications to `e2e/enrollment.spec.ts` and
  `e2e/fixtures/seed.ts`). Its implementer is live and will commit them itself;
  committing another agent's half-written files is how you capture a file
  mid-save.
- NOTHING was merged. The branch is pushed, not integrated; no PR opened.

================================================================
STOPPED AT JOHN'S REQUEST — SUPERSEDED by the 2026-10-09 entry below
================================================================

State of the world when we stopped:
- Tasks 1-11 are implemented, reviewed, and COMPLETE. Task 12 is not.
- `main` and `phase-3b-announcements` are both identical to GitHub (0/0).
  27 commits on the branch. Nothing merged, no PR opened.
- Nothing is listening on port 3100 — the e2e dev server shut down cleanly when
  its agent was stopped, so there is no orphaned process to kill tonight.

Task 12 was STOPPED mid-verification, not failed. Its last output was "Now the
e2e suite, which should run against a clean database", so it had finished
`npm test`, typecheck and build, and was about to start Playwright. Its work is
written and STAGED BUT NOT COMMITTED:
    A   e2e/announcements.spec.ts
    A   e2e/fixtures/auth.ts
    M   e2e/fixtures/seed.ts
    MM  e2e/enrollment.spec.ts   (staged, plus a later unstaged edit)
Left uncommitted deliberately: the e2e suite never ran, so nothing about these
files is verified. Do not commit them on faith.

================================================================
2026-10-09 — TASK 12 COMPLETE — RESUME HERE
================================================================

Task 12 was finished directly in the main session rather than re-dispatched:
the spec files already existed, the code was written, and the remaining work
was reading and running rather than writing — so a subagent would have paid a
cold-start to re-derive context the session already had.

The stopped run's files turned out to be sound. They matched the brief and had
already closed two of the brief's own gaps: the brief's spec called
`cancelledOccurrenceIdFor` without importing it, and it inlined `signUp`/
`signIn` instead of sharing them. All five announcement scenarios passed on
the first run. The only unstaged edit was four leftover `// DEBUG` console
logs in `enrollment.spec.ts`, discarded via `git checkout --` (the staged
version was already the clean one).

Committed as `f434e2c` — "test: cover announcements and unsubscribe end to
end", 4 files, +251/-24. PUSHED to `origin/phase-3b-announcements` at John's
request. `f434e2c` is the branch's 28th commit; this progress entry is the
29th. Still nothing merged, no PR opened.

VERIFIED, by running each command and reading the output:
    npm test        220 tests / 42 files   pass
    npm run typecheck                      pass
    npm run build                          pass
    npm run test:e2e   13/13, run TWICE back to back
    every provider_message_id starts with "capture-" — nothing reached Resend

The e2e suite was run twice deliberately. One green run cannot prove the
accumulation fix below, because the first run is the one that leaves the rows
the second run trips over.

TWO REAL DEFECTS surfaced by running the new spec beside the old one. Both
were in the tests, not the feature code, and neither was introduced by Task
12 — the new spec only perturbed timing and shared state enough to expose
them:

1. A RACE in `enrollment.spec.ts`. It navigated to `/portal/enrollments`
   immediately after clicking "Request seat". That form is a client component
   using `useActionState` with no success message — only `state.error`
   renders — so `.click()` resolves before the action commits. The
   server-rendered enrollments page could win the race, render "No class
   requests yet.", and never re-fetch, which no `toBeVisible` timeout can
   recover from. It now waits for the card's seat count to drop first, the
   same "wait for the signal that only appears on success" pattern
   `fixtures/auth.ts` already documents for sign-in.

   Worth recording HOW this was found, because the obvious read was wrong.
   The test passed alone and failed whenever any spec ran before it, which
   looks exactly like state pollution from the new spec. It is not. What
   settled it was querying the test database at the moment of failure and
   finding the enrollment row sitting there as `pending`: the write had
   happened, the page had merely rendered too early. Had the diagnosis stopped
   at "the new spec pollutes shared state", the fix would have been to the
   wrong file.

2. ACCUMULATION across runs. `seedOpenSeasonWithClass` cleared seasons and
   deliveries but not announcements. Studio-wide announcements carry no
   `classOfferingId`, so the season cascade never reached them; by the third
   run the public page's `getByRole("heading", {name: "Recital tickets"})`
   matched three elements. Now cleared in the same branch, for the same reason
   as the deliveries above. `email_deliveries.source_id` has no FK to
   `announcements`, so the delete order between them does not matter.

A FIFTH INSTANCE OF THE FOUR-FOR-FOUR PATTERN, for the final review:
`e2e/announcements.spec.ts:44` waits with

    await expect(page.getByText(/seat is held|request/i).first()).toBeVisible();

and `/request/i` matches the button's own label, "Request seat". The assertion
is satisfied before the action does anything. The scenario still passes
honestly, because the next scenario's `expect.poll` over delivery rows would
catch a missing enrollment — but this line proves nothing on its own, and it
is the same shape as the other four: a test that could not detect the thing it
names being wrong. The log predicted a fifth would turn up. This is it.

TO RESUME, in this order (steps renumbered; old step 1 is done):

1. Review Task 12 — the diff is `d22031c..f434e2c`. Base is `d22031c`, which
   is `f434e2c`'s parent; do not use HEAD~1 blindly.
2. Task 11 fix round — ONE dispatch, three items:
   a. the untested `sending` branch in `restoreOccurrence` (test is already
      written into `task-11-brief.md` Step 4-ish, and into the plan);
   b. the two-parents-two-tokens test (already in `task-6-brief.md`);
   c. the duplicate `@/lib/notifications/deliver` import in
      `app/admin/actions.ts` lines 7 and 37 — merge into one statement.
3. Task 12 fix round — the "visiting the link opts nobody out" assertion plus
   the `isBroadcastOptedOut` seed helper (already in `task-12-brief.md`).
   Confirmed on 2026-10-09 that `isBroadcastOptedOut` does not exist anywhere
   in `e2e/`, `lib/` or `db/` yet; it still has to be written.
4. Final whole-branch review over `f4b7208..HEAD` on the most capable model.
   Point it at the deferred minors below, at the four-for-four pattern, AND at
   the fifth instance above.
5. Then `superpowers:finishing-a-development-branch`.

Deferred minors for the final review (unchanged):
1. Task 2 — `signUnsubscribeToken("")` mints a token `verifyUnsubscribeToken`
   rejects; untested asymmetry, unreachable by any current caller.
2. Task 10 — no test for `setBroadcastOptOut(db, <unknown user>, false)`.
3. Task 11 — a few lines in `class-occurrences.ts` exceed the file's usual
   ~100-column wrapping. Cosmetic.

Environment notes for the next session:
- `psql` is not on PATH on this machine. The provider check in
  `task-12-brief.md` Step 4 is written as a psql command; run it as a small
  node script against `TEST_DATABASE_URL` instead, or the step reads as a
  failure when it is only a missing binary.
- Postgres listens on 5432; the e2e dev server uses port 3100 and shuts down
  cleanly with the run. Playwright's `webServer` sets `EMAIL_TRANSPORT=capture`
  and points `DATABASE_URL` at `TEST_DATABASE_URL`, which is why no test can
  reach Resend.

Still not in scope, raise to John at the end: `README.md` says "Phase 1
complete" and lists none of the new routes. He was offered a README refresh at
the start of the session and chose Phase 3b instead; he was reminded again on
2026-10-09 and has not asked for it yet.
