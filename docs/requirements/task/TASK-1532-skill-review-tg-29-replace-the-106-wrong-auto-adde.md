---
id: TASK-1532
type: task
role: plan
title: "[Skill:review] TG-29 replace the 106 wrong auto-added citations: right rule, new rule, or bounded exemption"
status: archived
priority: high
phase: "Phase 3b: one runner"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1512, type: relates-to}
  - {id: TASK-1496, type: blocks}
---
Estimate: L
Approach: Follow-up of task-skill-review-tg-27-audit-the-133-citations-auto-added-by, whose decision table is /private/tmp/claude-501/-Users-apple-Projects-zz-lore/c1ffea04-89c5-46f4-8bb9-0d10906f3f65/scratchpad/tg27-decisions.md (133 audited: 8 kept, 19 replaced and applied, 106 "remove" refused by AC_CITE_REQUIRED). User decision 2026-10-17: the per-criterion citation requirement is a deliberate approved rule (baseline-cite-a-baseline-rule). For each of the 106: if a correct live rule exists, cite it and remove the wrong one; otherwise the baseline lacks a rule for real behaviour — add it with `lore rule add` to the right baseline document (statement = the behaviour the criterion verifies and the code does today; confidence observed; measured date), group criteria that verify the same behaviour under one rule, cite it, then remove the wrong cite. Use `lore ac exempt` (bounded; active exemptions capped at 10% of live criteria, headroom ~102) only as a bridge for criteria whose rule cannot be grounded here, with a reason naming this task. Never cite a rule the criterion does not verify; never invent behaviour the code does not have.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared (INV-1); root CLAUDE.md North Star (the corpus must not lie)
AC: none of the 106 still cites its wrong auto-added rule; each now cites a rule it verifies or holds an exemption naming this task; every new rule is listed with the criteria citing it.
