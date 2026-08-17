---
id: KN-465
type: knowledge
role: knowledge
title: "Assessment: Land oracle exclusivity: a mirror check that can fail, a guard that sees mirror content, a gitignored probe namespace, and a serialized suite (2026-08-17)"
status: approved
priority: medium
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PLAN-124
links:
  - {id: PLAN-124, type: informs}
---
# Assessment: partially_met (72/100)

Scope: plan `01KZR6QS8HQPE1VMAF8MXVHCCX`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-OX-1 | 78 | Attested pass exists on the full declared command (grep guard + vitest + clean-tree test), plus an attested expected-fail showing the oracle reds on seeded drift. Diff for spec-mirror-export.test.ts is truncated, so the read-only conversion itself is unseen; evidence line 394 shows runMirrorScript(… | 01KZR6RNJA6HT5H21WAXJ8FABF (expected-fail then pass on the declared command) |
| AC-OX-2 | 88 | Predicate, e2e wiring, and unit suite all visible in diff. checkRepoPollution returns offending paths; guard prints them; hooks at file scope; unit test reads the OTHER file and asserts the widened invocation. 13 pass attested on the revised single-path command. | 01KZR6RN5T63QRDKRZQ46JPQS0 (attested pass, 13 tests, revised command) |
| AC-OX-3 | 85 | Full test source visible: gitignore entry, seven projects enumerated from package.json (not hardcoded), positive-control glob matcher, isolated mkdtemp tsc probes, both exit 2 separated by TS2322/TS1136 vs TS18003 with mutual-exclusion asserts. Attested pass on the declared command. | 01KZR6RNBY9C8RER1PS0WP15PE (6 tests pass on declared command) |
| AC-OX-4 | 84 | Test source visible: every call injects mkdtemp lockDir; uncontended 0, live-holder exactly 5 printing pid, dead-pid reclaim via spawn+reap (never a guessed pid), no-process.exit regression. Attested pass. oracle-lock.ts itself truncated, so main()'s implementation is unseen. | 01KZR6RNBY9C8RER1PS0WP15PE (attested pass on declared command) |
| AC-OX-5 | 82 | Three attested passes on the declared command, including one from main. Service diff shows frontmatter_repaired/frontmatter_declined, undecidable-parse decline, and a decline path under body drift without --force. Test file truncated, so the throwaway-corpus and byte-identical-second-run claims res… | 01KZWMXYXADHEPPZWVN1Q2EQNQ (3 attested passes, drift line printed) |
| AC-OX-6 | 62 | Two attested passes on the declared command (latest from repo root, after the prune fix) against one attested fail on the same command. The AC is live-tree dependent and its pass is only as durable as the corpus state; the parse-count and --include-invalid clauses are unverifiable (test file trunca… | 01KZX0G3G9QJ0NCYGRRXAE59YF (pass after retireDeletedDocMappings landed), 01KZWMXYXADHEPPZWVN1Q2EQNQ (earlier attested fail: status_mismatch and orphan mapping) |
| AC-OX-7 | 76 | Attested expected-fail under the declared --git-common-dir→--git-dir falsifier (2 of 3 tests red) followed by attested passes from both a worktree and repo root. The test file is truncated, so the linked-worktree hermetic construction and the production-call (not reimplementation) claim are unseen. | 01M06XQ7J9M8HTQ3GXBCHHVGDV (falsifier red then green) |

## Gaps

- AC-OX-6 has both attested passes and an attested fail on the identical declared command. Its verdict is computed from live .lore/export-index.json and docs/requirements state, so a soft-delete or status transition elsewhere reds it with no code change. The passing run postdates retireDeletedDocMappings in packages/lore/src/service/export-docs-service.ts, but nothing in the trail shows the tree stays clean over time.
- scripts/tests/oracle-lock-checkout-scope.test.ts and scripts/oracle-lock.ts are both truncated from the diff, so the two load-bearing claims — that the EXPORTED resolveDefaultLockDir is CALLED rather than reimplemented, and that clause (b) compares main-checkout against a real linked worktree — rest solely on the falsifier red (2 of 3 tests failing) and the green tails. The red is meaningful but does not prove which clause failed.
- Attested evidence ratio is 0.35 across the bundle; several tasks record many self-reported runs against few attested ones (task 01KZR6RNBY9C8RER1PS0WP15PE: 2 attested vs 10 self-reported). AC-OX-1's read-only conversion in scripts/tests/spec-mirror-export.test.ts is truncated, so the absence of write-mode calls is known only from the command's own grep guard.
- The plan lists the G19 gap-ledger correction in knowledge-attestation-is-structurally-one-sided-lore-verify-can as orchestrator-owned and explicitly warns all ACs could land green with the mis-scoped entry surviving. No evidence record or diff hunk in this bundle shows that correction was made.

## Recommendations

- Split AC-OX-6 into a tree-state-independent structural assertion (mapping resolution logic, parse-count trace) and a separate live-corpus census that is explicitly re-verified at merge time, so a corpus drift elsewhere cannot invalidate a landed AC.
- Require the AC's own test file to be present in the reviewed diff whenever the AC's oracle is that file — or attach the file hash to the evidence record — so a truncated bundle cannot hide a vacuous oracle behind a green tail.
- Track the orchestrator-owned G19 gap-ledger correction as an explicit evidenced item rather than prose, since the plan itself notes all four ACs can land green while it survives.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 126674ms
- Retried: true
- Truncated sections: task:task-the-oracle-mutex-s-production-lock-path-has-no-oracle, task:task-the-two-mirror-exporters-disagree-because-drift-detection, diff:scripts/oracle-lock.ts, diff:packages/lore/tests/unit/repo-pollution-guard.bun.test.ts, diff:scripts/tests/spec-mirror-export.test.ts, diff:scripts/export-spec-mirror.ts, diff:scripts/tests/mirror-frontmatter-drift.test.ts, diff:scripts/tests/mirror-status-parity.test.ts, diff:.lore/export-index.json, diff:scripts/export-spec-mirror.ts, diff:scripts/tests/mirror-prune-retire-deleted-doc-mapping.test.ts, diff:.lore/export-index.json, diff:scripts/tests/oracle-lock-checkout-scope.test.ts
- Reasoning clipped for: AC-OX-1, AC-OX-5, AC-OX-6
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.7 | evidence | All seven ACs have attested passes on their declared commands; falsifier reds recorded for OX-1 and OX-7. OX-6 remains tree-state dependent and previously attested fail. |
| evidence_integrity | 68 | 0.65 | evidence | Real expected-fail/pass pairs and an honest inconclusive→revision on OX-2. But attested ratio 0.35, and OX-6 shows an attested fail on the same command as its passes. |
| scope_fidelity | 84 | 0.6 | evidence | No banned files touched; probes confined to mkdtemp and .scratch; full-suite ban respected. Export-docs-service changes exceed the original three dispatches but trace to adopted tasks. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-OX-6 | AC-OX-6 has both attested passes and an attested fail on the identical declared command. Its verdict is computed from live .lore/export-index.json and docs/requirements state, so a soft-delete or status transition elsewhere reds it with no code change. The passing run postdates retireDeletedDocMappings in packages/lore/src/service/export-docs-service.ts, but nothing in the trail shows the tree stays clean over time. |
| evidence_integrity | major | AC-OX-7 | scripts/tests/oracle-lock-checkout-scope.test.ts and scripts/oracle-lock.ts are both truncated from the diff, so the two load-bearing claims — that the EXPORTED resolveDefaultLockDir is CALLED rather than reimplemented, and that clause (b) compares main-checkout against a real linked worktree — rest solely on the falsifier red (2 of 3 tests failing) and the green tails. The red is meaningful but does not prove which clause failed. |
| evidence_integrity | minor | AC-OX-1 | Attested evidence ratio is 0.35 across the bundle; several tasks record many self-reported runs against few attested ones (task 01KZR6RNBY9C8RER1PS0WP15PE: 2 attested vs 10 self-reported). AC-OX-1's read-only conversion in scripts/tests/spec-mirror-export.test.ts is truncated, so the absence of write-mode calls is known only from the command's own grep guard. |
| scope_fidelity | minor | AC-OX-1 | The plan lists the G19 gap-ledger correction in knowledge-attestation-is-structurally-one-sided-lore-verify-can as orchestrator-owned and explicitly warns all ACs could land green with the mis-scoped entry surviving. No evidence record or diff hunk in this bundle shows that correction was made. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Split AC-OX-6 into a tree-state-independent structural assertion (mapping resolution logic, parse-count trace) and a separate live-corpus census that is explicitly re-verified at merge time, so a corpus drift elsewhere cannot invalidate a landed AC. | AC-OX-6 shows an attested fail and attested passes on the same command; its verdict tracks corpus state rather than the diff. |
| process | Require the AC's own test file to be present in the reviewed diff whenever the AC's oracle is that file — or attach the file hash to the evidence record — so a truncated bundle cannot hide a vacuous oracle behind a green tail. | Six test files including four ACs' primary oracles were unviewable; only exit codes could be judged. |
| plan | Track the orchestrator-owned G19 gap-ledger correction as an explicit evidenced item rather than prose, since the plan itself notes all four ACs can land green while it survives. | No evidence in the bundle shows the mis-scoped ledger entry was corrected. |

## Unverifiable Materials

- scripts/tests/oracle-lock-checkout-scope.test.ts: Truncated from the diff; the linked-worktree clause (b) and the production-call requirement cannot be inspected.
- scripts/oracle-lock.ts: Truncated; resolveDefaultLockDir's --git-common-dir shell-out and main()'s never-process.exit contract seen only via test output.
- scripts/tests/mirror-status-parity.test.ts: Truncated; the positive parse-count trace and the lore list --include-invalid population source cannot be confirmed.
- scripts/tests/mirror-frontmatter-drift.test.ts: Truncated; the throwaway corpus, body-only control, and byte-identical second run are known only from the pass tail.
- scripts/tests/spec-mirror-export.test.ts: Truncated; the --check conversion and seeded-drift RED case are visible only through evidence excerpts.
- G19 gap-ledger entry correction: Orchestrator-owned plan item with no corresponding diff hunk or evidence record in the bundle.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 6 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.35
