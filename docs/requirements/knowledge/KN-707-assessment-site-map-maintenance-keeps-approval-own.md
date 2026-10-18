---
id: KN-707
type: knowledge
role: knowledge
title: "Assessment: Site-map maintenance keeps approval; owned-by is checked (2026-10-18)"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
---
# Assessment: met (83/100)

Scope: plan `01M56QDF2THS8QMACC8C7Q8A88`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-SMM-1 | 88 | Run [7] passes 7 tests: site set/remove keeps the leaf approved with +1 version and +1 baseline-map audit row; command add, remove, or add-with-sites demotes. The failure in run [4] was a stale-binary startup error after the tests had passed, not a test failure. Only InMemoryStore is used. | 01M56QDQKDBZXF82QQQBQQBY9V (evidence [1] expected-fail, [4] startup-error fail, [7] pass) |
| AC-SMM-2 | 82 | Run [8] passes 13 tests covering every refusal case (unknown node, branch, self by slug and id, no BR id, retired, other-leaf rule, dash variants, blank reason) with no version written; acceptance by slug and id; owned-bye is unaffected. VALIDATION_ERROR is asserted only at service level; CLI exit … | 01M56QDQKDBZXF82QQQBQQBY9V (evidence [5],[8] pass) |
| AC-SMM-3 | 80 | Run [9] passes 9 pure tests: retired, moved, deleted or renamed owner, branch owner, and partial-retired entries are gaps; a live entry is not; a missing lookup counts as a gap. Only the CLI runCoverage caller passes ownerLeaves. Other computeLeafCoverage callers, if any, would now silently treat v… | 01M56QDQKDBZXF82QQQBQQBY9V (evidence [6],[9] pass) |

## Gaps

- Only packages/lore/src/adapters/cli/commands/baseline.ts passes ownerLeaves into computeLeafCoverage. With no lookup, packages/lore/src/service/leaf-coverage.ts treats every owned-by entry as a gap, so any other caller would report false gaps. The diff does not show whether other callers exist.
- packages/lore/tests/unit/service/site-map-owned-by-write.test.ts asserts VALIDATION_ERROR at the service level only. The AC requires CLI exit 4, which no test checks.
- The plan's P1 and Close steps (lore verify on main, bun run build, lore rule apply, lore assess) have no recorded evidence.
- In packages/lore/src/service/rule-service.ts, ownerLeaves is computed before retryWrite. A CAS retry therefore judges owned-by entries against a pre-retry snapshot.

## Recommendations

- Add a step that lists every computeLeafCoverage caller and confirms each passes ownerLeaves.
- Give exit-code ACs a CLI-level verify script, not only service unit tests.
- Run AC scripts against a fresh build so the stale-binary global setup cannot fail a passing run.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 33586ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-SMM-2, AC-SMM-3

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | The diff implements all three mechanisms, and the tests cover the AC cases. Exit-code checks and other coverage callers are unverified. |
| evidence_integrity | 78 | 0.7 | evidence | Red-first evidence [1], green runs and tsc are attested. One AC-1 run failed on a stale-binary startup error. Plan close steps (verify, build, rule apply) have no evidence. |
| scope_fidelity | 88 | 0.65 | evidence | keepsApproval applies only to setSiteMap; other demotion paths keep the default false. Coverage stays read-only. Changes are confined to the planned files. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-SMM-3 | Only packages/lore/src/adapters/cli/commands/baseline.ts passes ownerLeaves into computeLeafCoverage. With no lookup, packages/lore/src/service/leaf-coverage.ts treats every owned-by entry as a gap, so any other caller would report false gaps. The diff does not show whether other callers exist. |
| outcome | minor | AC-SMM-2 | packages/lore/tests/unit/service/site-map-owned-by-write.test.ts asserts VALIDATION_ERROR at the service level only. The AC requires CLI exit 4, which no test checks. |
| evidence_integrity | minor | — | The plan's P1 and Close steps (lore verify on main, bun run build, lore rule apply, lore assess) have no recorded evidence. |
| outcome | minor | — | In packages/lore/src/service/rule-service.ts, ownerLeaves is computed before retryWrite. A CAS retry therefore judges owned-by entries against a pre-retry snapshot. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a step that lists every computeLeafCoverage caller and confirms each passes ownerLeaves. | Making the lookup optional means callers that omit it silently turn owned-by entries into gaps. |
| spec | Give exit-code ACs a CLI-level verify script, not only service unit tests. | AC-SMM-2 names exit 4, but the evidence never exercises the CLI. |
| process | Run AC scripts against a fresh build so the stale-binary global setup cannot fail a passing run. | Evidence [4] recorded a false fail. |

## Unverifiable Materials

- Other computeLeafCoverage callers in the codebase: Only the diff is visible, so it can't be confirmed that baseline.ts runCoverage is the sole caller.
- listBaselineDocs and all.value contents (whether deleted docs are excluded): These implementations aren't shown; the deleted-owner judgment depends on them.
- lore verify / build / rule apply / assess outputs: No evidence was recorded for the plan close steps.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.89
