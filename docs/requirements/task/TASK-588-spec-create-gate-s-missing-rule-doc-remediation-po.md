---
id: TASK-588
type: task
role: plan
title: "spec-create gate's missing-rule-doc remediation points to a lore dev-repo script (bun scripts/seed-write-spec-rule.ts) that consumers do not have"
status: draft
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PRD-001
---
When the spec-create gate runs against a corpus that has no approved rule doc (type=knowledge, status=approved, extra.sub_type='skill', extra.skill.applies_to='spec'), the deny/feeding-pack output prints: '(No approved rule doc found — run `bun scripts/seed-write-spec-rule.ts` to seed it. Expected: ...)'. That script path is relative to the lore development repository; a consumer project that installed the lore CLI (dist binary / symlink) has no scripts/ directory and no bun project to run it in, so the remediation instruction is a dead end. Additionally, neither 'lore init' nor 'lore setup --project' seeds this rule doc, so every fresh corpus starts in this degraded state: the gate still enforces its deterministic checks but renders an empty '## Rule' section plus the misleading pointer. The remediation should be a lore CLI verb (e.g. 'lore governance seed-rule spec' or part of setup --project scaffolding), and the error text should reference a command that exists in the consumer's environment.
