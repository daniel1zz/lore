---
id: TASK-605
type: task
role: plan
title: "CLI gap: no safe update path for adr extra.decision_status — add lore set --decision-status"
status: draft
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PRD-001
links:
  - {id: ADR-014, type: relates-to}
---
## Why
Promoting the context-verb-family direction ADR from proposed to accepted (2026-07-27) had no CLI path: lore set exposes --title/--status/--content/--kind/--slug but not --decision-status; create-time --decision-status exists. Workaround used: full --content-file rewrite updating the prose Status line + lore approve, leaving extra.decision_status stale at 'proposed' — a silent metadata/prose divergence.
## What
Add --decision-status (adr only, values proposed|accepted|deprecated|superseded) to lore set, patching extra.decision_status without replacing extra wholesale, mirroring create's validation. Include a regression test proving non-adr docs reject the flag (exit 2) and that other extra fields survive the patch.
## AC
vitest suite covering: accepted promotion persists; non-adr rejection; extra preservation.
