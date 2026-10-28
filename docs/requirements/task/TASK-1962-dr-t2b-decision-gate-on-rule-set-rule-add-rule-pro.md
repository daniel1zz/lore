---
id: TASK-1962
type: task
role: plan
title: "DR-T2b decision gate on rule set, rule add, rule propose and the criterion writes"
status: archived
priority: medium
phase: "W"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-248
plan: PLAN-248
links:
  - {id: TASK-1960, type: blocks}
  - {id: TASK-1961, type: blocks}
---
AC-DR-4, AC-DR-5. Plan T2b. Wire decision-gate into RuleService.setRule (trivial check; confidence raise refused; meaning-unchanged required; computed gate evidence-s-to-c; before stored), RuleService.addRule, RuleChangeService.propose (non-draft spec only), AcService add/set/rm, supersede, cite (RuleCitationService), exempt (AcExemptionService); CLI flags on rule and ac. No file under packages/lore/src/adapters/mcp/ is changed: MCP lore_rule_set and lore_rule_add are refused through the same services, asserted from a test file outside src/adapters/mcp.
