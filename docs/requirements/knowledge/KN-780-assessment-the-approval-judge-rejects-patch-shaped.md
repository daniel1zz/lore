---
id: KN-780
type: knowledge
role: knowledge
title: "Assessment: The approval judge rejects patch-shaped designs (2026-10-18)"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-23
tags: []
parent: PLAN-209
links:
  - {id: PLAN-209, type: informs}
---
# Assessment: partially_met (66/100)

Scope: plan `01M57B10E7A3HE0GMPTEB9XMD1`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DN-1 | 62 | The diff adds the v4 rule for every doc type and freezes v1-v3 with a snapshot and boundary tests (14 passing). But the corrected AC wants v5 current with v4 frozen. The diff and test set v4 current and assert v5 undefined, so the passing evidence does not match the corrected statement. | 01M57B19ZPD6CS4WJCZVCNZ9CF (evidence [3],[8] pass; [1] expected-fail first) |
| AC-DN-2 | 88 | The default judged types now include plan. The integration test checks exit 4 naming review-judgment, that the plan stays draft, that [spec]-only exits 0, plus never-judged, approve-judgment and knowledge cases. Verified fail-then-pass. The post-write skipJudgmentGate fix is justified. | 01M57B19ZPD6CS4WJCZVCNZ9CF (evidence [2] expected-fail, [4],[9] pass) |
| AC-DN-3 | 45 | Manual and self-reported. The tail shows two rejects on design_necessity for the patch-shaped spec, but control-spec results are cut off and prompt=None, so v5 is unconfirmed. The end-state fixture in the diff still has the legacy_skip that the correction says was removed. | 01M57B19ZPD6CS4WJCZVCNZ9CF (evidence [7] manual, unattested) |

## Gaps

- packages/lore/src/ai/review-template.ts sets REVIEW_PROMPT_VERSION to v4, and packages/lore/tests/unit/ai/review-template-v4.test.ts asserts v4 is current and v5 is undefined. This contradicts the corrected AC (v5 current, v4 byte-frozen). No v4 frozen snapshot exists.
- The manual evidence tail shows only patch-shaped runs, with prompt=None. There is no output for the control fixture packages/lore/tests/fixtures/design-necessity/end-state-spec.md, so 'no design_necessity finding in either run' is unshown.
- packages/lore/tests/fixtures/design-necessity/end-state-spec.md still defines a legacy_skip outcome for files with no recorded owner. That is the transitional item the AC correction says was removed from the control.

## Recommendations

- Re-run the AC-DN-1 oracle after v5 lands. Record evidence that asserts v5 is current, v4 is byte-frozen against a snapshot, and v1-v3 are unchanged.
- Capture complete AC-DN-3 run logs (both fixtures, two runs each) with judge.prompt_version recorded, run against the corrected control fixture.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 34119ms
- Retried: false
- Truncated sections: diff:.claude/rules/lore-corpus-workflow-produce.md, diff:assets/context/corpus-workflow-2-produce.md, diff:packages/lore/tests/unit/service/gate-evaluation-trace.test.ts, diff:scripts/ac-oracle-not-built-ledger.json

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 68 | 0.6 | evidence | The v4 rule and default plan judging are delivered and tested. The v5-current state the corrected ACs require is not in the diff, and the control run is not shown. |
| evidence_integrity | 60 | 0.6 | evidence | Script ACs have fail-then-pass attested runs. AC-DN-1 evidence matches the old v4 statement, not the corrected one. The AC-DN-3 manual tail is truncated and its prompt version is None. |
| scope_fidelity | 80 | 0.65 | evidence | Changes match D1-D3, and the many test config tweaks are explained. The review-service post-gate change is outside the plan table but justified inline. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-DN-1 | packages/lore/src/ai/review-template.ts sets REVIEW_PROMPT_VERSION to v4, and packages/lore/tests/unit/ai/review-template-v4.test.ts asserts v4 is current and v5 is undefined. This contradicts the corrected AC (v5 current, v4 byte-frozen). No v4 frozen snapshot exists. |
| evidence_integrity | major | AC-DN-3 | The manual evidence tail shows only patch-shaped runs, with prompt=None. There is no output for the control fixture packages/lore/tests/fixtures/design-necessity/end-state-spec.md, so 'no design_necessity finding in either run' is unshown. |
| outcome | minor | AC-DN-3 | packages/lore/tests/fixtures/design-necessity/end-state-spec.md still defines a legacy_skip outcome for files with no recorded owner. That is the transitional item the AC correction says was removed from the control. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Re-run the AC-DN-1 oracle after v5 lands. Record evidence that asserts v5 is current, v4 is byte-frozen against a snapshot, and v1-v3 are unchanged. | Current evidence covers the pre-correction statement. |
| process | Capture complete AC-DN-3 run logs (both fixtures, two runs each) with judge.prompt_version recorded, run against the corrected control fixture. | AI-judge behaviour is the core claim and is only half-shown. |

## Unverifiable Materials

- v5 prompt builder and its test: Not in the diff, but AC-DN-1 and AC-DN-3 corrections depend on it.
- AC-DN-3 control fixture run output: The evidence tail is truncated before any end-state-spec result.
- packages/lore/tests/unit/service/gate-evaluation-trace.test.ts, assets/context/corpus-workflow-2-produce.md: Omitted from the diff for budget reasons.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.67
