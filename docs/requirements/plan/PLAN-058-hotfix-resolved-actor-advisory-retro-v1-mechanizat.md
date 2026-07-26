---
id: PLAN-058
type: plan
role: plan
title: "Hotfix — resolved-actor advisory (retro V1 mechanization)"
status: archived
priority: medium
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: SPEC-035
---
# Hotfix — resolved-actor advisory (retro V1 durable mechanization)

## Goal

Mechanize retro V1 (`knowledge-session-process-review-2026-07-22-...`, escalated — twice-recommended, un-built): stop OS-username actors from landing SILENTLY in the corpus audit trail. The 2026-07-22 session recorded 16 evidence rows under bare OS username `apple` (inconsistent even within one task) because the actor-identity discipline was prompt-only for the orchestrator's own CLI calls. Prompt discipline already failed twice; this replaces it with a deterministic CLI-side signal.

## Design

`resolveActor` (`utils.ts`) is the SINGLE seam all 10 actor-stamping commands (claim/release/evidence/verify/uat/gate/review/invalidate/handoff/anchor) resolve through. Put the advisory THERE — one place, covers every current and future caller, zero per-command drift.

- Split classification (pure, testable) from the side effect: `resolveActorWithSource(explicit?) → {actor, source: "explicit"|"env"|"os-fallback"}`.
- `resolveActor(explicit?)` returns `.actor` (signature unchanged, backward-compatible) and, ONLY on `source === "os-fallback"`, emits a once-per-process non-blocking stderr advisory naming the fix (`--by <id>` or `export LORE_ACTOR=agent:<slug>`). Never changes the returned string or any exit code.
- Precise signal: fire on OS-username FALLBACK, not on "actor lacks agent:/ai: prefix" — a human running `--by daniel` or `LORE_ACTOR=daniel` made a deliberate choice and must NOT be nagged. Only the silent-default case warns.
- Once-per-process guard (module-level flag) so a batch command doesn't spam.

## Exit Criteria

- AC-AUDIT-ACTOR-1 attested pass.
- No regression: existing cli-utils tests + any command relying on resolveActor's return value stay green.
