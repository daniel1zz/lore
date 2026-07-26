---
id: TASK-147
type: task
role: plan
title: "Create-time orphan advisory: warn (or default-parent to root PRD) when adr/plan/knowledge is created parentless while a root PRD exists"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
## Finding (dogfood, guyin corpus, 2026-07-25)

A project that starts working BEFORE its root PRD exists accumulates parentless adr/plan/knowledge docs silently: schema only mandates parent_id for spec/task (deliberate — avoids the chicken-and-egg deadlock during pre-PRD exploration), and tree conformance is only checked once lore.tree.yaml arms --check-tree. In guyin, 12 orphans accumulated over ~3 days and only surfaced when 'lore setup --project' installed the blueprint + pre-push hook.

## Gap

Write-side is silent even when the deadlock rationale no longer applies: once a root PRD exists, a parentless create of adr/plan/knowledge is almost always an omission, not intent.

## Proposed mechanization

In CorpusService.create, when type is adr/plan/knowledge and parent_id is absent AND a root PRD exists: emit a one-line advisory naming the repair command ('lore link <doc> <root-prd> --type parent'), or default-parent to the root PRD (mirroring the SPEC-069 --adhoc auto-parenting precedent). Advisory-only is the conservative option; default-parenting matches existing --adhoc semantics.

## Repair used in guyin

'lore status --check-tree --fix' correctly skipped all 12 (multi-candidate, '0-or-many candidates' — conservative by design); manual 'lore link <id> <root> --type parent' x12 cleared drift to exit 0.
