---
id: SPEC-51
type: spec
role: spec
title: "CLI strict flags: unknown-flag rejection + actor-flag unification"
status: approved
priority: medium
created: 2026-07-17
updated: 2026-07-27
tags: []
parent: PRD-001
---
# SPEC-051 — CLI strict flags: unknown-flag rejection + actor-flag unification

## Overview

citty silently swallows unknown flags: `lore link A B --kind blocks` created a default `relates-to` link (silently breaking `lore ready` blocker semantics), and `lore approve <doc> --by daniel` silently attributed the approval to the OS username because approve's actor flag is `--reviewer`. Both are zero-signal failures that corrupt workflow semantics and audit attribution — directly violating the repo's no-silent-fallback principle. Empirically observed 2026-07-17 (snip-demo dogfood, findings F4/F4b in `knowledge-dogfood-retro-full-lifecycle-fresh-corpus-run-snip-dem`).

## Goal

(1) Any unknown flag on any lore CLI command fails loud (exit 2, usage error naming the unknown flag). (2) `lore approve`/`lore reject` accept `--by` as the canonical actor flag (alias of `--reviewer`), consistent with claim/release/evidence/handoff.

## Design

### D1 — one enforcement seam, not 31 edits

A single helper (`adapters/cli/strict-flags.ts`, pure) validates a command invocation's raw argv flag tokens against the command's declared `args` definition, and is applied centrally where subcommands are assembled (the CLI loader / main command composition site) by wrapping each command's `run` — never by editing every command file. Validation rules:
- Every `--x` / `--x=value` token in rawArgs must match a declared arg name or alias.
- `--no-X` matches a declared boolean `X` (citty negation convention).
- Positionals and `--` passthrough are untouched.
- Violation → print `Unknown option: --<flag>` + a `lore <cmd> --help` pointer on stderr, exit 2 (usage-error code, same as citty's own missing-required-argument failures).

### D2 — actor-flag unification

`approve`/`reject` gain `--by` (documented canonical), keeping `--reviewer` as an accepted alias. Both given with CONFLICTING values → exit 2. Resolution order stays `flag > $LORE_ACTOR > OS username`.

### D3 — regression fixtures mirror the real incidents

Tests reproduce the two observed failures byte-for-byte: `lore link A B --kind blocks` → exit 2 naming `--kind` (no link written); `lore approve X --by daniel` → audit/version row attributed to `daniel`.

## Scope

- `packages/lore/src/adapters/cli/` (strict-flags helper + composition-site wiring + approve/reject arg defs) and CLI tests. Behavior of VALID invocations is byte-identical (REGRESSION: every existing CLI test must pass unchanged except ones asserting the old silent-swallow).

## Out of scope

- MCP/HTTP surfaces (zod-validated separately). Renaming `--reviewer` away (kept as alias). Config-file strict validation (separate finding F13, not this spec).

## Acceptance criteria

Structured ACs: typecheck; CLI unit suites green; full dual-runner suite green; live repro — `lore link a b --kind blocks` exits 2 naming --kind; `lore approve <doc> --by <name>` attributes `<name>` in `lore log`.


## Acceptance Criteria (structured)

- [✔] [script] AC-051-1: Typecheck clean
  script: tsc — bun run typecheck
- [✔] [script] AC-051-2: CLI unit suites green incl. strict-flags helper + both incident regressions
  script: test — bunx vitest run packages/lore/tests/unit/adapters
- [✔] [script] AC-051-3: Full dual-runner suite green (valid invocations byte-identical)
  script: test — bun run test
- [✔] [human] AC-051-4: Live repro: link with an unknown flag exits 2 naming it; approve --by attributes the given actor in lore log
  human: Scratch corpus only

## Code anchors

- packages/lore/src/adapters/cli/strict-flags.ts
- packages/lore/tests/unit/adapters/cli-strict-flags.test.ts
- packages/lore/tests/unit/adapters/cli-strict-flags-incidents.test.ts
