---
id: TASK-1847
type: task
role: plan
title: "plan-close stale-rule refusal names the stale citing criterion and the command that clears it"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Finding (2026-10-19): closing plan-batch-baseline-map-one-version-per-leaf-per-mapping-round was refused with CITED_RULE_REFUTED, "Offending rules: BR-654 (stale), BR-658 (stale)", and the rule text "stale with no attested pass recorded by this plan's tasks since it went stale". That text is false: this plan's own task had just recorded attested passes (AC-BMB-1..3 at HEAD). The actual cause, found only by reading rule-state-service.ts decideRule (any stale input makes the rule stale) was a DIFFERENT spec's criteria (AC-SMM-1/2 of spec-site-map-maintenance-keeps-a-leaf-s-approval-an-owned-by) whose last pass predates a change to its anchored code. BR-984 states the real behaviour ("its citing spec's code changed after the latest attested pass, by any plan"); the gate message (checkpoint-registry.ts ~1940) and the citedRuleStateClean doc comment (gate-predicates.ts ~1608, "a later pass makes the rule verified") contradict it.

End state: the refusal is self-sufficient. For each offending rule it names every stale input — the citing spec, criterion id, the sha of its latest attested pass, and the anchored paths changed since — plus the command that clears it (`lore verify <that criterion's plan> --task <its task>`); contradicted inputs name the failing run the same way. The rule text and the doc comment state BR-984 exactly (stale by any citing spec's criterion, not only this plan's). The data comes from RuleStateService (expose the per-input verdict it already computes), never re-derived in the gate.

AC: a plan-close test with two specs citing one rule — spec A's criterion passed at HEAD, spec B's criterion passed before a change to B's anchored file — asserts exit 4, the message names spec B's criterion id, its pass sha, the changed path and the verify command, and does not name spec A's criterion; falsifier: the current message (rule ids only).
