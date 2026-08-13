---
id: KN-024
type: knowledge
role: knowledge
title: "Assess material-budget distortion on multi-task plan diffs"
status: approved
priority: medium
created: 2026-07-06
updated: 2026-07-08
tags: [assess, calibration, feedback-loop, spec-026, spec-037-input]
parent: PRD-001
---
## Finding (2026-07-06, 3 consecutive occurrences)

LLM-as-judge assessments of multi-task plans systematically under-score when the git diff exceeds ai.assess.max_diff_chars (80k configured; SPEC-032/034/035 closeout diffs all exceeded it). Truncated files get scored as 'absent from the deliverable' — the judge conflates 'clipped from my context' with 'missing from the change set', depressing AC scores by 30-50 points (SPEC-032: AC-2 scored 48 while check-tree passed live; SPEC-034: 67/100 with every service file called absent; SPEC-035: 63/100 same class).

Cross-validation: the SPEC-034 lore review judgment on the SPEC-032 assessment CAUGHT this exact distortion unaided (escalate 0.74 citing 'Truncated sections list contradicts the absent claims') — the review loop already detects the assess loop's failure mode.

## Implications (SPEC-037/038 input)
1. Assess per-task diffs (small, complete) instead of whole-plan diffs (large, truncated) — or teach the judge prompt that 'truncated: diff:<file>' entries mean PRESENT-but-clipped, never absent.
2. Judge prompt v-next candidate: explicit instruction to score truncated files as unverifiable-not-missing, and cap the penalty.
3. Calibration data now records these as human-overridden judgments — first real prompt-iteration signal for SPEC-038.
