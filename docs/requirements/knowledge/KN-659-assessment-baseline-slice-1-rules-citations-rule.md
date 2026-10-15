---
id: KN-659
type: knowledge
role: knowledge
title: "Assessment: Baseline slice 1: rules, citations, rule state, specification-branch pilot (2026-10-07)"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
links:
  - {id: PLAN-172, type: informs}
---
# Assessment: partially_met (70/100)

Scope: plan `01M4B6G41VJH33JGAYYKPGBE1H`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS1-1 | 92 | Three attested passes of rule-registry.bun.test.ts. B2 recorded a falsifier: moving the MAX(n) read outside the transaction turned it red. The diff confirms MAX(n) is read inside BEGIN IMMEDIATE (SQLite) and inside tx('write') (Turso). Turso cross-process concurrency is only in-process queued. | 01M4B6JXTY2W47T46HGG1NACTS (B2 falsifier + pass), 01M4B6K3085SXYHDVPKGVHARZ1 (E1 re-attest on main) |
| AC-BLS1-2 | 80 | Two attested passes (55 tests). C2 evidence [7] is a fail, followed by a manual 'oracle re-baseline: fixture correction' [12] before the green. That is a test change after a red, and its justification is not visible. Guard code (corpus-service.ts) is unseen. | 01M4B6JZ4V10TJPS3DGACBEHXX (C2 fail then manual re-baseline) |
| AC-BLS1-3 | 82 | Two attested passes of rule-state-service.test.ts (41 tests). There is no visible proof that the 1000-doc p95 ≤ 1.5 s and 0-git-spawn scenarios are in the file; the C6 scenario list claims them. rule-state-service.ts is unseen. | 01M4B6K0R93SN51Q1TKC20DWHG, 01M4B6K12Q1GSBAR2FDPX17CVX |
| AC-BLS1-4 | 86 | Attested passes. C5/C5b show runner-only head_sha/worktree_dirty: probeGitState in the diff, and caller-supplied values are refused on both the task and phase evidence paths. C7 added a vacuity test with a red-then-green pair. | 01M4B6K0E04GJVPV00Z7Q680XA, 01M4B8ARF3H1H25Y1P7AD2QPZ5, 01M4B6K12Q1GSBAR2FDPX17CVX |
| AC-BLS1-5 | 86 | Attested passes of the shared rule-state test file. C6 declares a bare-ac_ref falsifier, but no recorded falsifier run is shown. | 01M4B6K0R93SN51Q1TKC20DWHG |
| AC-BLS1-6 | 90 | Three attested passes of ac-cite.test.ts with a red recorded first. The diff shows CLI cite/--cite and stderr warnings. The no-cite hint is gated on baseline docs existing, which protects the rollback invariant. | 01M4B6JZS8ADDEDD5XP2PY4Y9T, 01M4B6JZF0SXS51MAXVCQJMSZT |
| AC-BLS1-7 | 85 | Attested passes. lintRuleStatement in the diff covers all 6 token kinds, with repo paths checked through an injected pathExists. A2a's expected-fail [3] was recorded after its pass [1], from a scratchpad reconstruction, so the red-first claim is weak. | 01M4B6JX6T50GH68Z2DEDE35P3, 01M4B6JXH37AAN5J46WN9X498S |
| AC-BLS1-8 | 92 | Attested e2e pass. A falsifier is recorded (emitting the baseline status key unconditionally turns it red), and a control-vs-control non-vacuity check is present. | 01M4B6K1D1XSMB2CNRM4ZF1PQA |
| AC-BLS1-9 | 88 | Attested passes. The diff shows the leaf-only rules superRefine, retired_note requirement, forward-only lifecycle helper and cites grammar. moveRule keeping the id is covered in the B1 store test. | 01M4B6JX6T50GH68Z2DEDE35P3, 01M4B6JXTY2W47T46HGG1NACTS |
| AC-BLS1-11 | 25 | AC coverage is 0 pass, 0 fail. D1, D3 and D4 carry only self-reported manual evidence. The adjudication count, score x/10, confident-wrong count and freeze-vs-leaf timestamps are not visible. 0 knowledge docs are linked even though D1, D3 and D4 claim them. D2's evidence cites a throwaway corpus. | 01M4B6K1Q59FHMENSDVWAXPMFF (D1 manual), 01M4B6K2BRR4S7J3NB9E28AZ6H (D3 manual), 01M4B6K2NVXMRJCWJQF7J0VFB6 (D4 manual) |

## Gaps

- Pilot exit is unproven. No visible record holds the adjudication ratio, the blind-reader score, the confident-wrong count, or proof that the probe freeze precedes every leaf write. 0 knowledge docs are linked to the plan.
- After a recorded fail, C2 used a manual 'oracle re-baseline' fixture correction to packages/lore/tests/unit/service/rule-service.test.ts before going green. The change is not auditable here.
- A2a recorded its expected-fail run after its pass, from a scratchpad copy, so the red-first ordering for packages/lore/tests/unit/core/baseline.test.ts is reconstructed, not contemporaneous.
- Invariant 6 was violated: migration-013 bumped LATEST_SCHEMA_VERSION without extending the sync-push fixture chain, which left packages/lore/tests/unit/adapters/sync-push.bun.test.ts red on main until C9.
- E1 is still draft. Full suite, typecheck on main, check-drift, spec code anchors and the handoff with the 4-week re-probe entry criterion are not evidenced.
- AC_CITE_ID_PATTERN in packages/core/src/acceptance.ts duplicates BASELINE_RULE_ID_PATTERN in packages/core/src/baseline.ts, so the BR id grammar has two sources of truth.

## Recommendations

- Before closing E1, link the D1 probe-set, D3 mapping and D4 assessment knowledge docs to the plan, and record evidence that quotes the three AC-BLS1-11 numbers and both timestamps.
- Require any test-fixture change made after a red run to be recorded as a diff plus rationale, with a re-run falsifier, not as a manual pass entry.
- When a task bumps the schema version, its scoped oracle must include every test that replays the migration chain or pins user_version.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 59583ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/core/baseline.test.ts, diff:lore.tree.yaml, diff:packages/dashboard/tests/unit/lib/type-accent.test.ts, diff:packages/lore/tests/unit/ai/templates.test.ts, diff:packages/lore/tests/unit/core/doc-type-rules.test.ts, diff:packages/lore/tests/unit/core/types.test.ts, diff:packages/lore/tests/unit/service/tree-blueprint-armed.test.ts, diff:packages/lore/tests/unit/store/rule-registry.bun.test.ts, diff:packages/lore/tests/unit/service/ac-cite.test.ts, diff:packages/lore/tests/unit/service/rule-service.test.ts, diff:packages/lore/tests/unit/service/attestation-head-sha.test.ts, diff:packages/lore/tests/unit/service/rule-state-service.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/store/audit-chain.bun.test.ts, diff:packages/lore/tests/unit/store/migration-001-idempotent.bun.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/tests/unit/store/migration-004.bun.test.ts, diff:packages/lore/tests/unit/store/migration-006-fk-restore.bun.test.ts, diff:packages/lore/tests/unit/store/migration-008-cjk-fts.bun.test.ts, diff:packages/lore/tests/unit/store/migration-012.bun.test.ts, diff:packages/lore/tests/unit/store/migration-013.bun.test.ts, diff:packages/lore/tests/unit/store/trace-events.bun.test.ts, diff:packages/lore/tests/unit/store/version-slug-migration.bun.test.ts, diff:packages/lore/tests/unit/service/phase-evidence-git-stamp.test.ts, diff:packages/lore/src/service/ac-citations.ts, diff:packages/lore/src/service/ac-service.ts, diff:scripts/check-ordinal-write-sites.mjs, diff:packages/lore/src/adapters/cli/commands/baseline.ts, diff:packages/lore/src/adapters/cli/commands/rule.ts, diff:packages/lore/src/adapters/cli/index.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/baseline-rule-ids.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/rule-service.ts, diff:packages/lore/tests/unit/adapters/mcp-tools.test.ts, diff:packages/lore/tests/unit/service/baseline-create-guard.test.ts, diff:packages/lore/tests/unit/service/rule-service.test.ts, diff:packages/lore/src/adapters/cli/commands/baseline.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/service/baseline-status.ts, diff:packages/lore/src/service/rule-state-git-port.ts, diff:packages/lore/src/service/rule-state-service.ts, diff:packages/lore/tests/unit/service/rule-state-vacuous.test.ts, diff:packages/lore/tests/e2e/baseline-rollback.bun.test.ts, diff:packages/lore/tests/unit/adapters/sync-push.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.6 | evidence | AC-BLS1-1..9 have attested passes and the core and store code is sound. The pilot exit (AC-BLS1-11) is unjudged and E1 is incomplete. |
| evidence_integrity | 65 | 0.55 | evidence | 92% attested with falsifiers on B2 and C8. Weak points: the pilot is self-reported manual, A2a's red was retroactive, C2's oracle was re-baselined after a fail, and the knowledge docs are unlinked. |
| scope_fidelity | 82 | 0.6 | evidence | Changes map to the planned tasks. C5b and C9 were added and explained. MCP ac tools were deferred with a recorded decision. There is a minor duplicate BR id regex. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | blocker | AC-BLS1-11 | Pilot exit is unproven. No visible record holds the adjudication ratio, the blind-reader score, the confident-wrong count, or proof that the probe freeze precedes every leaf write. 0 knowledge docs are linked to the plan. |
| evidence_integrity | major | AC-BLS1-2 | After a recorded fail, C2 used a manual 'oracle re-baseline' fixture correction to packages/lore/tests/unit/service/rule-service.test.ts before going green. The change is not auditable here. |
| evidence_integrity | minor | AC-BLS1-7 | A2a recorded its expected-fail run after its pass, from a scratchpad copy, so the red-first ordering for packages/lore/tests/unit/core/baseline.test.ts is reconstructed, not contemporaneous. |
| outcome | major | — | Invariant 6 was violated: migration-013 bumped LATEST_SCHEMA_VERSION without extending the sync-push fixture chain, which left packages/lore/tests/unit/adapters/sync-push.bun.test.ts red on main until C9. |
| outcome | major | — | E1 is still draft. Full suite, typecheck on main, check-drift, spec code anchors and the handoff with the 4-week re-probe entry criterion are not evidenced. |
| scope_fidelity | minor | — | AC_CITE_ID_PATTERN in packages/core/src/acceptance.ts duplicates BASELINE_RULE_ID_PATTERN in packages/core/src/baseline.ts, so the BR id grammar has two sources of truth. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Before closing E1, link the D1 probe-set, D3 mapping and D4 assessment knowledge docs to the plan, and record evidence that quotes the three AC-BLS1-11 numbers and both timestamps. | The AI rubric fails if any of the numbers is missing, and none can be seen now. |
| process | Require any test-fixture change made after a red run to be recorded as a diff plus rationale, with a re-run falsifier, not as a manual pass entry. | Changing an oracle after a fail undermines TDD evidence. |
| skill | When a task bumps the schema version, its scoped oracle must include every test that replays the migration chain or pins user_version. | B2 missed sync-push, which breached Invariant 6. |

## Unverifiable Materials

- D1/D3/D4 knowledge docs (probe set, mapping record, pilot assessment): Not included in the materials, and 0 linked knowledge docs are reported.
- packages/lore/src/service/rule-state-service.ts and corpus-service.ts guard: Omitted from the diff, so the precedence, perf and HTTP/MCP guard implementations cannot be inspected.
- C2 fixture correction diff: Only a manual evidence label is present.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 21 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.92
