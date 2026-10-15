---
id: SPEC-068
type: spec
role: spec
title: "Upstream asset-ization — prompt & skill as first-class knowledge sub-types"
status: approved
priority: high
created: 2026-07-08
updated: 2026-10-10
tags: [p1, upstream-asset, prompt-skill, ioc]
links:
  - {id: ADR-002, type: implements}
---
**spec_kind:** tech · **implements →** `adr-corpus-governed-active-ai-workflow-inversion-of-control-with` (P1 of P1–P4)

## Overview/Goal

Promote **prompt** and **skill** to first-class, versioned, reviewable, eval-bearing lore assets — so the "upstream production functions" (how to write a spec, how to consume a plan) become governed corpus objects instead of tribal knowledge living in Claude Code skills / CLAUDE.md.

**Key decision (blast-radius weighted):** implement as two new `knowledge` **sub_types** (`prompt`, `skill`), NOT as new top-level doc types. Rationale: "first-class eval-bearing" means *sharing the review→version→calibration loop* (SPEC-034/035), which sub_type already grants in full. A new top-level `docTypeSchema` entry triggers the entire create/store/CLI/MCP/tree/export regression surface for only semantic purity — not worth it. This is the ADR's thin-glue / buy-not-build stance applied. The slice-1 seed rule doc is already `knowledge/reference`, so this is a natural continuation.

## Scope

**IN:**
- `KNOWLEDGE_SUB_TYPES` += `prompt`, `skill`.
- `promptExtraSchema` = `{ variables?: string[], target_surface?: string }`; `skillExtraSchema` = `{ applies_to?: string, trigger?: string }`. Validated per-sub_type in the knowledge `superRefine` branch (mirrors the `assessment` pattern).
- Migrate the slice-1 seed rule doc `knowledge/reference` → `knowledge/skill` with `extra.skill.applies_to = "spec"`; update the idempotent seed script.
- **Value-add for slice-1:** gate feeding-source lookup changes from hardcoded title → discovery by `sub_type=skill AND extra.skill.applies_to=<produced type> AND status=approved`. Generalises active feeding for any future doc-type gate.

**OUT (later):** prompt template-variable interpolation/render engine (consumption side); skill auto-execution (P2/P3 already cover hook-triggered execution); new top-level doc type (rejected above); P4 bidirectional linkage beyond `applies_to`.

## Design

- **Sub-type dispatch:** the knowledge branch of `createDocInputSchema.superRefine` (and `set()`) routes `extra` to `promptExtraSchema` / `skillExtraSchema` by `sub_type`; unknown fields rejected loud, all fields optional in this slice (assets can be minimal).
- **Discovery port:** a small read helper `findFeedingSkill(store, appliesTo)` returns the newest `approved` `knowledge/skill` whose `extra.skill.applies_to` matches — replaces slice-1's title constant. Backward-compat: if none found, gate still emits `missing` reasons with a placeholder (slice-1 behavior preserved).
- **CLI:** `lore create knowledge --sub-type prompt|skill …` works once the enum admits them (create path already forwards arbitrary sub_type to the validator).

## Acceptance Criteria (deterministic oracles)

- **AC-P1-1** `knowledge` docs with `sub_type=prompt` / `sub_type=skill` validate; malformed `extra.prompt`/`extra.skill` shapes reject with `VALIDATION_ERROR`; existing sub_types (reference/assessment/retro/…) still validate (full-suite regression green).
- **AC-P1-2** seed script yields the rule doc as `knowledge/skill` with `extra.skill.applies_to="spec"`, status `approved`; idempotent (re-run = no dup; upgrades an existing reference-version in place).
- **AC-P1-3** gate feeding resolves the rule doc via `applies_to="spec"` discovery (not title); slice-1 `spec-loop-e2e` remains green (backward-compat).
- **AC-P1-4** e2e: `lore create knowledge --sub-type skill --extra applies_to=spec` (approved) → a violating spec-create → gate feeds THAT skill's slice, discovered by applies_to.

## Risks

| Id | Sev | Risk | Mitigation |
|---|---|---|---|
| R1 | H | core schema change breaks existing knowledge validation | full 673 bun + 2890 vitest regression after each task |
| R2 | M | gate lookup title→applies_to misses a call site → slice-1 e2e breaks | T3 must re-run `spec-loop-e2e.bun.test.ts` green |

## Boundaries (from ADR)

Thin glue: reuse knowledge's review/version/link/calibration wholesale. Only new surface = 2 enum values + 2 extra schemas + 1 discovery helper + seed migration. No new mechanism.


## Acceptance Criteria (structured)

- [⚑] [script] AC-P1-A: findFeedingSkill discovery by applies_to passes
  script: test — bunx vitest run packages/lore/tests/unit/service/corpus-service-find-feeding-skill.test.ts
- [⚑] [script] AC-P1-B: knowledge prompt/skill sub_type schema passes
  script: test — bunx vitest run packages/lore/tests/unit/core/schemas.test.ts

## Code anchors

- packages/core/src/schemas.ts
