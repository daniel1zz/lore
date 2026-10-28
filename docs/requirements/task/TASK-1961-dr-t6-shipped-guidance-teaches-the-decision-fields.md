---
id: TASK-1961
type: task
role: plan
title: "DR-T6 shipped guidance teaches the decision fields"
status: archived
priority: medium
phase: "W"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-248
plan: PLAN-248
---
Dogfooding (ship the fix): agents now get exit 4 on non-draft writes without a decision, but no shipped guidance names the fields. Add one shipped launch fragment under assets/context/ (agents only) explaining when a write carries a decision (agent run, non-draft target, more than status; draft edits, status-only and human writes exempt), the flags --reason / --premise '<claim>|<source>|<tier>' / --alt / --gate / --score / --weight-table / --ref, the source syntax (file:<path>:<from>[-<to>][@<sha>], cmd:<command> ~ <expect>, issue:#<n>, doc:<slug>[@<v>]), the tiers S..E, the trivial rule-set cases, and the rule-set gate meaning-unchanged. Update the command table in assets/skills/lore-baseline/SKILL.md (rule set / rule add / propose rows) to show the decision flags. Regenerate the assets manifest. Oracle: lore fragments check exit 0 and the assets manifest check.
