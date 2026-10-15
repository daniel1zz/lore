---
id: BASE-028
type: baseline
role: intent
title: "Start a session"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-027
links:
  - {id: SPEC-095, type: supersedes}
---
## Start a session

> A session that has just opened learns where the corpus stands, without being told what to work on.

Scope: the session start snapshot, its compact automatic injection, the seat-scoped resume pointer, and the seat briefing a session in a linked working copy receives at start. Resuming itself is "Resume a session".

### Behaviour

**Command.** A session (usually the session-start hook on its behalf) asks for the snapshot, optionally naming who it is and the seat it sits on (its branch and its directory), in full or in compact form.

**Constraint.** None refuses it; only a storage failure fails it (BR-332). The full snapshot's content opens with the product's root. The compact form is handed over only to a session sitting in a seat that has open items — unfinished claims recorded for the seat, by its branch or its directory, or, when the branch names a plan, that plan's newest handoff — and then first states that it holds only those items (BR-329); a main-checkout session, or a seat with none, is handed nothing, and corpus-wide state is always asked for, never handed over (BR-328). On an empty corpus there is no root and every list is empty, and the snapshot still succeeds (BR-322). When a baseline root exists, that baseline root is the root, and the full snapshot names the strategy document (the first requirements document) on a separate line; the compact form carries no root. With no baseline root, the first requirements document is the root and no strategy line appears (BR-981, BR-321). The compact form fits a size budget, delivered whole and marked when over it (BR-328), and leaves out the resume pointer unless the session sits in a seat that names a plan (BR-326). A seat branch is matched against every plan, closed ones included (BR-1003).

**Seat briefing.** Separately from the snapshot, the session-start resume hook (`assets/hooks/session-start-resume.mjs`) adds a seat block when the session opens in a linked working copy of a lore project (its main checkout holds `.lore`). The block names the session's actor `agent:<branch>` and the main checkout's path. A main-checkout session gets no seat block. If the briefing cannot be obtained, the start still exits 0, with no seat block and one notice on the error stream (BR-1019).

**Event.** None recorded; both the snapshot and the seat briefing are reads (BR-323).

### Terms used here

- **Session start snapshot**, **start-of-session injection**, **active session**, **stale**, **seat**: defined in the branch glossary.
- **Baseline root**: a root node of the baseline tree, placed directly under the requirements document. When several exist, the one created first is used.
- **Strategy document**: the first-created requirements document; it was the root before the baseline tree existed.

### Boundary notes

- The claims and sessions shown are derived from execution's claims; this leaf adds nothing to how they are made.
- The armed gates shown are read from autonomy ("Check a gate before writing"); this leaf only lists them.
- Which document is the baseline root is decided once for the whole product and shared with "Browse the document tree" (BR-982), so session start and the tree always agree.
- The newest-handoff list and resume pointer read the same handoffs as "Resume a session", but filter them differently (BR-325 against BR-354).
- The memory-file health line belongs to the context branch.
- The seat block (BR-1019) is composed by the session-start resume hook, not by the fragments answer of context, "Inject context at start"; it never shares that answer's 10,000-character limit. The hook script and its registration are distribution's; this leaf owns the briefing the session receives. The same hook passes the seat branch to the snapshot request, which is how the seat scopes the resume pointer (BR-326).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Claim time limit after which a session is marked stale (owned by execution, "Claim a task"; only read here) | 120 minutes | project settings maintainer | 2026-10-09 |
| Size budget of the compact injection | 8,000 characters | project settings maintainer | 2026-10-09 |
| Waiting documents named in the full snapshot | 10 | fixed | 2026-10-09 |
| Seat actor name | the branch lowercased, every character outside a-z, 0-9 and hyphen turned into a hyphen, runs collapsed, edge hyphens trimmed; a detached head becomes `worktree-<short commit>` (session-start-resume.mjs:214-240) | fixed in the hook | 2026-10-10 |
| Seat briefing source | `lore governance --seat-briefing`, run in the main checkout (session-start-resume.mjs:253); template `assets/governance/seat-briefing.md`, 2,673 bytes | distribution (the template) | 2026-10-10 |
| Resume hook answer size | no overall limit; a 12,000-character backstop on the bootstrap part only (session-start-resume.mjs:127, :332) | fixed in the hook | 2026-10-10 |

### Depends on

- execution, "Claim a task": the claims the sessions and own claims are derived from, and the claim time limit.
- autonomy, "Check a gate before writing": the gates listed as armed.
- Product baseline: the baseline root shown as the product's root.
- Hand off a session: the handoffs listed.
- distribution: the session-start resume hook that delivers the seat block, and the seat briefing template.
- review, "List documents awaiting review": the queue the waiting count is meant to match.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The waiting count counts every draft, including tasks and ledger records the review queue hides. Should it match the queue? | unconfirmed | product, engineering |
| Q2 | Archived tasks keep their claim, so they stay among the caller's claims and count as claimed. Should archiving clear the claim, or the snapshot ignore archived tasks? | unconfirmed | engineering |
| Q3 | A seat branch is matched against every plan, closed ones included (BR-1003). Should a closed plan's seat still scope the resume pointer? | undecided | product |
| Q4 | An architecture root counts as a baseline root when choosing the product's root, so one created before the business root would be shown instead of it (BR-321, issue 122). Should only the business root qualify? | unconfirmed | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-10 (commit 70f2785d), but no live check-decided criterion names a test that would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-321 | unconfirmed | established | Q4. It also lost its only citation in the 2026-10-09 citation audit (an independent fidelity judge found the citing criterion did not assert it); it waits for a criterion whose test fails if it is false. |
| BR-324 | observed | established | No question about intent. Measured in code: the snapshot's active sessions are derived over every claimed task corpus-wide, not scoped to open plans (packages/lore/src/service/session-service.ts:45-54, :990-1000), and a claim older than the time limit is flagged stale, not dropped (session-service.ts:416). No criterion cites it yet; waiting for a check-decided criterion that fails if this is false. |
| BR-330 | unconfirmed | undecided | Q1: should the snapshot's waiting count be the review queue's count? |
| BR-331 | unconfirmed | undecided | Q2: should archiving clear the claim, or should the snapshot leave archived tasks out of claims and claimed counts? |
| BR-332 | observed | established | No question about intent. Measured in code: when the snapshot read fails, the command writes only the error to the error stream and sets the exit code from it (packages/lore/src/adapters/cli/commands/bootstrap.ts:255-258), and a storage error maps to exit 1 (packages/lore/src/adapters/cli/utils.ts:146). No criterion cites it yet; waiting for a check-decided criterion that fails if this is false. |
| BR-1003 | undecided | undecided | Q3: should a closed plan's seat still scope the resume pointer? |
| BR-1019 | observed | established | No question about intent or ownership (it moved here from context, "Inject context at start", on 2026-10-10). Measured in code: the seat block is composed by `assets/hooks/session-start-resume.mjs` (actor derivation with `.toLowerCase()` and the detached-head `worktree-<short commit>` name; briefing run in the main checkout, :253). Cited by AC-047-B (check-decided; `packages/lore/tests/unit/hooks/session-seat-injection.test.ts`) and AC-047-D (human spot check). That test fails if any clause of the rule is false, including lowercasing: its golden-fixture block runs the hook on `Feature_ABC` and `UPPER-MIX_case` from `packages/lore/tests/fixtures/seat-branch-sanitize.golden.json`. But AC-047-B's only runner-attested pass (2026-07-16) predates those upper-case cases (added 2026-07-19, commit eb79573f), so no recorded pass confirms the lowercasing clause. A rerun on 2026-10-11 passed (21 tests) but is not recorded as evidence. Established waits for a runner-recorded pass of AC-047-B newer than eb79573f; it cannot be recorded through the criterion's archived task (`task-implement-seat-briefing-asset-worktree-aware-hook-injection`), because that task declares no ac_scope and `lore verify` refuses it. |
