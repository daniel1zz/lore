---
id: SPEC-065
type: spec
role: spec
title: "CLI ergonomics: unique ID-prefix resolution + single-pass create-task validation"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-10-10
tags: []
links:
  - {id: SPEC-051, type: relates-to}
---
# SPEC-065 — CLI ergonomics: unique ID-prefix resolution + single-pass create-task validation

## Overview/Goal

Two verified dogfood failures (guyin 2026-07-22, verified against HEAD e9e5188 —
`knowledge-guyin-dogfood-2026-07-22-9-findings-verified-against-m`):

1. **P0-2**: `lore pending` renders 10-char truncated ULIDs (`pending.ts:124`
   `d.id.slice(0, 10)`), while `resolveDoc` (`resolve.ts`) accepts only full
   26-char ULIDs or slugs. Copying an ID from the table into `lore approve` fails
   for EVERY row — 23/23 failures observed — and the error (`Run lore list to see
   available documents`) carries no truncation diagnostic.
2. **P1-5**: `lore create task` reports missing required args across two round
   trips: `create.ts:259-265` exits 2 on missing `--plan-id` before Zod ever runs;
   only after supplying it does `schemas.ts:433-438` reject the missing
   `parent_id`. `--plan-id` and `--parent` are almost always the same value, yet
   neither is inferred from the other.

Goal: any identifier a lore surface PRINTS must be a valid INPUT to every lore
command (git short-hash semantics), and `create task` must report all missing
required args in one pass and infer `--parent` from `--plan-id`.

## Scope

- IN: `resolveDoc` unique-prefix resolution (service-layer, so CLI + MCP + HTTP all
  inherit it); a store lookup for ID prefixes; `pending` table output gains the
  slug; `create task` single-pass missing-arg aggregation + parent inference;
  resolver error messages for ambiguous / not-found prefixes.
- OUT: changing the ULID format; fuzzy/substring slug matching; any change to
  `approve` beyond what it inherits via `resolveDoc`; interactive disambiguation.

## Design

**D1 — prefix resolution lives in `resolveDoc`, not per-command.** Input matching
`^[0-9A-HJKMNP-TV-Z]{6,25}$/i` (shorter than a full ULID, longer than 5 chars to
bound scan cost and collision odds) triggers a store prefix lookup after exact
ID/slug resolution misses. Exactly one match → resolve to it. Two or more →
`VALIDATION_ERROR` listing every candidate as `<full-id>  <slug>` so the caller can
paste either. Zero → the existing NOT_FOUND path, now appending: "input looks like
a truncated ID (<n> chars; full IDs are 26) — copy the full ID from --json output
or use the slug".

**D2 — store surface.** New `StoreInterface.findByIdPrefix(prefix): Promise<Result<DocRecord[], LoreError>>`
implemented in SQLiteStore/TursoStore as indexed range scan (`id >= prefix AND id < prefix || 'Z'`-style
or `LIKE prefix || '%'` — PK index makes either cheap), InMemoryStore as filter.
Deleted docs excluded, mirroring `getById`.

**D3 — `pending` prints what commands accept.** The table keeps the 10-char ID
column (now actually usable via D1) and ADDS the slug column. `--json` already
carries full IDs — unchanged.

**D4 — `create task` validation is single-pass.** The CLI pre-check collects ALL
missing required inputs for type task (`--plan-id`, `--parent`) and reports them in
ONE exit-2 message. When `--parent` is absent but `--plan-id` is present, parent
defaults to the plan (the dominant shape; a task parented elsewhere passes
`--parent` explicitly). The Zod layer stays as the backstop for non-CLI surfaces.

## Acceptance Criteria

Deterministic, oracle-verifiable; structured ACs added via `lore ac add` (script
mode, vitest/bun-test files):

- AC-065-1: a unique 10-char ID prefix resolves: `lore get <prefix>` and
  `lore approve <prefix>` succeed against a corpus where exactly one doc matches.
- AC-065-2: an ambiguous prefix exits 4 (`VALIDATION_ERROR`) and the message lists
  every candidate's full ID and slug.
- AC-065-3: a non-matching truncated-ID-shaped input exits with NOT_FOUND and the
  message contains the truncation diagnostic naming 26-char full IDs.
- AC-065-4: `lore pending` table output contains the slug of every pending doc.
- AC-065-5: `lore create task --title t --plan-id <plan>` (no `--parent`) creates
  the task with `parent_id == <plan>`.
- AC-065-6: `lore create task --title t` (neither flag) exits 2 with a SINGLE
  message naming both `--plan-id` and `--parent`.
- AC-065-7: prefix resolution is service-level: the same prefix resolves through
  the MCP `lore_get` tool path (unit test on `resolveDoc` with InMemoryStore).


## Acceptance Criteria (structured)

- [⚑] [script] AC-065-1: A unique 10-char ID prefix resolves via resolveDoc: get and approve succeed when exactly one doc matches the prefix
  script: test — bunx vitest run packages/lore/tests/unit/service/resolve-prefix.test.ts -t "AC-065-1"
- [⚑] [script] AC-065-2: An ambiguous ID prefix returns VALIDATION_ERROR (exit 4) listing every candidate's full ID and slug
  script: test — bunx vitest run packages/lore/tests/unit/service/resolve-prefix.test.ts -t "AC-065-2"
- [⚑] [script] AC-065-3: A non-matching truncated-ID-shaped input returns NOT_FOUND with a truncation diagnostic naming 26-char full IDs
  script: test — bunx vitest run packages/lore/tests/unit/service/resolve-prefix.test.ts -t "AC-065-3"
- [⚑] [script] AC-065-4: lore pending table output contains the slug of every pending doc
  script: test — bunx vitest run packages/lore/tests/unit/cli/pending-output.test.ts -t "AC-065-4"
- [⚑] [script] AC-065-5: create task with --plan-id and no --parent creates the task with parent_id equal to the plan id
  script: test — bunx vitest run packages/lore/tests/unit/cli/create-task-validation.test.ts -t "AC-065-5"
- [⚑] [script] AC-065-6: create task with neither --plan-id nor --parent exits 2 with a single message naming both flags
  script: test — bunx vitest run packages/lore/tests/unit/cli/create-task-validation.test.ts -t "AC-065-6"
- [⚑] [script] AC-065-7: Prefix resolution works at service level through resolveDoc with InMemoryStore (MCP path inherits it)
  script: test — bunx vitest run packages/lore/tests/unit/service/resolve-prefix.test.ts -t "AC-065-7"
