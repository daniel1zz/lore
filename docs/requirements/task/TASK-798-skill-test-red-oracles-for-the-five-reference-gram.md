---
id: TASK-798
type: task
role: plan
title: "skill-test: RED oracles for the five reference-grammar false-positive classes and .claude/rules/ discovery"
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

RED oracles for Phase 3's code half: the reference-grammar repair and `.claude/rules/` discovery. Neither exists — both must be red at authoring.

## What to write

**1. `packages/lore/tests/unit/service/claude-md-reference-grammar.test.ts`** (vitest, pure unit — this one tests the grammar function directly, it is not a wiring AC)

Five false-positive classes, ALL measured on this repo's own memory files 2026-08-23, plus a genuine-dangling control:

| class | example measured in-repo |
|---|---|
| npm scope names | `@lore/core`, `@libsql/client`, `@lore/core/node`, `@lore/dashboard` |
| retired path aliases | `@core/*`, `@store/*`, `@service/*`, `@adapters/*` |
| glob metacharacters | `hooks/**`, `assets/**`, `packages/lore/**`, `scripts/**` |
| brace expansion | `docs/requirements/{prd,spec,adr,knowledge,plan,task}/` |
| tilde home paths | `~/.claude/`, `~/.claude/docman-mcp` |
| module-relative paths | `commands/set.ts` inside `adapters/cli/CLAUDE.md` resolves against that file's own directory, not the repo root |

⛔ Plus a positive control: a genuinely dangling repo-relative path is still reported. Excluding everything also yields zero, so the sweep assertion alone has no discriminating power.

⛔ Also pin the non-path noise measured in module docs, which the current grammar reports as findings: enumerations (`add/list/rm/rename`, `status/checklist/track`, `lore_create/get/set/search/list/tree/link/pending/approve`) and code fragments (`<Skeleton/>`, `Path=/api`, `)/`, `$XDG_STATE_HOME/lore`).

**2. `packages/lore/tests/integration/claude-md-rules-discovery.test.ts`** (vitest, CLI subprocess)
- A mkdtemp repo containing BOTH `.claude/rules/a.md`, `.claude/rules/nested/b.md` AND `.claude/worktrees/w/CLAUDE.md`. Through `lore status --check-claude-md --json`: exactly two entries at `role: "rules"`, zero sourced from `.claude/worktrees/`.
- ⛔ The `.claude` exclusion in `packages/lore/src/adapters/real-memory-file-probe.ts` must be NARROWED, not removed — its header says it exists to stop counting worktree copies of the same file. A test that only asserts rules are found would pass with the exclusion deleted entirely.
- Cover arbitrary nesting depth and `paths:` YAML frontmatter present/absent (frontmatter semantics beyond discovery are out of scope; discovery must not choke on it).

## Constraints

- ⛔ `mkdtemp` + cwd inside it. NEVER write to this repo's own `.lore/` or `.claude/`.
- ⛔ Assert exit codes EXACTLY; assert the output names the kind.
- vitest only.
- ⛔ Record the red run yourself with `lore evidence ... --result expected-fail` at the moment it is red.

## AC covered

AC-GRAM-1, AC-RULES-1. Read them verbatim via `lore ac list spec-claude-md-governance-content-dimension-checks-wire-the`.
