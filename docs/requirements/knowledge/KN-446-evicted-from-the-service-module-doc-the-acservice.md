---
id: KN-446
type: knowledge
role: knowledge
title: "Evicted from the service module doc: the AcService and DriftCheckService Service Map rows, verbatim"
status: approved
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
---
## Overview

Two Service Map rows evicted verbatim from `packages/lore/src/service/CLAUDE.md`
on 2026-08-12, when merging `task-bind-ownership-a-claim-records-its-branch-commits-carry`
pushed that file from 14704 to 15777 bytes and broke
`packages/lore/tests/unit/service/claude-md-eviction-floor.test.ts` — which
demands runway BELOW the advisory band (14746), not merely below the eviction
floor (16384).

Both rows were chosen because they violated the Service Map's own stated
contract, printed directly above the table: "One line per service — scope
keywords only; mechanism detail lives in the archived snapshot or each service's
own module header." Each had grown into a paragraph. Evicting them restores the
local rule instead of trading one arbitrary block for another.

The deterministic gate (`lore status --check-claude-md`) reported "within budget
(0 findings)" at 15777 bytes and only raised an advisory warning. The repo's own
test is the stricter oracle, and it is the one that caught this.

## Evicted verbatim — `AcService` row

> | `AcService` | add/list/remove/setCriterion on `spec.extra.acceptance_criteria`; per-AC evidence coverage across child plans' tasks. `setCriterion` edits IN PLACE — id/`mode` immutable, `ac_ref` never dangles — and bumps `oracle_generation` EXACTLY WHEN a script command's text changes (statement-only or same-command edits do not), marked additively, never rewritten. Rendered by `retiredOracleMarker` on BOTH surfaces — `commands/ac.ts` and `flows/task-feed-flow.ts`. ⛔ TWO COPIES, cross-checked only by `feed-retired-oracle-visibility.bun.test.ts`; no `@lore/core` SSOT yet. An OPT-IN D8 path-existence check refuses a script command naming a nonexistent test path unless `--allow-missing-path` gives a reason (tracked in `spec.extra.allow_missing_path_declarations`); `countUnredeemedAllowMissingPath` recomputes from the live filesystem every call, DERIVED from `listUnredeemedAllowMissingPath` (AC-FR-5 enumerator) |

Load-bearing facts inside it, for anyone deciding whether to re-inline part of it:

- `setCriterion` edits in place; `id` and `mode` are immutable; `ac_ref` never dangles.
- `oracle_generation` bumps EXACTLY WHEN a script command's text changes — a
  statement-only edit does not bump it. Generations are marked additively and
  prior-generation evidence is never rewritten.
- `retiredOracleMarker` renders on TWO surfaces, `commands/ac.ts` and
  `flows/task-feed-flow.ts`. These are TWO COPIES with no `@lore/core` SSOT;
  the only thing cross-checking them is
  `feed-retired-oracle-visibility.bun.test.ts`. That duplication is a live
  hazard, not a settled design.
- The D8 path-existence check is OPT-IN: a script command naming a nonexistent
  test path is refused unless `--allow-missing-path` supplies a reason, recorded
  in `spec.extra.allow_missing_path_declarations`.
- `countUnredeemedAllowMissingPath` recomputes from the live filesystem on every
  call and is DERIVED from `listUnredeemedAllowMissingPath` (AC-FR-5), so the
  count can never disagree with its own member list.

## Evicted verbatim — `DriftCheckService` row

> | `DriftCheckService` | `checkDrift` over `extra.code_anchors` for every type in `ANCHOR_SCANNED_DOC_TYPES` (spec + knowledge) — the one list the scan, the RMW refusal and the CLI's accepted types all read; owns those RMW verbs. `specs_checked`/`knowledge_checked` reported separately; `DriftRow` identity is all doc-flavoured (`doc_id`/`doc_slug`/`doc_type`/`doc_status`), composed once at `code-anchors.ts::docIdentityOf` |

Load-bearing facts:

- `ANCHOR_SCANNED_DOC_TYPES` (spec + knowledge) is ONE list read by three
  consumers: the scan, the read-modify-write refusal, and the CLI's accepted
  types. Adding a type in one place without the others is the defect this
  single-list shape prevents.
- `specs_checked` and `knowledge_checked` are reported separately, so a breach
  can be attributed to the doc type it came from.
- `DriftRow` identity is doc-flavoured throughout (`doc_id` / `doc_slug` /
  `doc_type` / `doc_status`) and composed exactly once, at
  `code-anchors.ts::docIdentityOf`.

## Why this is eviction and not deletion

The module doc's own invariant states the rule: tripping the floor "is fixed by
EVICTION (block → corpus doc + one-line pointer), never by raising the ceiling,
never by splitting lines (the constraint is BYTES), never by relocating the fact
elsewhere."

Both rows now carry scope keywords plus a pointer to this document. Nothing was
raised, split, or quietly moved into a neighbouring file.
