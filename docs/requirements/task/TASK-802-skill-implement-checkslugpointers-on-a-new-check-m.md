---
id: TASK-802
type: task
role: plan
title: "skill-implement: checkSlugPointers on a new --check-memory-pointers flag, measureEmphasis with a single threshold, and the emphasis config block"
status: archived
priority: medium
phase: "P2-slug-and-emphasis"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-139
plan: PLAN-139
---
## Objective

Implement Phase 2's two deterministic metrics: corpus-slug pointer resolution and emphasis saturation.

## What to build

1. **`checkSlugPointers(content, docExists)` in `claude-md-admission.ts`** → `MemoryFileFinding[]`, kind `slug_pointer_missing`, DETERMINISTIC (exit-relevant).
   - Grammar: backtick-quoted tokens matching a corpus slug shape (`{type}-{kebab}` where type is one of the corpus doc types). ⛔ It must NOT match `plan-close`, which is a GATE name appearing in `lore gate plan-close --explain`. A naive `plan-*` pattern produces exactly that false positive — measured this session on the root CLAUDE.md.
   - `docExists` is INJECTED. ⛔ The module stays pure — no store import, no fs.
2. **`lore status --check-memory-pointers`** — a NEW flag joining the corpus-loading family (`--check-tree`/`--check-drift`/`--check-requirements`/`--check-prd-budget`/`--check-issues`), which already share one `loadLoreApp()`. ⛔ Do NOT add slug checking to `--check-claude-md`: that branch is corpus-free by SPEC-095 D9, dispatches before `loadLoreApp`, its help says "never loads the corpus DB", and `assets/hooks/claude-md-guard.sh` maps its exit codes 0→allow / 3→block / other→fail-open. See decision N14.
3. **`measureEmphasis(content, maxPerKb)` in `claude-md-admission.ts`** → kind `emphasis_saturated`, DETERMINISTIC, on the corpus-free `--check-claude-md`.
   - ⛔ SINGLE threshold, NOT the three-band ceiling machinery (N5). Marker density is not capacity; reusing warn/evict fractions would smuggle a third capacity concept into a schema restricted to lines/bytes. The finding must carry no warn/evict fraction field.
   - Counts emphasis markers (⛔, IMPORTANT, MUST, NEVER) per KB.
4. **`context.memory_files.emphasis.max_per_kb`** in `contextConfigSchema` (`packages/core/src/config.ts`) — zod default ONLY, the single home of the number (D1, anti-dual-write).
   - ⛔ The default MUST land above this repo's measured spread so ZERO files trip on landing (N6, and the back-catalog rule). Measured density per KB, this session: root CLAUDE.md 1.4; cli 1.2; store 1.1; service/http/ai 1.0; core 0.6; dashboard 0.2; mcp 0.1; eval 0. Pick a default above 1.4 and justify it in the schema docblock.
5. Wire both into `runMemoryFileChecks` and render the new kinds via `claude-md-render.ts`.

## Constraints

- ⛔ Both service modules stay PURE. Predicates injected.
- ⛔ Every call goes through `runMemoryFileChecks` — `status.ts` must not name an individual metric function (AC-COMPOSE-1).
- ⛔ Run the Phase 2 oracles BY HAND plus `bun run typecheck`; `bun run test:changed` is structurally unreliable here.
- ⛔ Adding a `.strict()` config key means an older binary rejects a newer config.yaml — note the version floor in the schema docblock.

## Definition of done

The four Phase 2 oracles green, each verified with its declared `--falsifier-*` mutation producing the declared EXACT exit code. Record evidence, then `lore release`. ⛔ Do NOT run `lore done`.

## 6. N15 — fold headroom INTO the composition entry

⛔ Added after a `lore review` escalation. Phase 1 shipped `computeHeadroom`/`computeHeadroomWarnings` as DIRECT calls in `status.ts`, outside `runMemoryFileChecks`, while the spec's Module Boundary declared that entry the "sole public API" — and AC-COMPOSE-1's banned-function list omitted exactly those two functions. The boundary statement and the AC meant to enforce it were jointly false for one slice.

Required in this task:

- Extend `runMemoryFileChecks`'s return to `{ deterministic, advisory, headroom, warnings }` and move both calls inside it.
- `status.ts` must stop calling `computeHeadroom`/`computeHeadroomWarnings` directly.
- Extend `scripts/check-claude-md-composition.ts`'s banned list from 5 functions to 7 (adding those two) — the script currently passes while the bypass exists, which is why nothing caught it.
- This also unblocks AC-RULES-1 in Phase 3, whose oracle reads `role: "rules"` headroom entries the old return type did not expose.

- ⛔ Same acceptance unit: `packages/lore/src/service/CLAUDE.md` currently asserts `runMemoryFileChecks` is the "SOLE composition entry". That sentence is FALSE until this task lands — `computeHeadroom`/`computeHeadroomWarnings` bypass it today. Fix the code and correct that line in the same change; a note recording a gap becomes a stale assertion the moment the gap closes. Keep the edit tight: that file has ~1067 bytes of headroom left.
