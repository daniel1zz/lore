---
id: PLAN-088
type: plan
role: plan
title: "Implementation — context verb family (two-zone CLAUDE.md, admission checks, skill retirement)"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-08-01
tags: []
parent: SPEC-098
phases:
  - {name: "Phase 1: Pure Core", description: "Core leaves (markers/ports) + pure projection/splice + admission-check extensions, TDD-paired. All tasks parallel-safe (disjoint anchors)."}
  - {name: "Phase 2: Capability", description: "Facts collection, context-flow orchestration, CLI verbs, AI template (adapter-orchestrated), setup-project-flow splice-SSOT refactor."}
  - {name: "Phase 3: Distribution & Close-out", description: "Guard hook asset + registration, init-context skill retirement, manifest regen, full-suite verification + lore verify + code anchors."}
  - {name: "Phase 4: Hardening"}
---
## Overview/Goal
Execute spec-context-verb-family-two-zone-claude-md-anatomy-lore in three phases: pure core first (contracts + projection + admission checks, TDD-paired), then capability wiring (facts/flow/CLI + splice-SSOT refactor), then distribution (guard hook, skill retirement, close-out). Worktree dispatch per task; scoped oracles in worktrees; full suite only on main after merges (AC-CTX-7 at close-out).

## Execution Notes
- TDD pairing: each [test] task lands a RED suite on the exact AC command; its paired [implement] task turns it green. Test tasks and implement tasks have disjoint file anchors.
- Phase 2 depends on Phase 1 exports (memory-markers, fs-ports, context-projection). Phase 3 depends on Phase 2 CLI verbs existing.
- Design SSOT: lore get spec-context-verb-family-two-zone-claude-md-anatomy-lore (interfaces, D1-D11, handoff notes). Do not re-decide settled decisions in-task.
