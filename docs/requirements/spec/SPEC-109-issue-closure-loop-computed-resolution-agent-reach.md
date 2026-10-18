---
id: SPEC-109
type: spec
role: spec
title: "Issue closure loop — computed resolution + agent-reachable visibility"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-10-17
tags: []
---
## Overview/Goal

Terminate the upstream issue feedback loop (§20 F6). Today a consumer-filed defect report lands as a `draft` ad-hoc task and then has **no edge that ends it** and **no CLI surface that shows it**. Measured on this corpus 2026-07-29 (10 filed reports, 9 open):

- `lore pending` → 0 of 9 (queue lists only `in-review`)
- `lore ready --adhoc` → 0 of 9 (blocked by §20 F3's own provenance pin)
- upstream-side list command → does not exist (`report-issue --list` is the consumer-side receipt reader)
- dashboard Issues page → the only surface, and it is a human surface

The upstream maintainer is an AI agent in a terminal, so the triage rhythm §20 F3 depends on is unreachable by the party expected to service it. Independently, the first defect ever fixed through this loop (`task-no-init-setup-path-provisions-feedback-upstream-lore`) shipped as SPEC-OOB + its plan — both `archived`, code released — while the issue task stayed `draft`, so `report-issue --list` still reports `draft` to the reporting project. Doc status was being used as a proxy for defect status; on the escalation path that proxy is provably wrong, and it misinforms the consumer — the single failure mode §20 exists to prevent.

Goal: resolution becomes a **computed** property derived from a typed `resolves` edge, plus an agent-reachable read surface and a deterministic detector. No hand-set `fixed` anywhere in the system.

## Scope

**In scope**

- D1 — `resolves` link type: `linkTypeSchema` gains an eighth member. `from` = the doc that fixes the defect (`spec` | `plan` | `task`), `to` = an issue task (a task carrying `extra.issue_report`). A `resolves` edge whose target lacks `extra.issue_report` is rejected at write time with a named `VALIDATION_ERROR`.
- D2 — computed resolution, a pure function of (in-edges, source doc statuses, explicit terminal state):
  - `open` — no `resolves` in-edge and no explicit terminal state
  - `resolving` — ≥1 `resolves` in-edge, no source doc at `active`/`archived`
  - `fixed` — ≥1 `resolves` in-edge whose source doc is `active` or `archived`
  - `closed` — the issue task's own status is `archived`, with no `resolves` in-edge and no explicit terminal state. Semantics: an upstream maintainer terminated it, but no traceable fix source was ever recorded. This is the shape of every report closed BEFORE this mechanism existed.
  - `rejected` / `wontfix` — explicit terminal state present (D3); these win over computation
  - `rejected` is ALSO reached without D3, via the review workflow: `ReviewService.reject` deliberately never transitions a doc off `draft` (SPEC-005 — the audit trail, not `doc.status`, is the sole record of a rejection), so a review-rejected report is indistinguishable from an untouched one by status alone. The computation MUST read the recorded rejection, which the upstream port already surfaces. Without this, §20 F3's "Reject → rejection reason recorded" and F4's "for rejections, the recorded reason" produce a self-contradicting row: resolution `open` carrying a rejection reason.
  - Precedence, highest first: explicit terminal state (D3) → `resolves`-edge computation → recorded review rejection (`rejected`) → `archived` doc status (`closed`) → `open`.
  - **Why `closed` is not optional** (measured 2026-07-29 on the live corpus, after D4 shipped): `task-spec-069-adhoc-tasks-are-unclaimable-task-claim-gate` was fixed and `archived` four days ago, yet `lore issues --open` listed it as `open` and `--resolved` was empty. That is the SAME proxy failure this spec removes, running in the opposite direction — a terminated defect reported as outstanding. A resolution model that reads only edges is incomplete against its own back-catalogue.
- D3 — `lore issue resolve <issue> --state rejected|wontfix --reason <r>`: writes an explicit terminal state + reason into `extra.issue_report.resolution`. `--state fixed` exits non-zero with an error naming `lore link --type resolves` as the only path to `fixed`. Rejects a target lacking `extra.issue_report`.
- D4 — `lore issues [--open|--resolved|--all] [--json]`: upstream-side listing of filed reports (title, slug, reporter_project, reported_at, age, computed resolution). Default `--open`. Pull-only; SessionStart/bootstrap injection stays rejected per §20 F4.
- D5 — `lore status --check-issues`: (a) *unclosed escalation* — a `resolves` in-edge whose source doc is terminal while the issue task is not `archived`; (b) *stale open report* — resolution `open` and older than `feedback.stale_after_days` (config-owned, default 14). Report-only, never mutates (SPEC-044 precedent).
- D6 — consumer-side `lore report-issue --list` joins on the computed resolution instead of the raw upstream doc status; rejection/wontfix reason is echoed. `unreachable` degradation (SPEC-072 AC-072-10) is preserved unchanged.
- D7 — the resolution computation lives in the service layer, so CLI, MCP, and HTTP read it identically; `resolves` edges are subject to the same write validation on every adapter. The HTTP issue-reports projection returns the computed resolution alongside each report.
- D8 — the dashboard Issues surface (§20 F5) renders the computed resolution, and its open-count badge counts computed-`open` reports rather than `draft` docs. Without this, the human triage surface keeps reading raw doc status and reproduces the exact proxy failure D2 removes — one surface fixed, the other still lying.

**Out of scope**

- Auto-advancing the issue task's own `status` on resolution (collides with §20's standing "no auto-approved tasks" non-goal). Archiving stays manual via existing `lore set --status` / `lore done`, prompted by D5(a).
- repro-command-driven auto-verification (§20 F6 successor; only 7/10 reports carry a `repro_command`, and cross-corpus execution needs a sandbox — separate blast radius).
- Cross-machine transport (§20 non-goal, unchanged).
- Any new document status or transition.

## Acceptance Criteria

Declared as structured ACs via `lore ac add` (authoritative; the list below is the prose mirror).

- AC-ICL-1 — `resolves` accepted by `linkTypeSchema`; a `resolves` edge to a non-issue task is rejected with a named error.
- AC-ICL-2 — resolution computation returns `open` / `resolving` / `fixed` for the three in-edge configurations.
- AC-ICL-3 — `lore issue resolve --state fixed` exits non-zero and names `lore link --type resolves`.
- AC-ICL-4 — `lore issue resolve --state rejected|wontfix --reason` persists state + reason and the computation reports it.
- AC-ICL-5 — `lore issues --json` lists exactly the docs carrying `extra.issue_report`, with computed resolution; `--open` excludes terminal ones.
- AC-ICL-6 — `lore status --check-issues` flags the unclosed-escalation shape and the stale-open shape, and exits without mutating any doc.
- AC-ICL-7 — consumer `report-issue --list` shows the computed resolution (twin-corpus test: escalated fix ⇒ `fixed`, not `draft`), preserving `unreachable` degradation.
- AC-ICL-8 — end-to-end on the real shape: an issue + a `resolves` spec that is `archived` computes `fixed` and `--check-issues` reports it as an unclosed escalation until the task is archived.
- AC-ICL-9 — the dashboard Issues page renders each report's computed resolution and its nav badge counts computed-`open` reports, verified against a seeded throwaway corpus.
- AC-ICL-10 — an issue task whose own status is `archived`, with no `resolves` in-edge and no explicit terminal state, computes `closed`; `lore issues --open` omits it and `--resolved` includes it. Precedence is asserted directly: an explicit terminal state and a `resolves`-edge result each still win over `archived`.
- AC-ICL-11 — a report rejected through the review workflow (`lore reject`, which leaves `doc.status` at `draft`) computes `rejected` and carries the recorded reason; consumer `--list` never shows a row whose resolution is `open` while a rejection reason is present.

## Test discipline

Binding, inherited from §20: cross-corpus paths use **twin throwaway corpora** (`mkdtemp` + `lore init` × 2) under `bun test` (`.bun.test.ts` — both sides touch `SQLiteStore`). Never write to this repo's own `.lore/`. Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION); the pre-existing `report-issue --list` output for an unconfigured consumer stays byte-identical (regression pin).


## Acceptance Criteria (structured)

- [⚑] [script] AC-ICL-1: linkTypeSchema accepts 'resolves'; creating a resolves edge whose target task lacks extra.issue_report is rejected with a named VALIDATION_ERROR (not silently accepted).
  script: test — bunx vitest run packages/lore/tests/unit/service/issue-resolution.test.ts -t AC-ICL-1
- [⚑] [script] AC-ICL-2: computeIssueResolution returns 'open' with no resolves in-edge, 'resolving' with a resolves in-edge whose source is draft/in-review/approved, and 'fixed' once any source doc reaches active or archived.
  script: test — bunx vitest run packages/lore/tests/unit/service/issue-resolution.test.ts -t AC-ICL-2
- [⚑] [script] AC-ICL-3: lore issue resolve <issue> --state fixed exits non-zero and its stderr names 'lore link' and 'resolves' as the only path to fixed; no resolution field is written.
  script: test — bunx --bun vitest run packages/lore/tests/e2e/issue-closure.bun.test.ts -t AC-ICL-3
  other_command=4
- [⚑] [script] AC-ICL-4: lore issue resolve --state rejected|wontfix --reason <r> persists state and reason under extra.issue_report.resolution, and the computed resolution reports that terminal state over any resolves-edge computation.
  script: test — bunx --bun vitest run packages/lore/tests/e2e/issue-closure.bun.test.ts -t AC-ICL-4
  other_command=4
- [⚑] [script] AC-ICL-5: lore issues --json lists exactly the tasks carrying extra.issue_report with their computed resolution; --open excludes fixed/rejected/wontfix; --all includes them; a corpus with zero reports yields an empty list and exit 0.
  script: test — bunx --bun vitest run packages/lore/tests/e2e/issue-closure.bun.test.ts -t AC-ICL-5
  other_command=4
- [⚑] [script] AC-ICL-6: lore status --check-issues flags (a) a resolves in-edge whose source is terminal while the issue task is not archived, and (b) an open report older than feedback.stale_after_days; a byte-comparison of every issue doc before and after proves it mutated nothing.
  script: test — bunx --bun vitest run packages/lore/tests/e2e/issue-check.bun.test.ts -t AC-ICL-6
  other_command=3
- [⚑] [script] AC-ICL-7: In a throwaway consumer corpus against a stubbed gh, the consumer-side lore report-issue --list prints the COMPUTED resolution: before any fix a filed report computes open; once a spec carrying a resolves edge to it is archived, its row shows fixed (the resolution cell), never open or draft. An unreadable remote fails LOUD — a non-zero exit with gh's own message on stderr — while lore issues --local still lists the filed history, exit 0. CORRECTED (TG-11B): the criterion degraded an unreadable upstream to a row status 'unreachable' (exit 0) and echoed a recorded rejection reason; both belonged to the SQLite list renderer deleted in 8b3845b1 (the remote listing has no reason column and, by the no-silent-fallback rule, does not hide an outage behind exit 0). The rejection-reason echo is therefore no longer asserted anywhere.
  script: test — bunx --bun vitest run packages/lore/tests/integration/cli/issue-read-surfaces-gh.bun.test.ts -t 'AC-ICL-7:' 2>&1 && echo "AC-ICL-7 PASS: the consumer-side listing prints the computed resolution and fails loud on an unreadable remote"
  other_command=3
- [⊘] [script] AC-ICL-8: End-to-end on the real shape: a filed issue plus an archived spec carrying a resolves edge computes fixed, lore issues --open omits it, and --check-issues reports it as an unclosed escalation until the issue task itself is archived.
  script: test — bunx --bun vitest run packages/lore/tests/e2e/issue-closure-e2e.bun.test.ts -t AC-ICL-8
  other_command=3
- [⚑] [script] AC-ICL-9: The dashboard Issues page renders each report's computed resolution and the nav badge counts computed-open reports; verified in Playwright against a seeded throwaway corpus, serialized on a fixed dev-server port.
  script: e2e — cd packages/dashboard && bunx playwright test tests/e2e/issues-resolution.spec.ts
- [⚑] [script] AC-ICL-10: An issue task whose own status is archived, with no resolves in-edge and no explicit terminal state, computes 'closed'; lore issues --open omits it and --resolved includes it; an explicit terminal state and a resolves-edge result each still take precedence over archived.
  script: test — bunx --bun vitest run packages/lore/tests/e2e/issue-closed-state.bun.test.ts -t AC-ICL-10
  other_command=4
- [⚑] [script] AC-ICL-11: computeIssueResolution computes 'rejected' for a report rejected through the review workflow (hasRecordedReviewRejection true, which outranks the archived-doc 'closed' state and applies with no explicit write) and for an explicit rejected state carrying a recorded reason; in neither case is a row ever computed 'open'. Verified at the pure-function layer. CORRECTED (TG-11B): the criterion also required the consumer-side row to carry the recorded reason through a cross-corpus list, and lore reject leaves doc.status at draft per SPEC-005, so the audit-trail lookback that fed hasRecordedReviewRejection lived in the deleted upstream branch (commands/issues.ts header, 8b3845b1); the gh read path does not pass that flag, so the review-rejection signal is not wired through any read surface today — a residual gap named here, not hidden.
  script: test — bunx --bun vitest run packages/lore/tests/unit/service/issue-resolution.test.ts -t AC-ICL-11 2>&1 && echo "AC-ICL-11 PASS: a recorded review rejection and an explicit rejected-with-reason both compute rejected, never open"
  other_command=3
- [⊘] [script] AC-ICL-12: The resolves-edge e2e suites exercise the REAL migration path: no test-only CHECK-constraint widening helper exists anywhere under packages/lore/tests, and both suites still pass without it.
  script: test — bunx --bun vitest run packages/lore/tests/e2e/issue-closure.bun.test.ts packages/lore/tests/e2e/issue-closed-state.bun.test.ts && ! grep -rq widenLinkTypeCheckForResolvesTestOnly tests/
  other_command=3
