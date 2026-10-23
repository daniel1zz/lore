---
id: KN-750
type: knowledge
role: knowledge
title: "Assessment: Issues on GitHub, tasks execute: shipped close guidance and root CLAUDE.md (2026-10-20)"
status: archived
priority: medium
created: 2026-10-20
updated: 2026-10-23
tags: []
parent: PLAN-215
links:
  - {id: PLAN-215, type: informs}
---
# Assessment: met (87/100)

Scope: plan `01M5ABCK40HR87P8XP7N6B6YCA`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-IGH-1 | 90 | The final fragment bullet has all five required phrases and neither forbidden one. The compiled rules file and the fragment-variables fixture were updated to hash 7c7e6c3e. Red-first runs ([1],[8]) are followed by attested passes, the last ([23]) at the repo root. The red mutation is shown by test … | task-igh-t1-close-guidance-and-root-claude-md-file-every (evidence [1] expected-fail, [9] pass, [23] pass at repo root) |
| AC-IGH-2 | 88 | The Dogfooding line in CLAUDE.md now contains 'file it as an issue' and 'a task names the issues it resolves'. The 'Never `lore report-issue`' line is removed. Red ([2]) then pass ([3],[10],[24]). Minor gap: CLAUDE.md routes every problem through `lore report-issue`, while the fragment sends non-lo… | task-igh-t1-close-guidance-and-root-claude-md-file-every (evidence [2] expected-fail, [24] pass) |

## Gaps

- packages/lore/tests/unit/context/issue-channel-guidance.test.ts adds test AC-IGH-1(a2). It pins wording ('this project's own issue tracker', 'never through `lore report-issue`') that the spec's AC-IGH-1 statement does not require. No spec amendment is visible.
- CLAUDE.md sends every unfixed problem to `lore report-issue`. assets/context/corpus-workflow-4-close.md sends non-lore problems to the project's own tracker and says never through `lore report-issue`. The two agree only because lore's own repository is both targets.

## Recommendations

- Add the route-separation requirement to the spec as an AC, or remove test AC-IGH-1(a2) so the tests match the spec's ACs.
- Record a run of the declared smallest red mutation as attested expected-fail evidence before verify.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 27957ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-IGH-1, AC-IGH-2

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 90 | 0.85 | evidence | Every required phrase and exclusion is in the final fragment, compiled rules and CLAUDE.md. Hash pins were re-baselined with notes. One small difference in routing between CLAUDE.md and the fragment. |
| evidence_integrity | 88 | 0.8 | evidence | All 24 records are attested. Red-first runs come before the passes. Final passes were run at the repo root. The mutation probe was not run directly. |
| scope_fidelity | 80 | 0.7 | evidence | Changes stay on the declared anchors. A later revision added route-separation wording and test a2 that go beyond the AC text, without a visible spec change. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | minor | AC-IGH-1 | packages/lore/tests/unit/context/issue-channel-guidance.test.ts adds test AC-IGH-1(a2). It pins wording ('this project's own issue tracker', 'never through `lore report-issue`') that the spec's AC-IGH-1 statement does not require. No spec amendment is visible. |
| outcome | minor | AC-IGH-2 | CLAUDE.md sends every unfixed problem to `lore report-issue`. assets/context/corpus-workflow-4-close.md sends non-lore problems to the project's own tracker and says never through `lore report-issue`. The two agree only because lore's own repository is both targets. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Add the route-separation requirement to the spec as an AC, or remove test AC-IGH-1(a2) so the tests match the spec's ACs. | Right now the tests pin wording the spec never asked for. |
| plan | Record a run of the declared smallest red mutation as attested expected-fail evidence before verify. | This would show directly that the test catches the mutation, instead of relying on reading the code. |

## Unverifiable Materials

- Post-landing lore commands (done, ac supersede, verify, rule apply): The materials show no output or state for these required steps.
- Spec BR-1153 modified text (lore rule changes): The rule text is not provided, so I cannot check whether the extra a2 wording comes from the spec.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 2 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
