---
id: KN-711
type: knowledge
role: knowledge
title: "Milestone review: Baseline slice 3b"
status: approved
priority: medium
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-164
links:
  - {id: PLAN-164, type: informs}
---
# Milestone review: FAIL

Fingerprint: plan:01M4K4JS7JF9PTN4EN0B1RF5VR@9|tasks:01M4K4K4TZWA6FPR3QW1Y9P2D3@14,01M4K4K568KZS22E9FXWEZ95C9@15,01M4K4K5GY2WZ61XJ0TRA12YDB@10,01M4K4K5VRKKHQG5GWNWRP0N3G@10,01M4K4K66G4WBVBH7KGBHKTRPB@14,01M4K4K6HFAWZ1D72VG09JHBA4@9,01M4K4K6W8BA0PF313ZDWKZSE2@8,01M4K4K76YSN7ARVKRYSP6Z5P7@12,01M4KAZ5S6HF8TQZVK4QG56Z73@10|landed:none
Diff: unavailable: every task is archived but none recorded a commit range

| Dimension | Verdict | Reason | Reference |
|---|---|---|---|
| correctness_vs_acs | fail | No milestone decisions are waiting. Every slice AC has an attested pass: AC-BLS3B-1/2 (spec-parent-contract, spec-approve-requires-citation), 3/8 (status census, node budget), 4 (spec-implements-view), 5/6 (parentless-spec-consumers, requirement-coverage-corpus-wide), 7 (migrate-spec-parents), 9 (distribution and NewDocModal), and 10/11/12 (read-only checker scripts run from main). AC-BLS3B-5 has one attested vitest FAIL, but a later run of the same vitest command passed. Every red-first expected-fail run is self-reported, so the plan's red-first invariant rests only on the implementers' word. The plan fails on task-fix-main-red-after-the-slice-3b-and-close-out-merges. Its AC is 'both full runners green except failures proven pre-existing at 27969373, each listed with an issue number'. Its only attested evidence is a run of 11 chosen files. No full-runner pass is attested and no list of pre-existing failures with issue numbers is recorded. The batch run on main at 46ef5e9d exits 1 for both `bun run test` and `check:plan-close`. One of the files still failing there, scripts/tests/error-message-commands-executable.test.ts, is in that task's own attested-pass list. No diff was available, so this verdict rests on the evidence records only. | Evidence for task-fix-main-red-after-the-slice-3b-and-close-out-merges; full-suite run on main at 46ef5e9d; the 'Evidence: [attested]' entries for AC-BLS3B-1..12 |
| spec_conformance | fail | The spec and the plan disagree on scope. The spec's Acceptance Criteria section declares 'AC-BLS3B-1..11'. The plan's invariants and task table declare AC-BLS3B-1..12, with AC-12 as the uncited-spec mapping ledger. The spec never records that criterion, although D6 describes the work. The spec also says 'Code anchors: Declared after landing'. Every task is archived, yet no anchors are declared and no task recorded a commit range. Without a diff I cannot confirm 'no less and no more' for any part of the scope. That includes the corrected stale comment at corpus-service.ts ~3834, markdown sync no longer auto-parenting specs, and plan and task parenting left unchanged as a non-goal. The landed work cannot be shown to match the spec, and the spec itself is incomplete after landing. | Spec sections 'Acceptance Criteria' and 'Code anchors'; plan 'Tasks and owned criteria'; Landed diff: unavailable |
| regression | pass | The full-suite section attributes no failing file to this plan, and the plan has no derivable diff. By the stated rule, the roughly 58 failing files on main at 46ef5e9d do not count against it. The behaviour most at risk is the parenting that must stay. Plan→spec and task parents and the PRD parent of ad-hoc tasks are non-goals that should be untouched, while about 18 test files pinning PARENT_REQUIRED and parentLegal were re-baselined in the contract task. Those tests and the scoped tests for each AC (spec-parent-contract, parentless-spec-consumers, requirement-coverage-corpus-wide) cover it. Caveats: no diff was available, so the re-baseline list could not be inspected. The suite also stays red overall, which is recorded under correctness_vs_acs. | Full-suite run on main at 46ef5e9d ('attributed to THIS plan: none'); plan Risk Register row 1 |
| design_necessity | pass | Each technical choice follows a nameable external practice:
- Specs relate to rules through many-to-many citations instead of a parent: bidirectional requirements traceability.
- Implements and Implemented-by are computed from citations, not stored: a derived view over one source of truth.
- The migration defaults to a dry run, with --apply and --revert: plan/apply plus reversible up/down migrations.
- One audit entry per spec holding the old parent, used for revert: an append-only audit log / event sourcing.
- Per-kind size caps that status reports: performance or size budgets.
- Uncited specs refused at approval: required checks before merge.
- A parent on a spec refused with exit 4, never silently dropped: fail-fast.
- Two independent mappers plus an adjudicator: dual independent screening with third-reviewer arbitration.
- Red-first tests: test-driven development.
- corpus-service.ts edits serialized: a merge queue.
- Read-only checkers run from main: post-deploy verification and smoke checks. | Bidirectional traceability (ISO 26262 / DO-178C); materialized views; Terraform plan/apply; Rails reversible migrations; event sourcing (Fowler); Lighthouse performance budgets; GitHub branch protection required checks; Shore, 'Fail Fast'; Cochrane Handbook dual screening with arbitration; Beck, TDD by Example; GitHub merge queue / Bors |
| snapshot_accuracy | fail | Five cited rules are in state stale, meaning the document and the code disagree: BR-400, BR-422, BR-423, BR-718 and BR-789. The other cited rules are unknown, so they count as na, not fail: BR-1, BR-2, BR-418, BR-420, BR-692 and BR-1007..1010 have no recorded commit, and AS-18 and BR-1011 are on a dirty tree. | Cited rule state: BR-400, BR-422, BR-423, BR-718, BR-789 = stale |
| concurrency_safety | pass | The plan serializes the writers that could collide. Edits to corpus-service.ts run in a fixed order: audit-surface fix → link-atomicity fix → contract → consumers. Live-corpus writes come only from the orchestrator in the main checkout, plus one named exception. The domain-overview implementer writes architecture-tree nodes and deprecates the 4 overviews, which are different documents from the specs the orchestrator cites or deprecates. The store is SQLite, which serializes writers. The migration runs once, from main, after all build tasks merge. It is idempotent, and its revert reads the audit entries it wrote. Once the contract lands, specs refuse new parents, so no writer can change a parent between apply and revert. Caveat: no diff was available, so I could not confirm that the migration writes each parent clear and its audit entry in one transaction. | Plan Invariants (serialized corpus-service.ts edits, single live-corpus writer) and 'Order of live-corpus steps'; SQLite single-writer locking |
| security | pass | Nothing in the documents adds a path for untrusted input, a credential or an unchecked privilege. The changes are local CLI commands and read-only checker scripts. The dashboard form drops its parent requirement for specs, while the server side still refuses a parent on a spec with exit 4, so loosening the UI does not loosen the contract. Unattended live-corpus writes rest on the owner's explicit authorization (D5–D8, 2026-10-10). Terminal deprecations are applied only on agreement or an adjudicated ruling that names a destination, and every one is listed for the owner's review. No diff was available to inspect the code. | Plan 'Owner authorization for the live-corpus steps'; spec Scope (Contract, Distribution); OWASP input validation on the server side |
