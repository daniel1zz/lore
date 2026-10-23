---
id: PLAN-238
type: plan
role: plan
title: "Main advances only through lore integrate"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: SPEC-203
phases:
  - {name: "Phase 1: integrate", description: "verb, hook, assets"}
  - {name: "Phase 2: adopt", description: "switch this repo"}
---
## Overview
Implements spec-main-advances-only-through-lore-integrate-per-session (AC-INT-1..3) under adr-main-advances-only-by-lore-integrate-per-session (accepted 2026-10-18, option A). Absorbs AU-T15 and the reverted TG-46.

| T | Task | AC |
|---|---|---|
| INT-T1 | `lore integrate <branch>`: per-session detached integration worktree, merge onto current main, configured post-merge floor, CAS `update-ref refs/heads/main NEW OLD`, max 3 attempts / exit 75, crash re-run no-op, loss counts listed by `lore status` | AC-INT-1 |
| INT-T2 | reference-transaction hook installed by `lore setup` (git >= 2.28 else loud refusal), integrate marker; conflicts exit 4 with nothing changed; `lore integrate origin/main`; first-run detach of the shared checkout keeping edits | AC-INT-2 |
| INT-T3 | shipped asset text (assets/context/worktree-dispatch.md, assets/skills/lore-autopilot/SKILL.md, project rule) names lore integrate as the only way to land a branch; per-session test isolation proven with two processes | AC-INT-3 |
| INT-T4 | on this repo: install the hook, run the first integrate (detaches the shared checkout), switch this session's orchestration to its own integration worktree, lore verify AC-INT-1..3, close AU-T15 | all |

Dependencies: INT-T1 blocks INT-T2 (same verb file); INT-T2 blocks INT-T3 (asset text describes the shipped behaviour); all block INT-T4.

## Invariants
- INV-1: main moves only by a CAS whose expected old value is the base the merge started from; no lock, no exclusivity (North Star).
- INV-2: nothing half-done: every refusal (lost race x3, conflict, failing floor, undetachable view) leaves main, the branch and every session's files unchanged.
- INV-3: red-first per AC; AC-INT-1..3 are ledgered not-built until their oracle lands.
- INV-4: shipped changes (assets/, hook, binary) verified from a fresh consumer install (lore setup into a mkdtemp HOME).
- INV-5: the git-safety hook's refusal of agent-typed destructive git is unchanged; integrate performs no destructive command on another session's tree.

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| Lost races repeat the ~110 s floor under contention | M | 3-attempt bound, exit 75, loss counts in lore status; K=4 measured in AC-INT-1(2) |
| The hook blocks a legitimate main update path not yet routed through integrate (pull, rebase) | M | AC-INT-2(3) covers origin/main; hook message names `lore integrate` |
| Moving main under a checkout attached to it stages a reverse diff (E3) | H | first integrate detaches the shared checkout (AC-INT-2(4)); integrate refuses while any worktree has main checked out |
| Marker forgeable by the same user | L | named limit in BR-1247 (enforced_by both) |

## Exit Criteria
AC-INT-1..3 attested pass on main via lore verify; this repo's shared checkout detached; the hook installed; this session lands every later branch through lore integrate; AU-T15 archived.
