---
id: KN-655
type: knowledge
role: knowledge
title: "Pilot assessment: baseline slice 1 specification branch (AC-BLS1-11) — FAIL on both kill lines"
status: archived
priority: medium
created: 2026-10-07
updated: 2026-10-23
tags: [baseline, pilot, assessment]
parent: PLAN-172
links:
  - {id: KN-565, type: relates-to}
  - {id: PLAN-172, type: informs}
---
# Pilot assessment — baseline slice 1, specification branch (AC-BLS1-11)

Plan: plan-baseline-slice-1-rules-citations-rule-state-specification. Spec: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations. Owner delegated all approvals (session 6b85319e); every bar below was fixed before the measurement it judges and none was moved.

## Verdict: FAIL on both kill lines — slice 2 is NOT entered

| Kill line (pre-registered) | Measured | Verdict |
|---|---|---|
| Adjudicated mapping disagreements ≤ 30% of the branch's ACs | 42 / 85 = **49.4%** (post-hoc lenient reading 32.9%, still above) | ❌ fired |
| Blind reader ≥ 9/10 with 0 confident-wrong, on a probe set frozen before the leaves | **8/10, 2 confident-wrong** (Q3, Q7) | ❌ fired |
| Probe set created before every baseline doc | probe 2026-10-07T13:00:21.794Z < first baseline 2026-10-07T14:33:02.943Z | ✅ precondition held |

Records: `knowledge-pilot-probe-set-frozen-specification-acceptance` (probe set), `knowledge-pilot-specification-branch-build-log-draft-rule-to-br` (95 rules, mapping, per-rule verification), `knowledge-pilot-d3-specification-branch-ac-mapping-adjudication` (mappings, adjudication, 15 citations).

## Why it failed (root causes, not symptoms)

1. **Excavated rules inherit the documentation's errors.** Both confident-wrong answers trace to baseline content, not the reader: BR-73 states "minimum 0 criteria for a domain overview", copied from misleading prose in the kind definitions, while the code's default floor is 1 (the spec-promote gate refuses); and no rule states that ANY digit in the text counts as a measurable anchor (BR-18 area), so "Section 3 is simple and elegant" passes the wording lint. The rules were re-verified by an agent with code access — and still carried a prose-vs-code error. Excavation by reading is not a sufficient oracle for a rule's truth; BL-13 (truth computed from citing executable ACs) is the mechanism that would catch this, and at the time of the probe 83 of 95 rules had no citing AC at all (rules_uncovered 83).
2. **No written placement principle for "which branch owns this AC".** 14 of 42 disagreements were branch-boundary ambiguity (specification vs execution / CLI layer); one mapper placed by topic, the other separated "the rule" from "the implementation of the rule". The ADR left the boundary between branches to judgment, and judgment is not reproducible (A1, A4, A5 and now D3 all land near 50–66% agreement).
3. **The branch is cut too narrow for the specs that touch it.** 56 of 85 ACs of "specification" specs assert behaviour of other branches; 14 assert specification behaviour no rule states (task-level AC scope ×8, checkpoint reachability, evidence capture guard, status enumerators, gate audit trail, assess prompt composition). One populated branch cannot absorb the citations of specs that span several.

## Comparison with the earlier experiment

A3 (fresh baseline vs aged corpus, different probe set): baseline 10/10 vs corpus 8/10. This pilot (independent probe set frozen before the leaves; leaves built by a different agent): baseline 8/10 with 2 confident-wrong — the same score the aged corpus had in A3. The A2/A3 advantage did not replicate under the hardened protocol.

## What this does NOT show

- It does not refute the two-tree model or permanent rule ids (QA-1..8 hold, AC-BLS1-1..9 attested).
- It does not test BL-13 in steady state: with 83/95 rules uncovered, evidence-computed truth had nothing to compute from.
- n = 1 branch, 10 probes, 85 ACs.

## Recommendations (for the owner — not executed)

1. Do not start slice 2 (all branches + enforcing gate) on the current migration method.
2. Write the placement principle first (e.g. "an AC belongs to the branch whose RULE it falsifies; tests of CLI/rendering/plumbing belong to the architecture tree"), then re-measure agreement on a NEW population.
3. Make rule truth mechanical before trusting excavated rules: require each new rule to be cited by ≥ 1 executable AC (or carry `observed` + an open question) — BL-13 then catches prose-vs-code errors like BR-73.
4. Re-probe only with a NEW frozen probe set; re-running the same 10 questions after fixing BR-73/BR-18 would be teaching to the test.
5. Fix BR-73 and add the digit-anchor rule now (content defects), recorded as such — not as a pilot pass.


## Correction (2026-10-08, pilot v2 task V1b) — root cause 1 is half wrong
Re-checked during pilot v2 against the leaf history and code; the verdicts above (both kill lines fired) are unchanged, but the attribution of the two confident-wrong answers is corrected:
- **Q3 / BR-73 was NOT a content defect.** BR-73 has read, unchanged since creation (`lore log baseline-approve-a-spec`: no rule edit after v11): "A spec kind's minimum may be set to zero, which waives the requirement. A kind with no minimum set requires one." The leaf's Current values row says "New project: 1 for every kind". Both agree with code (`gate-predicates.ts` default floor 1; verified by pilot v2's citation pass with 3 citing tests, e.g. `oracle-coverage-gate.test.ts:260`). The blind reader answered "in a fresh project domain overview has minimum 0 (BR-73)" — a misreading of correct content. The statement above that BR-73 "states minimum 0 criteria for a domain overview, copied from misleading prose" is false.
- **Q7 / digit anchor was half a content defect.** The branch glossary already defines "Measurable anchor: Any digit, comparison sign, percentile marker or unit in a statement. Its presence anywhere counts." No RULE states it, so the reader, who answered from rules, missed it. Fix: promote it to a rule (pilot v2 V1b).
- **Consequence for the diagnosis**: one of the two confident-wrong answers was reader error on correct content. A baseline whose content is right can still fail the blind bar; content correctness and reader comprehension are separate causes, and only the second v1 answer supports "excavated rules inherit documentation errors". The citation pass of pilot v2 did find 5 rules genuinely contradicted by code (BR-5, BR-11, BR-71, BR-74, BR-90), so the root cause still stands — on different evidence than Q3.
