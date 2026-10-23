---
id: TASK-1588
type: task
role: plan
title: "39 rule ids are registered to session leaves that no longer list them (status --check-baseline registry-leaf-mismatch)"
status: deprecated
priority: medium
created: 2026-10-18
updated: 2026-10-23
tags: []
parent: PLAN-198
plan: PLAN-198
---
Found 2026-10-18 during plan-baseline-completeness-restoration-every-verb-declared-0: lore status --check-baseline exits 3 with 39 registry-leaf-mismatch findings, BR-1114..~1152 on baseline-track-what-a-session-changed, baseline-check-a-turn-at-its-end, baseline-hand-off-a-session, baseline-attribute-work-to-a-run, baseline-install-the-agent-integration; lore rule show BR-1114 reports not found. All predate the restoration plan (its ids start at BR-1178). Likely proposed ids of a spec change set that never landed nor were retired, or leaf rules removed outside lore rule set. Expected: every registry id either lives on its leaf, or is retired/proposed with a spec named; status --check-baseline exits 0. Decide per id: land, retire with a note, or repair the registry.
