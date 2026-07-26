---
id: TASK-237
type: task
role: plan
title: "Add resolved-actor OS-fallback advisory to resolveActor"
status: archived
priority: medium
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: PLAN-058
plan: PLAN-058
---
# Add resolved-actor OS-fallback advisory to resolveActor (single seam)

## Change

In `packages/lore/src/adapters/cli/utils.ts`:
1. Add `resolveActorWithSource(explicit?: string): { actor: string; source: "explicit" | "env" | "os-fallback" }` — PURE, no side effects: `--by` non-empty → `{explicit}`; else `$LORE_ACTOR` non-empty → `{env}`; else `{os-fallback, actor: userInfo().username}`. This mirrors resolveActor's existing precedence exactly.
2. Rewrite `resolveActor(explicit?)` to call `resolveActorWithSource` and return `.actor` (signature + return value byte-identical to today for every input). ONLY when `source === "os-fallback"`, emit a ONCE-PER-PROCESS non-blocking `process.stderr.write` advisory, e.g.:
   `⚠ actor resolved to OS username "<name>" — corpus writes under this identity aren't traceable to an agent. Pass --by <id> or export LORE_ACTOR=agent:<slug> (or ai:<...>) for a traceable actor.`
   Guard with a module-level `let warnedActorFallback = false` so a batch command (e.g. `lore review --pending`) warns at most once. Export a test-only reset (or structure so tests can re-trigger) — see below.

Do NOT touch the 10 caller commands — the whole point is the seam covers them for free. Do NOT change any exit code or the returned actor string.

## Precise signal (do not widen)

Fire ONLY on OS-username fallback (neither `--by` nor `$LORE_ACTOR` provided). A human passing `--by daniel` or exporting `LORE_ACTOR=daniel` made a deliberate choice → 0 advisory lines. Firing on "no agent:/ai: prefix" would nag legitimate human names — that is WRONG, do not do it.

## Required tests — `packages/lore/tests/unit/adapters/cli-utils.test.ts`

`resolveActorWithSource` (pure, six dimensions):
- HAPPY: explicit "alice" → {actor:"alice", source:"explicit"}; env set → {source:"env"}; neither → {source:"os-fallback", actor: the OS username}
- BOUNDARY: whitespace-only --by / whitespace-only LORE_ACTOR treated as absent (matches resolveActor's `.trim() !== ""`)
- STATE: manipulate `process.env.LORE_ACTOR` set/unset within the test, restore after
- REGRESSION: resolveActor's returned string is identical to resolveActorWithSource(...).actor for explicit / env / fallback

`resolveActor` advisory side effect:
- os-fallback (no --by, no LORE_ACTOR) → exactly 1 stderr line matching /OS username/ (capture via spying `process.stderr.write`), and the once-guard: a SECOND call in the same process writes 0 additional lines (reset the guard between the two assertion groups via the test-only reset)
- explicit --by → 0 stderr lines; env LORE_ACTOR set → 0 stderr lines
- the returned actor value is unchanged in all three cases

Write the "explicit/env → 0 lines" assertions FIRST and confirm they'd fail against a naive "always warn when no agent: prefix" implementation before settling — proves the fallback-only signal is load-bearing.

## Acceptance

AC-AUDIT-ACTOR-1 on `spec-spec-035-audit-trail-calibration-data`.
Oracle: `bunx vitest run packages/lore/tests/unit/adapters/cli-utils.test.ts` (cross-check `Test Files 1 passed`).
Also run `bun run typecheck` (exit 0) — utils.ts is imported widely.
