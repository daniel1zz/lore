---
id: KN-057
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-079 audit hardening (provenance + actor + chain) (2026-07-26)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-10-23
tags: []
parent: PLAN-030
links:
  - {id: PLAN-030, type: informs}
---
# Assessment: met (82/100)

Scope: plan `01KYED6NXQCMSZ0CSJQC9XX48K`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-079-1 | 85 | T1 vitest link-provenance suite passes twice (task agent + attested orchestrator re-run, 12 tests). Output tail confirms real suite at canonical AC path. No diff, so details-shape fidelity to the documented action/details contract is unverified. | task-t1-relationship-provenance-actor-fidelity-link-unlink-tree (evidence [1],[4] — 12 tests pass) |
| AC-079-2 | 85 | audit-actor-fidelity.test.ts passes twice (13 tests), incl. attested orchestrator run at the canonical path. resolveActorWithSource env-chain fallback claimed in task text but not independently visible without a diff. | task-t1-relationship-provenance-actor-fidelity-link-unlink-tree (evidence [2],[5]) |
| AC-079-3 | 85 | audit-chain.bun.test.ts passes twice; tail shows chain-extension and independent-recompute cases. typecheck pass recorded. Migration-009 legacy-fixture backfill case is asserted in task text but not shown in the truncated tail. | task-t2-audit-hash-chain-store-shared-hash-fns-migration-009 (evidence [1],[3],[4]) |
| AC-079-4 | 88 | Tamper suite passes twice; produced by an independent tester agent (test-only task), which raises credibility. Tail shows UPDATE→hash_mismatch at the exact id for both actor and details JSON; DELETE/forged-row cases clipped from tail. | task-t4-adversarial-tamper-suite-independent-tester-audit (evidence [1],[2]) |
| AC-079-5 | 85 | audit-anchor.bun.test.ts passes twice at the canonical integration path; tail shows anchor write + --verify consumption + empty-table exit-4 negative. The anchor_mismatch-on-rewritten-chain case is clipped from the visible tail. | task-t3-verify-chain-walk-anchor-lore-audit-verify-chain (evidence [1],[2]) |
| AC-079-6 | 84 | in-memory-audit-chain.test.ts passes twice (8 tests), attested by orchestrator. 'Identical chain semantics for all audit write paths' is a parity claim not checkable without the diff or test bodies. | task-t2-audit-hash-chain-store-shared-hash-fns-migration-009 (evidence [2],[5]) |
| AC-079-7 | 80 | Full `bun run typecheck && bun run test` recorded pass, attested by orchestrator on T5. Single run only; tail is unrelated HTTP-auth tests, so overall exit-0 rests on the recorded result rather than a visible summary line. | task-t5-sync-push-fixture-migration-chain-catches-up-to (evidence [2] build oracle) |

## Gaps

- No diff is available (diff_available=false) and regression signals report tests_touched=false, so no material in the bundle shows the actual test bodies or source changes. Non-vacuity of the six suites — e.g. that audit-chain tests truly recompute sha256 independently, or that tamper tests really mutate rows — is taken on the pass records alone.
- attested_evidence_ratio is 0.44; T1 and T2 each carry 3 self-reported records against 2 attested. Orchestrator attestation does cover at least one run per AC, which mitigates but does not remove the imbalance.
- AC-079-7 has a single build-oracle record whose output_tail shows unrelated HTTP cookie-auth tests and no final exit status or aggregate counts, so 'both runners exit 0' is asserted by the recorder rather than shown.
- T5 (sync-push fixture migration-009 catch-up) is not part of the plan's declared T1–T4 two-wave structure and no plan amendment is recorded. It is coherent follow-on work from migration-009 and carries its own green oracle, so the drift is explained but undocumented in the plan.
- The migration-009 legacy-fixture backfill clause of AC-079-3 is not visible in the captured output tail (which shows only append/provenance/hash-recompute cases), so that specific sub-requirement rests on task description text.

## Recommendations

- Require the implementation diff in audit bundles for specs that add cryptographic or migration logic; without it an auditor cannot distinguish a correct hash chain from a passing-but-weak one.
- Record per-suite pass/fail counts plus the runner exit code in the evidence record instead of a raw truncated tail, especially for full-regression build oracles.
- Add regression-surfaced remediation tasks (T5) to the plan with an explicit AC linkage or an 'unblocks AC-079-7' note before executing them.
- Transition tasks from draft to complete once their oracles are attested green, so wave-2-after-merge sequencing is verifiable from task state.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 56331ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.75 | evidence | All 7 ACs have passing oracle runs at the exact commands the spec names, each with an attested re-run; full regression green. Implementation quality itself unseen. |
| evidence_integrity | 78 | 0.7 | evidence | Every AC independently re-run by main-orchestrator with real test-name tails; T4 written by an independent tester. Weakened by 0.44 attested ratio, clipped tails, and all tasks still draft. |
| scope_fidelity | 80 | 0.6 | evidence | T1–T4 map cleanly to the declared waves and ACs. T5 is undeclared scope, though narrowly bounded and explained as a fixture-drift fix forced by migration-009. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | No diff is available (diff_available=false) and regression signals report tests_touched=false, so no material in the bundle shows the actual test bodies or source changes. Non-vacuity of the six suites — e.g. that audit-chain tests truly recompute sha256 independently, or that tamper tests really mutate rows — is taken on the pass records alone. |
| evidence_integrity | minor | — | attested_evidence_ratio is 0.44; T1 and T2 each carry 3 self-reported records against 2 attested. Orchestrator attestation does cover at least one run per AC, which mitigates but does not remove the imbalance. |
| evidence_integrity | minor | AC-079-7 | AC-079-7 has a single build-oracle record whose output_tail shows unrelated HTTP cookie-auth tests and no final exit status or aggregate counts, so 'both runners exit 0' is asserted by the recorder rather than shown. |
| scope_fidelity | minor | — | T5 (sync-push fixture migration-009 catch-up) is not part of the plan's declared T1–T4 two-wave structure and no plan amendment is recorded. It is coherent follow-on work from migration-009 and carries its own green oracle, so the drift is explained but undocumented in the plan. |
| outcome | minor | AC-079-3 | The migration-009 legacy-fixture backfill clause of AC-079-3 is not visible in the captured output tail (which shows only append/provenance/hash-recompute cases), so that specific sub-requirement rests on task description text. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the implementation diff in audit bundles for specs that add cryptographic or migration logic; without it an auditor cannot distinguish a correct hash chain from a passing-but-weak one. | Six ACs here hinge on chain correctness that no supplied material exposes. |
| process | Record per-suite pass/fail counts plus the runner exit code in the evidence record instead of a raw truncated tail, especially for full-regression build oracles. | AC-079-7's tail shows unrelated suites; AC-079-3/4/5 tails clip the AC-named assertions. |
| plan | Add regression-surfaced remediation tasks (T5) to the plan with an explicit AC linkage or an 'unblocks AC-079-7' note before executing them. | Keeps declared scope and executed scope reconcilable for downstream audits. |
| process | Transition tasks from draft to complete once their oracles are attested green, so wave-2-after-merge sequencing is verifiable from task state. | All five tasks are still draft despite green oracles and a passing full regression. |

## Unverifiable Materials

- Implementation diff (store-shared.ts hash fns, migration-009, SQLite/Turso/InMemory insert paths, CorpusService/TreeCheckService, CLI/MCP/HTTP actor threading): diff_available=false; no source shown in bundle, so correctness and quality of the chain, migration transaction, and actor resolution are unreviewable.
- Test file bodies for the six suites named by the ACs: Only pass records and clipped output tails provided; assertion strength and non-vacuity cannot be checked.
- Merge/task state confirming wave-2 ran after wave-1 merge: All tasks report status=draft and no git or merge evidence is included.
- Full-regression exit status for AC-079-7: output_tail shows unrelated HTTP-auth suites with no summary or exit line.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.44
