---
id: KN-682
type: knowledge
role: knowledge
title: "Assessment: Move the six checkpoint-backed rules from always-loaded fragments into their skills (2026-10-15)"
status: archived
priority: medium
created: 2026-10-15
updated: 2026-10-23
tags: []
parent: PLAN-186
links:
  - {id: PLAN-186, type: informs}
---
# Assessment: met (81/100)

Scope: plan `01M4ZFTKN6HC1T7Z9P07NB6BR4`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RT-1 | 92 | Red recorded first ([1]) and lists all six phrases in context and missing from targets. Then 3 attested passes using the declared command. The diff shows six whole bullets removed verbatim and pasted into lore-plan mode-resume, lore-design, lore-autopilot and lore-implementer. The control rule stay… | task-skill-implement-move-the-six-checkpoint-backed-rules (evidence [1] expected-fail, [6][8][10] declared-command pass) |
| AC-RT-2 | 82 | 3 attested passes with the declared command show rules:project at 12717, under 14000. But the red was for the wrong reason: the original command skipped context init. The command was later fixed. The measured baseline (16518) does not match the spec's 'from 17396'. Regenerated .claude/rules diffs b… | task-skill-implement-move-the-six-checkpoint-backed-rules (evidence [2] wrong-reason red with corrected baseline note; [7][9][11] pass) |

## Gaps

- In assets/agents/lore-implementer.md the moved bullet and its 'Enforced by' heading sit inside the ⛔ list with no blank line before and two after, so the markdown structure is broken.

## Recommendations

- Before archiving the landing task, require attested evidence rows for full-suite and typecheck runs on main.
- Check that each AC's declared script fails for the intended reason before red is recorded. Fix the command through ac set --correction first.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 38634ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-RT-1, AC-RT-2

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.8 | evidence | All six bullets moved verbatim to the specified homes, the manifest was regenerated, and the consumer rules dropped to 12717 chars. Minor formatting issue in the implementer agent file. |
| scope_fidelity | 88 | 0.75 | evidence | Changes limit themselves to the fragments, target skills/agent, manifest, regenerated rules and the test re-baselines needed by the move. Each re-baseline is commented. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | — | In assets/agents/lore-implementer.md the moved bullet and its 'Enforced by' heading sit inside the ⛔ list with no blank line before and two after, so the markdown structure is broken. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Before archiving the landing task, require attested evidence rows for full-suite and typecheck runs on main. | The exit criteria cannot be checked from a single lore verify row. |
| spec | Check that each AC's declared script fails for the intended reason before red is recorded. Fix the command through ac set --correction first. | AC-RT-2's red proved only that setup was missing, not that the six rules were present. |

## Unverifiable Materials

- Full-suite and typecheck results on main after merge: No evidence row records them. The verify task holds only one lore verify run.
- Gate and checkpoint enforcement of each moved rule (risk R1 premise): The materials do not include the gate code or refusal packs, so the 'Enforced by' claims cannot be checked.
- evidence_integrity dimension score: based_on="absence" cited no matching unverifiable[]/judgment.truncated[] entry — suppressed as ungrounded rather than published as a finding.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 1
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 2 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.83
