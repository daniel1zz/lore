---
id: TASK-840
type: task
role: plan
title: "One row contract for every lore list --json emit branch, proven against the live consumer"
status: approved
priority: medium
phase: "command surfaces"
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PLAN-148
plan: PLAN-148
---
## Objective

Give `lore list --json` ONE row contract across every emit branch, and prove the change reaches
the live consumer. Closes AC-MOS-1 and AC-MOS-2.

## What to change

`packages/lore/src/adapters/cli/commands/list.ts` has FIVE `--json` emit sites. Three of them
print `fullDocs` — `WithValidityStatus<DocRecord>`, 18 keys including `content` and `extra` — while
the default branch prints the store's summary projection plus `validity_status`, 10 keys including
a type-discriminated `meta`.

⛔ The fetch is NOT the defect and must not be "optimised". Those branches fetch full records
because the validity gate and the `--plan-id` / `--phase` narrowing all read `extra`, and
`DocSummary` has none. `fetchGatedFullDocs`'s own header says the single fetch shape is what keeps
the exclusion from being skipped on one branch again. Keep it. Project at the EMIT site only.

`meta` must come from the existing SSOT `deriveTypeMeta` (`packages/core/src/doc-type-meta.ts:86`),
which takes a `DocRecord` — the wide branches already hold one. ⛔ Do not reimplement it and
⛔ do not drop `meta` to make the key sets match.

## Two suites, one per criterion — deliberately not one file with `-t`

- `packages/lore/tests/integration/list-json-row-contract.test.ts` → AC-MOS-1
- `packages/lore/tests/integration/list-json-real-corpus-buffer.test.ts` → AC-MOS-2

⛔ One file per criterion so each AC command runs UNFILTERED. A `-t` filter would satisfy the AC
while leaving the rest of the file unverified, and `lore done` then demands a companion unfiltered
row anyway.

⛔ AC-MOS-1's suite writes ONLY to a `mkdtemp` + `lore init` throwaway with `HOME` redirected
inside it. AC-MOS-2 reads THIS repo's real corpus, which is allowed because `lore list` writes
nothing — ⛔ it must issue no other verb.

## ⛔ The recorded red is part of the deliverable

Both suites are red on arrival only because their files do not exist, and "the file was missing"
is not "the assertion can fail". After both are green, in a scratch copy of `list.ts` that you
revert, revert ONE emit site to printing `fullDocs` verbatim and record TWO separate
`expected-fail` rows at the moment you observe them:

- against AC-MOS-1: the key sets diverge / `extra` reappears.
- against AC-MOS-2: `spawnSync` returns `status: null` with `error.code: "ENOBUFS"`.

⛔ One probe run does not evidence both criteria — they assert different things. Record each with
its own `--ac-ref`. Then restore, and confirm with `git diff` that your only tracked changes are
`list.ts` plus the two new test files.

## Reference measurements — cite, do not re-derive

Taken 2026-08-25 on main @ 3331a98e. Every byte figure is a point measurement of a growing corpus.

| invocation | bytes | keys |
|---|---|---|
| `lore list --type knowledge --json` | 313,281 | 10 |
| `lore list --type knowledge --json --include-invalid` | 23,180,068 | 18, no `meta` |
| `lore list --type task --json` | — | 18, no `meta` |

A/B with only `maxBuffer` varied: 20MB → `status null` / `SIGTERM` / `ENOBUFS` / stdout truncated
at 20,849,318 in 2.5s; 64MB → `status 0` / 22,988,107 bytes.

Full diagnosis, already recorded — ⛔ read it, do not re-measure it:
`knowledge-corpus-growth-crossed-three-hard-coded-thresholds-in`.

## Finish

Scoped oracles only (`bun run test:changed <base>`, both AC commands, `bun run typecheck`).
⛔ Do NOT run the full suite, `lore done`, `bun run build`, or `mirror:export`.
`lore evidence` for every row you observed → commit with this task's slug → `lore release`.
