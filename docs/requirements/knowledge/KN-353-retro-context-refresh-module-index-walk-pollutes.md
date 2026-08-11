---
id: KN-353
type: knowledge
role: knowledge
title: "Retro: context refresh module-index walk pollutes CLAUDE.md and breaches its own ceiling"
status: draft
priority: medium
created: 2026-07-27
updated: 2026-07-29
tags: [dogfood, context-verb, defect]
parent: PLAN-088
links:
  - {id: SPEC-098, type: relates-to}
---
# Retro: `lore context refresh` module-index walk pollutes CLAUDE.md and breaches lore's own ceiling

## Incident (2026-07-27, lore repo dogfood)

Running `lore context refresh` on the lore repo itself appended a 302-line managed
`module-index` section to the root CLAUDE.md, growing it from 199 lines / ~24KB to
501 lines / 40,937 bytes. `lore status --check-claude-md` immediately reported
BREACHED (max_lines 220, max_bytes 24576) — i.e. a lore-authored write violated the
ceiling lore itself enforces. The appended index enumerated build artifacts and tool
caches as "modules": `dist-npm/**` (the entire packed npm asset tree, ~90 entries),
`.serena/cache/typescript`, `.lore-bootstrap`, `npm-pkg`, etc. — every entry
"no memory file yet". The pollution was reverted by truncating the pure-append diff
(`head -199`); post-revert `git diff` is empty and the ceiling check passes.

## Root cause (mechanism, not symptom)

`packages/lore/src/service/context-facts.ts` → `walkModuleIndex` records EVERY
non-empty subdirectory at any depth, filtered only by a 7-name static denylist
(`EXCLUDED_DIR_BASENAMES`: .git, node_modules, .claude, .lore, .lore-backups, dist,
coverage). Two structural gaps:

1. **The walk ignores `.gitignore`.** Anything gitignored (dist-npm/, .serena/,
   npm-pkg/, …) is by definition not part of the maintained source tree, yet the
   walk happily indexes it. A static basename denylist can never keep up with
   per-repo artifact naming (`dist` is excluded but `dist-npm` is not — the
   contiguous-substring-assumption lesson in a new costume).
2. **`context refresh` performs no admission check against the claude-md ceiling
   it co-owns.** `claude-md-check.ts` exists in the same verb family, but the
   refresh write path (`flows/context-flow.ts`) splices and saves without
   consulting it — the tool can breach its own gate silently (exit 0, "ok": true).

## Mechanization fix (proposed, not yet built)

- **F1 (primary)**: make the module-index walk gitignore-aware — consult
  `git check-ignore --stdin` (or parse .gitignore via the existing fs-port
  boundary) and skip ignored directories; additionally skip ALL dot-directories
  by default. The static denylist stays as fallback for non-git repos.
- **F2 (defense-in-depth)**: `lore context refresh` runs the claude-md admission
  check on the SPLICED result BEFORE writing; a would-be ceiling breach becomes a
  loud refusal (or `--force`-gated write with a BREACHED warning), never a silent
  exit-0 append.
- Both belong to `spec-context-verb-family-two-zone-claude-md-anatomy-lore`
  scope; no existing ready task covers them (verified via corpus search
  "module index gitignore exclude walk" → 0 results, and `lore ready` on the CTX
  plan — remaining tasks are distribution close-out only).

## Standing lesson

A generator that writes into a governed surface must run that surface's own
admission gate pre-write. "The checker exists elsewhere in the same binary" is
not enforcement — writer and checker sharing a repo but not a call path is the
consumer/end-to-end-audit failure mode again (writer without its reader).

**[EVIDENCE]** [S] `lore context refresh --json` (exit 0, sections all "appended") +
`lore status --check-claude-md` → BREACHED 501/220 lines, 40937/24576 bytes;
`context-facts.ts:84-92` static denylist, `:176-200` unconditional walk.
**[CONFIDENCE]** HIGH

## Resolution (2026-07-27, same day)

Both fixes are BUILT and merged to main (commit 28662fa, CTX Phase 4):
- F1 landed as AC-CTX-9 — `collectContextFacts` now skips dot-directories and
  gitignore-matched directories (layered per-directory `.gitignore` matchers via
  the `ignore` npm package, FsReadPort-only; static denylist retained as
  non-git fallback).
- F2 landed as AC-CTX-8 — `runContextRefresh` runs the `claude-md-check.ts`
  ceiling admission (same SSOT as `lore status --check-claude-md`) on the
  spliced candidate pre-write; breach → `VALIDATION_ERROR` naming every
  finding, no write.
RED-first: 6 failing cases written by an independent tester before the fix
(tasks `task-skill-test-red-walk-hygiene-refresh-admission-suites-ac` /
`task-skill-implement-gitignore-aware-module-walk-refresh-pre`). Full gates on
main post-merge: typecheck 0, vitest 377 files/6429 pass, bun test 1357 pass.

## Addendum: residual config gap caught by live e2e recheck (same day)

The post-merge live recheck (`lore context refresh` on this repo) exposed a
residual: the refusal cited the SCHEMA-DEFAULT ceiling (300L/30720B) while
`.lore/config.yaml` pins 220L/24576B — `context-flow.ts` called
`resolveMemoryFileBudgets(undefined)` directly, so config overrides never
reached the admission check (or facts collection), violating AC-CTX-8's
"same source as `lore status --check-claude-md`" clause. Fixed same day
(commit 90f5b2d merge): budgets resolved ONCE per invocation in the CLI
adapter (mirroring status.ts), threaded through flow deps; a third independent
resolution in `resolveInitNarrative` was unified too. Post-fix live recheck:
refusal cites 220/24576. Lesson reinforced: a "reuse the same checker" fix is
incomplete until the checker's INPUTS are also same-sourced — function-level
SSOT with divergent parameters is still two oracles.
