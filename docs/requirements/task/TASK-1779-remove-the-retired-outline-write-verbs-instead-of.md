---
id: TASK-1779
type: task
role: plan
title: "Remove the retired outline write verbs instead of keeping them only to refuse them (BR-985)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
## Finding

The outline write commands `lore outline set|rm|exempt` are retired (BR-985) but still registered: `packages/lore/src/adapters/cli/commands/outline.ts:55-174` keeps the three subcommands and their flag declarations only so each invocation can be refused with exit 4 and a pointer to `lore baseline add`. The product-baseline branch therefore carries a leaf ("Write an outline section") whose rules describe refusals of commands that exist only to be refused. Raised by the review of baseline-product-baseline (design_necessity).

## End state

The outline is gone, not kept as read-only history: the stored outline sections on requirements documents are migrated into the baseline tree or archived (document history and audit already keep the past), and the whole `lore outline` family (`set`, `rm`, `exempt` and `list`) is removed, with any outline-only status check. An old invocation gets the CLI's ordinary unknown-command refusal, not a bespoke retired-write path. BR-985 and BR-694/695/696 are retired with a note naming this task; the outline leaf and the glossary term "Outline section" are removed from the product-baseline branch.

## Acceptance (red first)

- AC: no stored requirements document carries outline sections, `lore outline` is an unknown command, and `grep -n "refuseRetiredWrite\|retiredOutlineWrite" packages/lore/src/adapters/cli/commands/outline.ts` returns nothing (the file no longer exists, or the grep exits 1). Red today: outline.ts:55-174 defines both helpers and the three verbs.
- Falsifier: re-adding any outline verb (even as a refusing stub), or leaving one outline section stored, turns the AC red.
- Corpus: BR-985 retired with a note citing this task; the outline leaf no longer describes refusals of removed verbs.
