---
id: TASK-229
type: task
role: plan
title: "[Skill:implement] F1 — session-derived actor tier (core session-actor + cli resolveActorWithSource)"
status: archived
priority: high
phase: "Phase 1: Implementation"
created: 2026-07-23
updated: 2026-07-23
tags: []
parent: PLAN-051
plan: PLAN-051
links:
  - {id: TASK-230, type: blocks}
---
Estimate: M
Approach: New pure module packages/core/src/session-actor.ts exporting SESSION_ACTOR_PREFIX ("agent:session-") + sessionActorFromId(sessionId) -> prefix + 8-char sanitized-lowercase prefix (sanitize semantics mirror core/seat.ts::sanitizeBranchSegment — reuse it if importable without coupling, else local equivalent with a comment pointing at the precedent). Barrel line in packages/core/src/index.ts (export * style, browser-safe — zero Node imports). Then adapters/cli/utils.ts: resolveActorWithSource(explicit?, env: Record<string, string|undefined> = process.env) — migrate the existing LORE_ACTOR read onto the env param, insert the session tier between env and os-fallback reading env["CLAUDE_CODE_SESSION_ID"] ?? env["CLAUDE_SESSION_ID"] (non-empty after trim), ActorSource gains "session". resolveActor passthrough unchanged; the once-per-process os-fallback advisory keeps firing ONLY on os-fallback.
Source: spec-069 Design Decisions D1/D2/D3/D8 + Module Boundary TS signatures
Dimensions: D-FUNC, D-CODE
Scope-Alt: none (slice is minimal already)
Covers: AC-069-1, AC-069-2

AC:
- Given explicit "alice" + env with LORE_ACTOR and CLAUDE_CODE_SESSION_ID set, When resolveActorWithSource, Then {actor:"alice", source:"explicit"} (explicit beats all)
- Given no explicit + env {LORE_ACTOR:"agent:x", CLAUDE_CODE_SESSION_ID:"abc"}, Then {actor:"agent:x", source:"env"}
- Given no explicit + env {CLAUDE_CODE_SESSION_ID:"3DE02220-5d69-..."}, Then actor === "agent:session-3de02220" and source === "session"
- Given no explicit + env {CLAUDE_SESSION_ID only}, Then session tier still fires (alias env var)
- Given no explicit + empty/whitespace session ids, Then falls through to os-fallback and the advisory fires once per process
- Given sessionActorFromId("AB_c!!12345"), Then result is SESSION_ACTOR_PREFIX + first 8 chars of the sanitized id; sanitization strips chars outside [a-z0-9-]; a sessionId that sanitizes to empty throws (fail-loud, never a bare prefix)
- All tests pass literal env objects — zero process.env mutation anywhere in the two new test files
- Scoped oracles green in worktree: bunx vitest run packages/lore/tests/unit/cli/actor-session-tier.test.ts packages/lore/tests/unit/core/session-actor.test.ts (assert matched file count == 2) + bun run typecheck
