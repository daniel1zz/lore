---
id: TASK-1810
type: task
role: plan
title: "Plan close reports cited rules whose state could not be measured instead of passing silently"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Source: review of baseline-close-a-plan, 2026-10-19 (design_necessity, class c). With the cited-rule check setting on (BR-984, BR-1304), a cited rule whose state is `unknown` (staleness could not be measured: no git history, git unavailable, a pass with no recorded commit, a dirty-tree pass, a spec with no code anchors — see rule-state-service.ts decideRule / UnknownReason) does not refuse the close and nothing reports it. The close therefore reads as "cited rules clean" when some were never measured — vacuously true indistinguishable from true.

End state: the close lists every cited rule whose state is unknown with its reason (the UnknownReason RuleStateService already computes), on the same advisory channel the not-applicable lines use (BR-1303), and the closed plan records which cited rules were unmeasured; whether an unknown state should instead refuse is decided per reason and stated in BR-984 (git-unavailable: refuse, it is a measurement failure; no-code-anchors: report, the spec chose no anchors). Restate BR-984 accordingly.

AC: red-first — closing a plan whose spec cites a rule with one unknown (no-code-anchors) input prints the unknown line naming the rule and reason; with git unavailable the close is refused naming the failed measurement. Falsifier: today's silent pass.
