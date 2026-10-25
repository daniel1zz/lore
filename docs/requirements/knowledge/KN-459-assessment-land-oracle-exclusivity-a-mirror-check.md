---
id: KN-459
type: knowledge
role: knowledge
title: "Assessment: Land oracle exclusivity: a mirror check that can fail, a guard that sees mirror content, a gitignored probe namespace, and a serialized suite (2026-08-17)"
status: archived
priority: medium
created: 2026-08-17
updated: 2026-10-23
tags: []
parent: PLAN-124
links:
  - {id: PLAN-124, type: informs}
---
# Assessment: partially_met (79/100)

Scope: plan `01KZR6QS8HQPE1VMAF8MXVHCCX`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-OX-1 | 86 | Attested pass of the verbatim command: no runMirrorScript([]) anywhere, 23 tests green, tree clean after. An earlier attested fail (links_broken 2 vs 0) precedes it; diff confirms the oracle now drives ['--check']. Seeded-drift RED shown by evidence [1] (exit 2 on removed ADR). | 01KZR6RNJA6HT5H21WAXJ8FABF (evidence [3] attested pass; [2] attested fail earlier) |
| AC-OX-2 | 90 | Diff shows pure checkRepoPollution returning offendingPaths, widened to docs/requirements, e2e wired at column-0 beforeAll/afterAll printing paths, and the unit suite reading the OTHER file's source. Attested pass, 13 tests, single declared path resolving the earlier inconclusive verdict. | 01KZR6RN5T63QRDKRZQ46JPQS0 (evidence [6]/[8] attested pass, 13 pass 0 fail) |
| AC-OX-3 | 87 | Attested pass with the corrected command. Diff shows the second-order correction landed: both probes assert exit EXACTLY 2, discriminated by TS2322/TS1136 vs TS18003 with mutual-exclusion assertions plus a cross-check control. Projects enumerated from package.json, not hardcoded; probes in mkdtemp … | 01KZR6RNBY9C8RER1PS0WP15PE (evidence [11] attested pass at repo root, 6 tests) |
| AC-OX-4 | 70 | Tests are genuinely hermetic (injected mkdtemp), cover 0/5/reclaim/corrupt/no-process.exit, and use a spawned-and-reaped pid. But the AC's checkout-level clause (lock path == git rev-parse --git-common-dir) is asserted by NO oracle — the suite header states resolveDefaultLockDir is never exercised. | 01KZR6RNBY9C8RER1PS0WP15PE (evidence [12] attested pass; test header disclaims production-path coverage) |
| AC-OX-5 | 89 | Three attested passes on the verbatim command. Diff shows the mechanism, not just a test: frontmatter_repaired/frontmatter_declined on ExportReport, unconditional scalar-field convergence independent of force, undecidable-frontmatter declined rather than reported clean, and drift+scalar named hones… | 01KZWMXYXADHEPPZWVN1Q2EQNQ (evidence [2][3][5] attested pass; export-docs-service.ts diff) |
| AC-OX-6 | 78 | Attested fail (status_mismatch + orphan_mapping) then attested pass after retireDeletedDocMappings landed, which fixes the KN-025 residue at the prune rather than by hand-deleting. Ordering is narrative, not machine-pinned; the parse-count trace and --include-invalid sourcing are in an unseen test … | 01KZX0G3G9QJ0NCYGRRXAE59YF (evidence [5] attested pass post-fix), 01KZWMXYXADHEPPZWVN1Q2EQNQ (evidence [4] attested fail) |

## Gaps

- AC-OX-4 requires the production lock path to resolve to `git rev-parse --git-common-dir` so runs in the main checkout and linked worktrees contend. No oracle asserts this: scripts/tests/oracle-lock.test.ts's own header states every call injects an mkdtemp dir and that resolveDefaultLockDir 'is exercised only by actually running bun run test for real, never by this file'. A per-worktree lock would pass all seven cases — the exact failure mode the plan's sequencing risks call out as 'would compil…
- package.json's `test` script was changed to `bun scripts/oracle-lock.ts sh -c "..."`, but no evidence record anywhere runs it. The plan banned full-suite runs for implementers and no orchestrator full run on main is attested, so the mutex wrapper's real integration (argv passthrough, exit-code propagation, release on failure) is entirely unverified. The prune task separately documents that a single red short-circuits the whole bun half.
- The plan's Goal and Phases declare four ACs across three dispatches. Execution added AC-OX-5 and AC-OX-6 plus a prune task, landing substantial new production logic in packages/lore/src/service/export-docs-service.ts (frontmatter scalar convergence, retireDeletedDocMappings, a new store fetch with exclude_deleted:false). The additions are in-spec and well-reasoned, but no plan amendment records the expansion.
- The plan lists the G19 gap-ledger correction as orchestrator-owned and explicitly warns 'All four ACs could land green with the mis-scoped entry surviving'. No task evidence or diff hunk shows it was made, so the predicted failure mode appears to have occurred.
- AC-OX-6's mandated positive trace (parsed-file count non-zero and equal to the mapped-and-present population) and the `lore list --include-invalid` population source live in scripts/tests/mirror-status-parity.test.ts, which is omitted from the diff. The green tail line paraphrases these properties but the assertions themselves were not reviewable here.

## Recommendations

- Add an AC-OX-4 sub-clause verifiable without acquiring a real lock: assert the module's default lock directory string equals `git rev-parse --git-common-dir` resolved from the repo root, from both the main checkout and a linked worktree if available.
- Require one attested full `bun run test` on main after the final merge of a plan that rewires the `test` script, and record it against the AC that changed the script.
- Amend the plan when in-flight ACs are added (AC-OX-5/AC-OX-6 here) so the declared scope and the delivered scope match, and re-declare which dispatch owns the new production code.
- Capture as knowledge docs: (1) tsc 5.9.3 under --noEmit exits 2 for both TS2322 and TS18003, so only the error code discriminates; (2) default `lore list` silently omits invalidated docs behind a self-consistent total.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 103014ms
- Retried: false
- Truncated sections: task:task-the-two-mirror-exporters-disagree-because-drift-detection, diff:scripts/oracle-lock.ts, diff:packages/lore/tests/unit/repo-pollution-guard.bun.test.ts, diff:scripts/tests/spec-mirror-export.test.ts, diff:scripts/export-spec-mirror.ts, diff:scripts/tests/mirror-frontmatter-drift.test.ts, diff:scripts/tests/mirror-status-parity.test.ts, diff:.lore/export-index.json, diff:scripts/export-spec-mirror.ts, diff:scripts/tests/mirror-prune-retire-deleted-doc-mapping.test.ts, diff:.lore/export-index.json
- Reasoning clipped for: AC-OX-3, AC-OX-5, AC-OX-6

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.75 | evidence | All six ACs have attested passes on their verbatim commands, and the diff shows mechanism fixes (read-only oracle, pure predicate, frontmatter convergence, prune retirement) not test-shaped workaroun… |
| evidence_integrity | 72 | 0.65 | evidence | Attested pass/fail pairs with visible red-then-green progression and honest recorded corrections; but ratio 0.35, ordering is narrative, and the newly-wired full-suite path is never demonstrated. |
| scope_fidelity | 80 | 0.7 | evidence | Forbidden files (ordinal-migration-service, ordinal.ts, schemas.ts) untouched; no probe written into a typechecked glob. Drift: scope grew from four ACs to six plus new service logic without plan ame… |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-OX-4 | AC-OX-4 requires the production lock path to resolve to `git rev-parse --git-common-dir` so runs in the main checkout and linked worktrees contend. No oracle asserts this: scripts/tests/oracle-lock.test.ts's own header states every call injects an mkdtemp dir and that resolveDefaultLockDir 'is exercised only by actually running bun run test for real, never by this file'. A per-worktree lock would pass all seven cases — the exact failure mode the plan's sequencing risks call out as 'would compil… |
| evidence_integrity | major | AC-OX-4 | package.json's `test` script was changed to `bun scripts/oracle-lock.ts sh -c "..."`, but no evidence record anywhere runs it. The plan banned full-suite runs for implementers and no orchestrator full run on main is attested, so the mutex wrapper's real integration (argv passthrough, exit-code propagation, release on failure) is entirely unverified. The prune task separately documents that a single red short-circuits the whole bun half. |
| scope_fidelity | minor | — | The plan's Goal and Phases declare four ACs across three dispatches. Execution added AC-OX-5 and AC-OX-6 plus a prune task, landing substantial new production logic in packages/lore/src/service/export-docs-service.ts (frontmatter scalar convergence, retireDeletedDocMappings, a new store fetch with exclude_deleted:false). The additions are in-spec and well-reasoned, but no plan amendment records the expansion. |
| scope_fidelity | minor | — | The plan lists the G19 gap-ledger correction as orchestrator-owned and explicitly warns 'All four ACs could land green with the mis-scoped entry surviving'. No task evidence or diff hunk shows it was made, so the predicted failure mode appears to have occurred. |
| evidence_integrity | minor | AC-OX-6 | AC-OX-6's mandated positive trace (parsed-file count non-zero and equal to the mapped-and-present population) and the `lore list --include-invalid` population source live in scripts/tests/mirror-status-parity.test.ts, which is omitted from the diff. The green tail line paraphrases these properties but the assertions themselves were not reviewable here. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Add an AC-OX-4 sub-clause verifiable without acquiring a real lock: assert the module's default lock directory string equals `git rev-parse --git-common-dir` resolved from the repo root, from both the main checkout and a linked worktree if available. | The checkout-level property is the measured defect; today only prose and an unseen source file back it. |
| process | Require one attested full `bun run test` on main after the final merge of a plan that rewires the `test` script, and record it against the AC that changed the script. | The mutex wrapper is a single point of failure for every future oracle and is currently unexercised. |
| plan | Amend the plan when in-flight ACs are added (AC-OX-5/AC-OX-6 here) so the declared scope and the delivered scope match, and re-declare which dispatch owns the new production code. | Six ACs and a new prune path were delivered against a plan that still reads 'Land the four ACs'. |
| process | Capture as knowledge docs: (1) tsc 5.9.3 under --noEmit exits 2 for both TS2322 and TS18003, so only the error code discriminates; (2) default `lore list` silently omits invalidated docs behind a self-consistent total. | Both were rediscovered mid-flight after wrong measurements shipped into AC text; zero knowledge docs were linked. |

## Unverifiable Materials

- scripts/oracle-lock.ts: Omitted from the diff; its lock-path resolution, argv passthrough and release semantics could not be inspected, and no oracle covers the production path.
- scripts/tests/mirror-status-parity.test.ts: Omitted from the diff; AC-OX-6's parse-count trace and --include-invalid population sourcing are asserted only by the green summary line.
- scripts/tests/spec-mirror-export.test.ts and mirror-frontmatter-drift.test.ts: Omitted from the diff; the seeded-drift RED construction for AC-OX-1 and the throwaway-corpus controls for AC-OX-5 are judged from evidence tails only.
- Evidence chronology: Attested pass/fail records carry no timestamps in the bundle; the fail-then-pass ordering for AC-OX-1 and AC-OX-6 is inferred from task narrative.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.35
