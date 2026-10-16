---
id: KN-686
type: knowledge
role: knowledge
title: "Retro: compressing always-loaded fragments without losing rules (2026-10-16)"
status: approved
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: [fragments, content-tiers, evaluation, retro]
parent: PRD-001
links:
  - {id: PLAN-187, type: relates-to}
---
# Retro: compressing always-loaded fragments without losing rules (plan-always-loaded-lore-fragments-state-the-rule-only)

Result: the ten always-loaded fragments went from 14328 B to 11571 B (-19%); every AC has an attested pass on the final state; final assessment (knowledge-assessment-always-loaded-lore-fragments-state-the-7): outcome 82, scope_fidelity 86, evidence_integrity 72; AC-RW-1..5 = 92/85/82/90/70.

## What went wrong, in order
1. A byte ceiling (10000) was set before measuring; it forced rule cuts. Fix landed: lore-context-optimizer step 5 (measure last, no preset target).
2. "Rule only, never the reason" was too absolute; Anthropic's prompting guidance says a stated reason improves adherence. Fix landed: the CLAUDE.md contract allows one scope-setting reason clause; scope qualifiers are part of the rule.
3. The rule-preservation AC was one holistic rubric, first graded by the editing session itself (refuted three times). Fix landed: traceability table + mechanical KEPT check (AC-RW-3) + blind per-item grading of DROPPED by a different model, captured by `lore evidence --capture`, with a planted red control.
4. A traceability pass over-corrected and restored explanation; an independent grader's advisory list removed it.
5. Assessment scores varied by about 4 points between runs with no content change: chasing a judge score past the point of real findings does not converge.

## Open improvements (not done; deferred here)
- G1 Grader rubric drift: grade_prompt.py widens EXPLANATION ("consequence", "second reason") beyond the AC-RW-5 rubric. Align the prompt to the declared rubric text verbatim.
- G2 Red-control assertion: expected-fail is inferred from the absence of 'AC-RW-5 PASS'; assert the presence of 'AC-RW-5 FAIL: wd-ctrl' so a grader crash cannot pass as a control.
- G3 Grading scripts live in /tmp (verbatim copies in the plan body); move them into the repo with tests, or hash them in the evidence.
- G4 AC-RW-3 accepts a KEPT phrase that covers only part of its clause (ac-1h). Require the phrase to cover the clause, or mark partial keeps MERGED with the dropped part listed.
- G5 RE-BASELINE comments for execute and close in packages/lore/tests/unit/assets-ssot.test.ts still claim every instruction is kept; restate them as what each commit did.
- Tool gaps filed: #221 (absolute cd in AC commands defeats --falsify), #224 (a refuted pass row cannot be retracted), #195 (pre-claim task review always rejects), #196 (setup --check misses pending removals).
