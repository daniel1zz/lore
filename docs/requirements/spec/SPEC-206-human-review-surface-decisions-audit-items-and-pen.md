---
id: SPEC-206
type: spec
role: spec
title: "Human review surface: decisions, audit items and pending reviews readable on the dashboard; lore decide links to the detail"
status: approved
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: []
---
## Overview/Goal

What the human is asked to look at must be readable by a person without decoding hashes. Today `lore decide` shows only `governance-loosen autonomy-thresholds: … (<sha256>), score 0`; decision 157's record holds `facts = {}`, all factors 0 and one generic reason, so even a detail page would have nothing to show. The dashboard (the project's existing human UI) has no view of autonomy decisions or audit items at all.

End state: every decision that reaches the human carries a plain-language detail recorded at the moment it is decided; the dashboard shows one "Needs you" surface listing open decisions, audit items and documents awaiting review, each with a detail page; `lore decide` and `lore pending` print a link to the item's detail page. Answering stays in the terminal (`lore decide`, the human channel of spec-autonomy-phase-1-decision-function-human-channel-lore): the dashboard is read-only for decisions, because an agent can call HTTP and a web answer would be forgeable.

User decisions (2026-10-19): read details on the web, answer in the terminal; the first version covers open decisions, audit items and documents awaiting review.

## Scope

D1 — Decision detail. Every decision record carries a `detail`: `summary` (one plain sentence of what is asked), `requested_by` (actor and run, or "lore" for lore-initiated cleanup), `change` (class-specific: governance-loosen records the governed record's value before and after; worktree-remove the paths that blocked removal; stash-drop the attribution reason; run-end-stale / process-reap the run and pid list; override-judgment / override-attestation / ac-exempt / verify-new-command the document and the refused judgment or command), `on_accept` and `on_reject` (what each answer does). The detail is part of the hash-chained payload (tamper-evident like every other field). Rows written before this spec render the honest label "no detail recorded (decided before detail existed)", never a blank.

D2 — Read-only routes. `GET /api/decisions` (open decisions), `GET /api/decisions/:id` (one decision with detail, factors by name, recommendation, and the answer command; it serves an open decision and an audit item alike, since an audit item is a decision-log row, and says which it is), `GET /api/audit-items`. Cookie and bearer auth like the other GET routes. Reading appends nothing to the decision log: the routes use a pure derivation, never `listPending()`'s stale-close append. No route or tool path contains `decide` (AC-AU-3 (4) unchanged).

D3 — Dashboard "Needs you". Route `/needs-you` plus its project-scoped mirror; three sections (open decisions, audit items, documents awaiting review, the last reusing the existing review queue data) each with its count; one detail page `/needs-you/decisions/<id>` serves both open decisions and audit items and shows the D1 detail, the named factors, the recommendation and the exact terminal command `lore decide <id> --accept|--reject`. No element writes to any decision endpoint.

D4 — Server registry. `lore dashboard` and `lore serve` record their live URL for the corpus they serve at start and remove it at stop; a reader treats a record whose pid is not alive as absent and says so. No reader assumes a port.

D5 — Links. The `lore decide` confirmation (human-channel terminal) prints the D1 summary, before/after and on_accept / on_reject lines, then `Details: <url>/needs-you/decisions/<id>` when a live server for this corpus is registered, else `Details: start the dashboard with \`lore dashboard\`, then open /needs-you/decisions/<id>`. `lore pending`'s open-decision and audit rows print the same link form `/needs-you/decisions/<id>`. The terminal lines are labelled exactly `What: `, `Before: `, `After: `, `If you accept: `, `If you reject: `, `Details: ` (Before/After only when the class records them). The link never carries the nonce.

D6 — Deep links survive sign-in. `/auth/bootstrap` accepts a same-origin `next` path and redirects there after setting the session cookie; any other `next` redirects to `/`.

Out of scope: answering from the web; push notifications.

## Acceptance Criteria

Structured ACs AC-HR-1..AC-HR-7 (`lore ac list`).


## Acceptance Criteria (structured)

- [⚑] [script] AC-HR-1: EVERY ESCALATING PRODUCER RECORDS A READABLE DETAIL. For each of the classes governance-loosen, worktree-remove, stash-drop, run-end-stale, process-reap, override-judgment, override-attestation, ac-exempt and verify-new-command, driving its producer to an escalate verdict on a throwaway corpus writes a decision row whose detail has a non-empty summary, requested_by, on_accept and on_reject, plus the class-specific change fields of D1 (worktree-remove: the ignored paths that blocked removal, BR-1235). Each of summary, requested_by, on_accept and on_reject contains no run of 40 or more hex characters; the summary also contains the subject in words, asserted per class: governance-loosen the pattern or class edited; worktree-remove the worktree path; stash-drop the stash message; run-end-stale and process-reap the run id; the four override classes the document slug. governance-loosen's change carries the before AND after value of the edited governed entry (asserted exactly for a regenerable-pattern add: before lacks the pattern, after contains it). Falsifier: a producer that omits detail, or a summary that is a bare hash, turns the test red with the class named.
  script: test — bun run test:file packages/lore/tests/integration/decision-detail-producers.bun.test.ts && echo 'AC-HR-1 PASS: every escalating producer records a complete detail'
  other_command=4
- [⚑] [script] AC-HR-2: DETAIL IS TAMPER-EVIDENT AND HONEST FOR OLD ROWS. detail is part of the chained payload: rewriting a stored row's detail makes the decision-log chain verification fail naming that row (exact reason hash_mismatch); a row written before detail existed still verifies and renders exactly 'no detail recorded (decided before detail existed)' in the CLI renderer and the HTTP detail response, never an empty field.
  script: test — bun run test:file packages/lore/tests/integration/decision-detail-chain.bun.test.ts && echo 'AC-HR-2 PASS: detail is chained and old rows are labelled'
  other_command=2
- [⚑] [script] AC-HR-3: READ ROUTES ARE PURE AND AUTHENTICATED. GET /api/decisions, /api/decisions/:id and /api/audit-items return 401 with no credentials and 200 with a browser session or an agent key (BR-943); on a corpus holding a stale pending decision, calling all three leaves the decision_log row count and chain head unchanged (listPending's stale-close append is not reached); GET /api/decisions/:id for an unknown id returns 404; the AC-AU-3 (4) scan (no decide route or tool) still passes.
  script: test — bun run test:file packages/lore/tests/integration/decision-read-routes.bun.test.ts packages/lore/tests/integration/autonomy-human-channel.test.ts && echo 'AC-HR-3 PASS: decision read routes are pure and authenticated'
  other_command=2
- [⚑] [script] AC-HR-4: NEEDS-YOU PAGE SHOWS ALL THREE QUEUES READ-ONLY. With mocked API data the /needs-you page renders three sections (open decisions, audit items, documents awaiting review) each headed by its exact count, an empty section stays visible with its heading, count 0 and the exact text Nothing waiting for you here., and the project-scoped mirror route renders the same component; a decision detail page shows the detail summary, before/after, on_accept, on_reject, every factor by name, the recommendation and the exact text 'lore decide <id> --accept' and '--reject'; no rendered element issues a non-GET request (asserted by a fetch spy across clicks on every button).
  script: test — bun run test:file packages/dashboard/tests/component/NeedsYou.test.tsx && echo 'AC-HR-4 PASS: needs-you page renders three read-only queues'
  other_command=2
- [⚑] [script] AC-HR-5: LIVE SERVER IS DISCOVERABLE, NEVER ASSUMED. Starting lore dashboard on a throwaway corpus with an OS-assigned port records its URL for that corpus; the registry reader returns that URL; after the server stops (BR-869) the record is gone; a record whose pid is not alive is reported absent with a reason naming the dead pid. A scan of the registry reader module, decide-flow.ts, human-channel.ts and pending-decisions-render.ts finds no match of /:(8787|3456|5173)\b|localhost:\d/ (the link's host and port come only from the registry).
  script: test — bun run test:file packages/lore/tests/integration/dashboard-server-registry.bun.test.ts && echo 'AC-HR-5 PASS: live dashboard URL is registered and stale records are ignored'
  other_command=4
- [⚑] [script] AC-HR-6: LORE DECIDE AND LORE PENDING LINK TO THE DETAIL. Through injected human-channel ports, the lore decide confirmation for a governance-loosen pending decision prints, before the code, lines starting exactly 'What: ' (the summary), 'Before: ', 'After: ', 'If you accept: ', 'If you reject: ', then 'Details: <registered url>/needs-you/decisions/<id>' when a live server is registered, or 'Details: start the dashboard with `lore dashboard`, then open /needs-you/decisions/<id>' (no URL) when none is; the nonce never appears in the link; lore pending prints a 'Details:' link of the same form per open decision and per audit row.
  script: test — bun run test:file packages/lore/tests/integration/decide-detail-link.bun.test.ts && echo 'AC-HR-6 PASS: decide and pending print the detail link'
  other_command=2
- [⚑] [script] AC-HR-7: DEEP LINKS SURVIVE SIGN-IN (changes BR-862: the redirect target becomes the requested same-origin page instead of always the start page). GET /auth/bootstrap with a valid nonce and next=/needs-you/decisions/7 sets the session cookie and redirects 302 to exactly /needs-you/decisions/7; next set to an absolute URL, a protocol-relative //host path, or a path with a backslash redirects to exactly /.
  script: test — bun run test:file packages/lore/tests/integration/dashboard-bootstrap-next.bun.test.ts && echo 'AC-HR-7 PASS: bootstrap honours same-origin next only'
  other_command=3
