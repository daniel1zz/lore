---
id: SPEC-113
type: spec
role: spec
title: "ADR decision_status has a create surface and no CLI update surface: a value-restricted affirmative writer for proposed to accepted"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-10-17
tags: []
---
## Overview

`extra.decision_status` on an `adr` document is authored at creation and, through the CLI alone, can never reach `accepted`. The single most common transition an architecture decision record has — `proposed → accepted` — has no CLI writer. This spec closes that gap with ONE narrow, type-scoped, value-restricted writer plus an author→read end-to-end oracle, without opening a back door around `lore invalidate`, which legitimately owns the two negative transitions.

Goal: a `proposed` ADR can be moved to `accepted` from the CLI, and every "which decisions are accepted" read reports the new value; no other `decision_status` value is reachable through this surface.

## Measured Gap

Verified at commit 8227dd1 (current `main`):

- WRITE at create: `commands/create.ts:94` (`"decision-status": ["adr"]` type-scoping), `:154` (arg declaration), `:259-269` (required for `adr`, invalid value rejected), `:472`/`:642` (`{ decision_status: decisionStatus }` into `extra`).
- NO update writer: `commands/set.ts` declares `title | status | content | content-file | priority | tags | kind | slug | json | by | regenerate | refine | refine-stdin | ai` (`:117-190`). No `--decision-status`, no `--extra`.
- NEGATIVE transitions already have an owner: `service/validity-service.ts:307` writes `decision_status: "superseded"` (with `--superseded-by`) and `:310` writes `"deprecated"` (reason-only); `commands/invalidate.ts:71-94` surfaces `decision_status_unchanged` and documents that `--undo` NEVER auto-reverts it (SPEC-043 D2).
- So the ONLY transition missing from the CLI is the affirmative one. MCP `lore_set` can already write `extra` wholesale — that is how a task in `plan-implementation-plan-close-predicates-measure-invariants` had to flip the field.

Consequence class: the mirror of the recorded "a gate demanding a field no surface can author" defect — a field the CREATE surface authors with no UPDATE surface maintaining it. It fails silent: nothing errors, the value simply stays wrong forever. Source: `knowledge-eight-findings-from-building-and-closing-the-plan` §2.

## Scope

In scope:
- One CLI writer for `adr.extra.decision_status`, restricted to the value `accepted`.
- Its author→read end-to-end oracle (create with one value, update, assert the READ surface reports the new one).
- A loud refusal path that names `lore invalidate` when a caller aims at `deprecated`/`superseded`.

Out of scope (deliberate, each with a reason):
- `deprecated` / `superseded`: owned by `lore invalidate`, which writes `extra.validity` and `decision_status` TOGETHER. A second writer that set only the status would author a doc whose validity bookkeeping contradicts its decision status.
- `accepted → proposed` (un-accepting): not a real workflow. An accepted decision that turns out wrong is superseded or deprecated through `lore invalidate`, not silently rewound.
- A general `lore set --extra <json>`: see Options, rejected.
- MCP / HTTP surfaces: `lore_set` is already capable; no change needed.
- `decision_status` on non-`adr` types: the field does not exist there.

## Options Considered

| # | Option | Mechanism | Against it |
|---|---|---|---|
| 1 **(recommended)** | `lore set --decision-status accepted` | New type-scoped flag on the existing writer, read-merge-write into `extra` | `set` is the generic writer; the flag must hard-restrict its value set or it becomes a back door around `lore invalidate` |
| 2 | `lore adr accept <doc>` | New type-scoped command group, one legal transition, impossible to express an illegal one | A new top-level verb carrying a single field; needs its own resolve/version/audit wiring that `set` already has |
| 3 | `lore set --extra <json>` | Wholesale `extra` patch, solves every future extra-field gap at once | REJECTED. `CorpusService.set` replaces `extra` WHOLESALE (`corpus-service.ts:1566`), and its dropped-field guard (`:1595-1603`, added after a 2026-07-25 extra-wholesale incident) exists precisely to catch this class. It would also let a caller hand-author `attestation` / `claim` / `validity` / `handoff` payloads that have dedicated writers |

**Recommendation: Option 1**, on a precedent correction. The originating retro proposed "following the precedent already carved out for `--slug` on `lore set`" — that is the WRONG precedent: `slug` is a top-level column, not an `extra` field. The correct live precedent is `--kind`, which already writes an `extra` sub-field from `set` (`set.ts:472`: `patch["extra"] = { ...targetDoc.extra, spec_kind: args.kind }` — type-scoped to `spec`, read-merge-write so unrelated `extra` keys survive, with the no-demotion carve-out documented at `set.ts:49-53`).

`decision_status` is the same SHAPE as `spec_kind`: a scalar discriminator with a closed value set, not a structured payload. The dedicated-writer convention that `adapters/cli/CLAUDE.md` records applies to structured payload fields (`extra.validity`, `extra.claim`, `extra.verification_evidence`, `extra.file_anchors`, `extra.phases`, `extra.handoff`) — `decision_status` is not one of those. Option 1 therefore adds no new convention; Option 2 would add a verb to express what an existing, precedent-matched flag shape already covers.

## Design Decisions

- **D1 — Value set of exactly one.** `--decision-status` accepts `accepted` and nothing else. `deprecated` / `superseded` → exit 2 (usage-error convention) with a message naming `lore invalidate --superseded-by` / `--reason`. `proposed` → exit 2 with the un-accepting rationale from Scope. An unrecognised string → exit 2 listing the accepted value. Rationale: a permissive value set here silently competes with the sole validity writer.
- **D2 — Type-scoped like `--kind`.** Target type must be `adr`; any other type → `VALIDATION_ERROR` (exit 4) naming the actual type. Reuses the type-scoping table shape `create.ts:94` already uses.
- **D3 — Read-merge-write, never clobber.** Mirrors `set.ts:472` exactly: fetch the target, spread its existing `extra`, overwrite only `decision_status`. A test must assert an unrelated `extra` key survives, because `CorpusService.set` replaces `extra` wholesale by construction.
- **D4 — No draft demotion.** Accepting must NOT reset an `approved` ADR to `draft`: `decision_status` is metadata, not content. `CorpusService.update`'s auto-reset keys off title/content only, so this holds by construction — and therefore needs an explicit REGRESSION assertion rather than trust.
- **D5 — Idempotent.** Accepting an already-`accepted` ADR is a no-op: exit 0, no version bump, no audit row claiming a change. CQS: the command reports the state it observed.
- **D6 — The value restriction lives in a PURE, vitest-reachable module**: `packages/lore/src/adapters/cli/decision-status-validation.ts`, following the established split convention (`create-task-validation.ts`, `handoff-input.ts`) — a `commands/*.ts` file transitively imports `loader.ts` (`bun:sqlite`) and is therefore unreachable from vitest. The command file does argument plumbing only; the closed value set and its refusal messages are decided in the pure module and unit-tested there, with the CLI e2e asserting the same behaviour end to end.
- **D7 — Audited and attributable.** Actor resolution follows the existing precedence (`--by` > `$LORE_ACTOR` > session tier > worktree-derived > OS username with a warning); the write is version-logged and audited like every other `set` patch.

## Acceptance Criteria

Prose form; the machine-checkable set is added with `lore ac add` and is what `lore verify` executes.

- **AC-1 (author→read end-to-end, HAPPY)**: create an `adr` with `--decision-status proposed`; run the accept writer; `lore get <slug> --json` reports `extra.decision_status === "accepted"`. This is the exact oracle shape the originating retro demanded — the write surface and the read surface must agree.
- **AC-2 (NEGATIVE, wrong type)**: the writer against a non-`adr` doc exits 4 and the stderr names the target's actual type.
- **AC-3 (NEGATIVE, owned transition)**: aiming at `deprecated` or `superseded` exits 2 and the stderr names `lore invalidate`.
- **AC-4 (REGRESSION, no demotion)**: accepting an ADR whose `status` is `approved` leaves `status === "approved"`.
- **AC-5 (STATE, no clobber)**: an ADR carrying an additional unrelated `extra` key still has that key, byte-identical, after the accept.
- **AC-6 (BOUNDARY, idempotence)**: two consecutive accepts both exit 0 and the doc's version number advances exactly once in total.
- **AC-7 (ERROR, unknown value)**: an unrecognised `--decision-status` value exits 2 and lists the accepted value.


## Acceptance Criteria (structured)

- [⚑] [script] AC-DS-1: create an adr with decision_status proposed, run the accept writer, then lore get --json reports extra.decision_status === accepted
  script: e2e — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-adr-decision-status.bun.test.ts -t 'accept end-to-end'
- [⚑] [script] AC-DS-2: the accept writer against a non-adr document exits 4 and stderr names the target's actual type
  script: e2e — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-adr-decision-status.bun.test.ts -t 'non-adr target'
- [⚑] [script] AC-DS-3: aiming the writer at deprecated or superseded exits 2 and stderr names lore invalidate
  script: e2e — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-adr-decision-status.bun.test.ts -t 'names lore invalidate'
- [⚑] [script] AC-DS-4: accepting an adr whose status is approved leaves status approved with no draft demotion
  script: e2e — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-adr-decision-status.bun.test.ts -t 'no draft demotion'
- [⚑] [script] AC-DS-5: an adr carrying an additional unrelated extra key still has that key byte-identical after the accept
  script: e2e — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-adr-decision-status.bun.test.ts -t 'unrelated extra key survives'
- [⚑] [script] AC-DS-6: two consecutive accepts both exit 0 and the document version advances exactly once in total
  script: e2e — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-adr-decision-status.bun.test.ts -t 'idempotent second accept'
- [⚑] [script] AC-DS-7: an unrecognised decision-status value exits 2 and stderr lists the accepted value
  script: e2e — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-adr-decision-status.bun.test.ts -t 'unknown decision-status value'
- [⚑] [script] AC-DS-8: the pure value-restriction module accepts the value accepted, refuses deprecated and superseded with a message naming lore invalidate, and refuses an unrecognised value listing the accepted value, all as a unit test with no store and no spawn
  script: test — bunx vitest run packages/lore/tests/unit/cli/decision-status-validation.test.ts -t 'closed value set'

## Code anchors

- packages/lore/src/adapters/cli/decision-status-validation.ts
- packages/lore/src/adapters/cli/commands/set.ts
