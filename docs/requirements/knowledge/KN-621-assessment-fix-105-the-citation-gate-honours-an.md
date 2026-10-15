---
id: KN-621
type: knowledge
role: knowledge
title: "Assessment: Fix #105: the citation gate honours an active exemption on an uncited criterion (2026-10-10)"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-175
links:
  - {id: PLAN-175, type: informs}
---
# Assessment: partially_met (62/100)

Scope: plan `01M4HR7D39Y2ZSQMK73SP7CSHJ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-19 | 80 | Three attested passes for 5 integration tests plus 5 unit tests: an exemption admits, expired/absent/other-criterion ones refuse, expiry boundary covered. Red-before-green recorded. But RED assertion line 108 changed, the retired case also accepts VALIDATION_ERROR, and the AC statement is truncated… | 01M4HR7ZNJ0H8NXG1963F5AGM0 (evidence [1],[3],[4]), 01M4HR7Z9T21QXSB6X78QCJMT2 (RED evidence [1]) |
| AC-BLS2-2 | 85 | Attested vitest pass, 51 tests, run after the signature change. That includes the 5 new exemption unit tests and the existing mode x armed matrix. | 01M4HR7ZNJ0H8NXG1963F5AGM0 (evidence [2]) |
| AC-BLS2-3 | 85 | Attested pass of the race and in-tx tests after the change. The liveness re-check is untouched by the diff. | 01M4HR7ZNJ0H8NXG1963F5AGM0 (evidence [5]) |
| AC-BLS2-10 | 85 | Attested pass, 13 tests. Expiry in activeExemptedAcIds uses the same expires_at > now rule as the existing counts. | 01M4HR7ZNJ0H8NXG1963F5AGM0 (evidence [6]) |
| AC-BLS2-11 | 80 | Attested e2e rollback pass. However, admitAcWrite now reads exemptions before deciding, so with mode off a failed exemption read could turn into an error. Not visible whether mode off returns earlier. | 01M4HR7ZNJ0H8NXG1963F5AGM0 (evidence [7]) |
| AC-BLS2-1 | 15 | No evidence in this plan. Mitigation: outside the #105 fix scope, and the chokepoint routing is unchanged by the diff. | — |
| AC-BLS2-4 | 15 | No evidence. Mitigation: out of the fix's scope; no migration was touched. | — |
| AC-BLS2-5 | 15 | No evidence. Mitigation: out of scope. Census is unaffected unless the new error path adds a site, which can't be checked here. | — |
| AC-BLS2-6 | 15 | No evidence. Mitigation: out of scope; rule read/impact is untouched. | — |
| AC-BLS2-7 | 15 | No evidence. Mitigation: out of scope; the feed is untouched. | — |
| AC-BLS2-8 | 15 | No evidence. Mitigation: out of scope. | — |
| AC-BLS2-9 | 15 | No evidence. Mitigation: out of scope. | — |
| AC-BLS2-12 | 15 | No evidence. Mitigation: out of scope. A new listAcExemptions refusal path could affect census coverage, but this was not checked. | — |
| AC-BLS2-13 | 15 | No assessment record. Mitigation: out of scope, though the fix enables cite removals that item (4) allows. | — |
| AC-BLS2-14 | 10 | Plan task 3 (remove the 8 cites, re-run with a new seed) has no evidence. This is the AC the fix was meant to unblock, and it is still unevidenced. | — |
| AC-BLS2-15 | 15 | No evidence. Mitigation: out of scope. | — |
| AC-BLS2-16 | 15 | No evidence. Mitigation: out of scope. The 'cited or exempted' item becomes enforceable through this fix. | — |
| AC-BLS2-17 | 15 | No evidence. Mitigation: out of scope. | — |
| AC-BLS2-18 | 15 | No evidence, and the statement is truncated in the materials. Mitigation: out of scope. | — |

## Gaps

- Plan task 3 (remove the 8 unfaithful cites under enforce, re-run the AC-BLS2-14 sample with a new seed) has no evidence. The goal the fix was built for is not shown as achieved.
- The RED evidence shows expect(r.ok).toBe(true) at line 108, but the final packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts uses expect(r.ok ? "ok" : r.error.code).toBe("ok"). The assertion was edited after red, contrary to 'without touching the test assertions'. The two are semantically equivalent.
- The retired-cite case in packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts accepts VALIDATION_ERROR, so it does not prove the gate itself refuses an exempted criterion with a retired cite. The unit test in packages/lore/tests/unit/service/cite-gate.test.ts covers this only at the pure level.
- packages/lore/src/service/ac-write-chokepoint.ts now calls listAcExemptions before decideCiteGate, possibly even when mode is off. A failed exemption read could then refuse writes the gate should not affect.

## Recommendations

- Make the post-merge orchestrator steps (lore verify, the 8 cite removals, the AC-BLS2-14 re-run) recorded evidence before archiving the plan.
- Tell the implementer that any test edit after the RED evidence, even a cosmetic one, must be declared and the RED evidence re-recorded.
- Include the AC-BLS2-19 statement in the spec materials handed to the assessor.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 45479ms
- Retried: false
- Truncated sections: spec
- Reasoning clipped for: AC-BLS2-19

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.7 | evidence | Core fix delivered and tested, with the exemption waiving only the uncited case. Downstream goal (removing the 8 cites, re-running AC-BLS2-14) has no evidence. |
| evidence_integrity | 72 | 0.65 | evidence | Red-before-green recorded and most runs attested (0.80). RED assertion text changed afterwards; typecheck is self-reported with no tail. |
| scope_fidelity | 85 | 0.75 | evidence | Diff is limited to the gate, the chokepoint and tests, matching the plan. The only drift is the reworded test assertion. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-BLS2-14 | Plan task 3 (remove the 8 unfaithful cites under enforce, re-run the AC-BLS2-14 sample with a new seed) has no evidence. The goal the fix was built for is not shown as achieved. |
| evidence_integrity | minor | AC-BLS2-19 | The RED evidence shows expect(r.ok).toBe(true) at line 108, but the final packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts uses expect(r.ok ? "ok" : r.error.code).toBe("ok"). The assertion was edited after red, contrary to 'without touching the test assertions'. The two are semantically equivalent. |
| outcome | minor | AC-BLS2-19 | The retired-cite case in packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts accepts VALIDATION_ERROR, so it does not prove the gate itself refuses an exempted criterion with a retired cite. The unit test in packages/lore/tests/unit/service/cite-gate.test.ts covers this only at the pure level. |
| outcome | minor | AC-BLS2-11 | packages/lore/src/service/ac-write-chokepoint.ts now calls listAcExemptions before decideCiteGate, possibly even when mode is off. A failed exemption read could then refuse writes the gate should not affect. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Make the post-merge orchestrator steps (lore verify, the 8 cite removals, the AC-BLS2-14 re-run) recorded evidence before archiving the plan. | The plan's goal depends on those steps, and none are evidenced. |
| prompt | Tell the implementer that any test edit after the RED evidence, even a cosmetic one, must be declared and the RED evidence re-recorded. | Keeps the red-before-green integrity claim verifiable. |
| spec | Include the AC-BLS2-19 statement in the spec materials handed to the assessor. | AC-BLS2-19 could not be judged against its own text because it was truncated. |

## Unverifiable Materials

- AC-BLS2-19 statement text: The spec AC table is truncated at AC-BLS2-18.
- BR-959 / BR-257 rule documents: No evidence of creation or narrowing is in the materials.
- admitAcWrite code before the exemption read (mode-off early return): Not shown in the diff hunk.
- typecheck output: Evidence [8] has no visible output tail and is self-reported.
- GATE_MODULE definition in cite-gate.test.ts: Referenced by the new tests but not shown in the diff.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 19 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.80
