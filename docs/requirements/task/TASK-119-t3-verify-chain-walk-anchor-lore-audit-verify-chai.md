---
id: TASK-119
type: task
role: plan
title: "T3 — verify chain walk + anchor: lore audit --verify chain integrity, lore audit anchor + .lore/audit-anchor.json"
status: archived
priority: medium
phase: "Wave 2 — verify + anchor + adversarial"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-030
plan: PLAN-030
links:
  - {id: TASK-118, type: blocks}
---
Implements SPEC-079 G3 verify half (AC-079-5; enables AC-079-4's assertions). AuditService.verify recomputes the full chain id ASC after the completeness join, reporting first break {id, reason: hash_mismatch|prev_link_mismatch|unchained_row}; lore audit anchor writes .lore/audit-anchor.json {head_id, head_hash, entry_count, anchored_at}, git-tracked via the export-index.json gitignore-exception pattern; verify asserts anchored pair exists when file present (anchor_mismatch otherwise). Integration bun suite at the canonical AC path.
