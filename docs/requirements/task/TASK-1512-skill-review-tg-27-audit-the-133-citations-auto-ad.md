---
id: TASK-1512
type: task
role: plan
title: "[Skill:review] TG-27 audit the 133 citations auto-added by the T23 AC repoint"
status: draft
priority: high
phase: "Phase 3b: one runner"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: T23 repointed 322 AC commands; 131 of them (plus 2 with AS-7) got the citation gate's first suggested BR because the gate refused command-only corrections without one (records: /private/tmp/claude-501/-Users-apple-Projects-zz-lore/c1ffea04-89c5-46f4-8bb9-0d10906f3f65/scratchpad/tg23/batch.log and batch2.log, lines with cites=[...]). A 6-item sample: 2 relevant, 4 not. For each auto-added cite: read the AC statement and the rule (lore rule show BR-n); keep it if the AC verifies that rule, otherwise remove it (lore ac uncite or the equivalent; find the command) and, where a correct rule exists (lore rule find --text "<statement>"), cite that one instead. Never leave an AC citing a rule it does not verify. Report kept / replaced / removed counts and every replaced pair. If removing a cite would demote an approved spec, use the correction path and say so.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared (INV-1); root CLAUDE.md North Star (the corpus must not lie)
AC: every one of the 133 auto-added citations is listed with a keep/replace/remove decision and its reason; no removed cite remains.
