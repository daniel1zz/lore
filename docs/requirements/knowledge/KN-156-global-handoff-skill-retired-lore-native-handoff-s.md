---
id: KN-156
type: knowledge
role: knowledge
title: "Global handoff skill retired — lore-native handoff (SPEC-041 S2) is the sole cross-session memory path"
status: approved
priority: medium
created: 2026-07-16
updated: 2026-07-16
tags: [handoff, workflow, convergence, retirement]
parent: PRD-001
links:
  - {id: KN-159, type: relates-to}
---
## Decision (owner, 2026-07-16, "最彻底的")

The global Claude Code `handoff` skill (`~/.claude/skills/handoff` → `~/.agents/skills/handoff`) is RETIRED: symlink removed from skill discovery; source preserved at `~/.agents/skills/handoff` (reversible).

## Why

- It was a PARALLEL non-lore mechanism: compacted a conversation into a single markdown FILE (paired with a `/pickup` that was not even installed), bypassing the corpus SSOT.
- Its description still referenced the retired DocMan (`docman-session`) — stale since the DocMan→lore migration (see knowledge: Global Claude Code workflow migrated from DocMan to lore).
- Trigger-phrase collision ("交接/保存进度/handoff") with the lore-native flow created nondeterministic skill selection.
- Impact surface verified before removal: zero references from any global config/hook/skill.

## Canonical path (everywhere)

`lore handoff` → typed corpus doc (knowledge/sub_type=handoff, handoffExtraSchema) → SessionStart bootstrap injection (`resume_hint`/`latest_handoffs`) → `lore feed session-resume`. Non-lore projects: `lore init` first. All four pieces (CLI verb, governance snippet, session-start hook, lore-session skill) ship in SPEC-046 `assets/` — installed by `lore setup`.
