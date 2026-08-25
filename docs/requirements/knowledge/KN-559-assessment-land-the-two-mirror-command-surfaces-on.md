---
id: KN-559
type: knowledge
role: knowledge
title: "Assessment: Land the two mirror command surfaces: one row contract for list --json, a real argv parser for export-spec-mirror (2026-08-25)"
status: approved
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PLAN-148
links:
  - {id: PLAN-148, type: informs}
---
# Assessment: met (87/100)

Scope: plan `01M0VYB79DQ7K7HXKPPYPV8XYS`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-MOS-1 | 87 | 6 attested passes with the AC's exact command; two separate expected-fail probes (wide-emit revert, and the --governed-by-only revert that closed the oracle blind spot). Visible test source asserts pinned.size).toBe(5) — a COUNT — where the AC demands label-set EQUALITY; final file version not show… | task-one-row-contract-for-every-lore-list-json-emit-branch (initial contract + red probe), task-ac-mos-1-s-oracle-cannot-see-the-sixth-emit-branch-cover (governed-by gap closed, attributable red) |
| AC-MOS-2 | 92 | 2 attested passes under the consumer's own 20MB cap; dedicated expected-fail row shows status null / SIGTERM / ENOBUFS, distinct from AC-MOS-1's probe as the plan required. Visible suite asserts status/signal/error separately, >=400 row floor, closed key set, no byte threshold, read-only verb guard. | task-one-row-contract-for-every-lore-list-json-emit-branch (rows [2] and [4]/[6]) |
| AC-MOS-3 | 90 | 2 attested passes; expected-fail from removing the refusal branch shows 'expected 2 to be 3'. Visible suite imports the usage constant via a bun subprocess (never a literal), asserts inequality vs 0/drift/hard, keeps the --check green control, and adds an empty-stdout regression on the pre-fix invo… | task-a-real-argv-parser-for-export-spec-mirror-unknown-flags (rows [1], [6], [9]) |
| AC-MOS-4 | 87 | 2 attested passes plus the two required direction probes recorded separately: narrow path skipping the seeded type (b fails) and --type made inert (c fails). Test file itself not shown, so throwaway-corpus isolation and absence of wall-clock assertions rest on task text alone. | task-a-real-argv-parser-for-export-spec-mirror-unknown-flags (rows [2],[3],[4] red; [7],[10] green) |
| AC-MOS-5 | 85 | Vacuously green by the spec's own disclosure; the delivered guard is correctly labelled as a regression guard in the visible file header, uses fixed-string equality with a containment counter-demo, and a package.json mutation probe was recorded. Not banked as AC-MOS-3/4 coverage. | task-a-real-argv-parser-for-export-spec-mirror-unknown-flags (rows [5],[8],[11]) |
| AC-MOS-6 | 84 | 2 attested passes; expected-fail probe applies the exact named asymmetry and the tail shows the (b) pruned-path assertion failing. That (c) still passed — the attributability requirement — is asserted in prose but not visible in the recorded tail, and the test file is not shown. | task-a-narrowed-export-must-never-delete-another-type-s-mirror (rows [1] red, [2],[3] green) |

## Gaps

- The plan required an attested expected-fail per criterion, but the completeness facts show every attested row is a pass (16 attested passes) while all 8 mutation-probe rows are self-reported. The reds carry real output tails, so they are substantiated, but none is runner-observed — the exact 'demonstrated discriminating power' the plan said must not be taken on trust.
- AC-MOS-1 requires the captured label set to be asserted by EQUALITY and never by count. The visible packages/lore/tests/integration/list-json-row-contract.test.ts asserts expect(fixtureA.pinned.size).toBe(5), a count, and includes `--type task --plan-id` (which the AC states does not reach the --plan-id site) among the pinned five; the bare --plan-id and --governed-by sites are covered by separate cases in fixture B instead.
- AC-MOS-6's mutation is only attributable if conjuncts (a)/(b) go red while (c) still passes. The recorded expected-fail tail for scripts/tests/export-spec-mirror-narrowed-prune-scope.test.ts shows the pruned-path assertion failing but does not show (c)'s result, so attributability is asserted in the task text rather than evidenced.
- The diff includes .lore/export-index.json (listed twice in the truncation manifest), a generated corpus artifact outside the file anchors both tasks declared ('your only tracked changes are ...'). Benign if it is lore bookkeeping, but it was not named in either task's finish check.

## Recommendations

- Define a supported way to attest a mutation probe (e.g. run the AC command under the runner with the scratch mutation applied and record the observed exit code) so expected-fail rows are not structurally forced into self-reported status.
- For AC-MOS-1, state the six invocation labels as an explicit expected array so the oracle's set equality is mechanically checkable, and drop `--type task --plan-id` from the pinned list since the AC already records it as absorbed.
- Require the control-still-green line in the recorded output tail whenever an AC names a positive control inside the same probe run.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 93000ms
- Retried: false
- Truncated sections: task:task-a-narrowed-export-must-never-delete-another-type-s-mirror, task:task-a-real-argv-parser-for-export-spec-mirror-unknown-flags, diff:.lore/export-index.json, diff:packages/lore/tests/integration/list-json-row-contract.test.ts, diff:scripts/export-spec-mirror.ts, diff:scripts/tests/export-spec-mirror-type-scope.test.ts, diff:.lore/export-index.json, diff:scripts/tests/export-spec-mirror-narrowed-prune-scope.test.ts
- Reasoning clipped for: AC-MOS-1, AC-MOS-3
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.8 | evidence | All six ACs have attested passes on their exact commands; visible list.ts routes every --json emit site through toListJsonRows via the SSOT deriveTypeMeta, with meta absent-iff-underivable. |
| evidence_integrity | 80 | 0.75 | evidence | All 16 passes attested with matching echo strings; mutation reds recorded per criterion with real tails, but every red is self-reported (ratio 0.68) and one red's control-still-green claim is not in … |
| scope_fidelity | 88 | 0.7 | evidence | Anchors stayed disjoint, AC-FR-6/7 untouched, AC-MOS-5 correctly not banked as delivered work. Diff carries generated .lore/export-index.json churn beyond the declared file set. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The plan required an attested expected-fail per criterion, but the completeness facts show every attested row is a pass (16 attested passes) while all 8 mutation-probe rows are self-reported. The reds carry real output tails, so they are substantiated, but none is runner-observed — the exact 'demonstrated discriminating power' the plan said must not be taken on trust. |
| outcome | minor | AC-MOS-1 | AC-MOS-1 requires the captured label set to be asserted by EQUALITY and never by count. The visible packages/lore/tests/integration/list-json-row-contract.test.ts asserts expect(fixtureA.pinned.size).toBe(5), a count, and includes `--type task --plan-id` (which the AC states does not reach the --plan-id site) among the pinned five; the bare --plan-id and --governed-by sites are covered by separate cases in fixture B instead. |
| evidence_integrity | minor | AC-MOS-6 | AC-MOS-6's mutation is only attributable if conjuncts (a)/(b) go red while (c) still passes. The recorded expected-fail tail for scripts/tests/export-spec-mirror-narrowed-prune-scope.test.ts shows the pruned-path assertion failing but does not show (c)'s result, so attributability is asserted in the task text rather than evidenced. |
| scope_fidelity | minor | — | The diff includes .lore/export-index.json (listed twice in the truncation manifest), a generated corpus artifact outside the file anchors both tasks declared ('your only tracked changes are ...'). Benign if it is lore bookkeeping, but it was not named in either task's finish check. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Define a supported way to attest a mutation probe (e.g. run the AC command under the runner with the scratch mutation applied and record the observed exit code) so expected-fail rows are not structurally forced into self-reported status. | All 8 reds in this plan are self-reported while the plan's central deliverable was the attested red. |
| spec | For AC-MOS-1, state the six invocation labels as an explicit expected array so the oracle's set equality is mechanically checkable, and drop `--type task --plan-id` from the pinned list since the AC already records it as absorbed. | The delivered suite guards the label set by count, the one form the AC forbids. |
| process | Require the control-still-green line in the recorded output tail whenever an AC names a positive control inside the same probe run. | AC-MOS-6's attributability requirement is unverifiable from its recorded tail. |

## Unverifiable Materials

- Final content of packages/lore/tests/integration/list-json-row-contract.test.ts (16-test version): Listed as omitted in the truncation manifest; the shown source corresponds to the 13-test state, so the label-set-equality and seeded spec/adr/prd discriminant assertions cannot be inspected.
- scripts/tests/export-spec-mirror-type-scope.test.ts: Omitted from the diff; throwaway-corpus isolation and the absence of wall-clock assertions rest on task text plus green output tails.
- scripts/tests/export-spec-mirror-narrowed-prune-scope.test.ts and scripts/export-spec-mirror.ts: Omitted from the diff; the per-directory (not aggregate) equality, the prune-path narrowing, and the argv parser implementation could not be read.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.68
