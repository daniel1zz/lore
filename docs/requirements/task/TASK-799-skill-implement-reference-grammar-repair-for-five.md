---
id: TASK-799
type: task
role: plan
title: "skill-implement: reference-grammar repair for five false-positive classes, module-relative resolution, and .claude/rules discovery with a rules role"
status: archived
priority: medium
phase: "P3-grammar-rules-and-prose"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-139
plan: PLAN-139
---
## Objective

Phase 3's code half: repair the reference grammar's five measured false-positive classes, and add `.claude/rules/` discovery with a third `rules` role.

## What to build

**1. Reference-grammar repair (`claude-md-admission.ts`)** — exclude, all measured on this repo:

| class | in-repo example |
|---|---|
| npm scope names | `@lore/core`, `@libsql/client`, `@lore/core/node` |
| retired path aliases | `@core/*`, `@store/*`, `@service/*`, `@adapters/*` |
| glob metacharacters | `hooks/**`, `assets/**`, `packages/lore/**` |
| brace expansion | `docs/requirements/{prd,spec,adr,knowledge,plan,task}/` |
| tilde home paths | `~/.claude/`, `~/.claude/docman-mcp` |

Plus: **module-relative resolution.** A module doc writes `commands/set.ts` meaning `packages/lore/src/adapters/cli/commands/set.ts`. That is the convention those files use — resolve against the scanned file's own directory, do not exclude it.

⚠ The test author extended `checkReferenceExistence` with an optional 3rd parameter (`filePath`, the scanned file's repo-relative path), because module-relative resolution structurally needs to know which directory to resolve against and the 2-arg signature cannot receive it. The suite uses a dynamic `import()` so it stays `tsc --noEmit`-safe regardless of your final signature — but the capability is required either way.

⚠ Also measured in module docs and currently reported as findings: enumerations (`add/list/rm/rename`, `lore_create/get/set/search/...`) and code fragments (`<Skeleton/>`, `Path=/api`, `)/`, `$XDG_STATE_HOME/lore`). The suite pins the exclusion-pattern shapes rather than a global zero, because some genuine cross-module prose references exist (`core/` in `eval/CLAUDE.md` means `packages/core/`). Read the suite before choosing your approach.

**2. `.claude/rules/` discovery + `rules` role**
- `MemoryFileRole` gains `"rules"`; `context.memory_files.rules` gains its own budget block (zod default only).
- ⛔ `real-memory-file-probe.ts`'s `EXCLUDED_DIR_NAMES` currently excludes `.claude` wholesale. NARROW it, do not remove it — its header states it exists to stop counting worktree copies of the same memory file under `.claude/worktrees/`. Deleting the exclusion would double-count every worktree's CLAUDE.md.
- Recursive glob under `.claude/rules/`, arbitrary depth, tolerating `paths:` YAML frontmatter (frontmatter semantics beyond discovery are out of scope).
- A `rules` role must not print "module ceiling" in any message — that was the reason for a separate role (N7).

## Constraints

- ⛔ Service modules stay PURE. Predicates injected.
- ⛔ Everything routes through `runMemoryFileChecks` (AC-COMPOSE-1 bans 7 named functions).
- ⛔ The oracles live in another task's anchors — do NOT edit them. Make them green by changing `src/**` and `config.ts`.
- ⛔ Run the two Phase 3 suites BY HAND plus `bun run typecheck`.
- `packages/lore/src/service/CLAUDE.md` has 528 bytes of runway (14218/14746 as measured by `claude-md-eviction-floor.test.ts`, NOT by `lore status --check-claude-md` whose floor is looser). If you record the new `rules` role there, keep it to one line and re-run that suite.

## Definition of done

AC-GRAM-1 and AC-RULES-1 green, each verified with its declared `--falsifier-*` mutation producing the declared EXACT exit code. Record evidence, then `lore release`. ⛔ Do NOT run `lore done`.
