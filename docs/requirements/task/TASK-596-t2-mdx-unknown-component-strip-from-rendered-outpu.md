---
id: TASK-596
type: task
role: plan
title: "T2 MDX unknown-component strip from rendered output + CLI stderr warning"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-115
plan: PLAN-115
---
Fix spec-prd-as-living-root §4 violation (audit-confirmed): non-whitelisted MDX components survive verbatim in rendered output ('' in lore get stdout, stderr empty). Root cause: OutlineService.resolve warns and continues so unknown components never enter resolvedComponents; renderResolvedToMarkdown splices only resolvedComponents positions. Required: unknown components REMOVED from rendered text (spec frames whitelist as security validation); warnings surfaced to CLI stderr on lore get. Tests must assert rendered TEXT (component absent) and stderr surface, not just the warnings array — extend outline-service tests + a CLI-level assertion.
