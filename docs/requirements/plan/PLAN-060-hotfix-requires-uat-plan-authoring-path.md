---
id: PLAN-060
type: plan
role: plan
title: "Hotfix — requires_uat plan authoring path"
status: archived
priority: medium
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: SPEC-058
---
# Hotfix — requires_uat authoring path (SPEC-058 follow-up)

## Goal

SPEC-058's plan-promote `requiresUat` predicate demands `plan.extra.requires_uat === true` for any plan under a design-kind spec with a configured verification profile — but NO CLI or MCP path can write that flag (`lore create plan` and `lore set` both lack it, verified 2026-07-22). SPEC-064 is the first design-kind plan in this corpus, so the gate has never been reachable in practice. Add the authoring path.

## Sequencing

Single task. BLOCKS creation of the SPEC-064 implementation plan — that plan cannot be created-with or promoted-to `requires_uat: true` until this lands.

## Exit Criteria

- AC-V-6 (CLI) + AC-V-7 (MCP) attested pass
- No regression in existing create suites
