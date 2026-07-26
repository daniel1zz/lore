---
id: TASK-245
type: task
role: plan
title: "Add --requires-uat authoring path to lore create plan (CLI + MCP)"
status: archived
priority: medium
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: PLAN-060
plan: PLAN-060
---
# Add --requires-uat authoring path to lore create plan (CLI + MCP)

## Problem

SPEC-058's plan-promote `requiresUat` predicate (`gate-predicates.ts::requiresUatDeclared`) requires `plan.extra.requires_uat === true` when the plan's ancestor spec is a `spec_kind` whose configured verification profile declares `required_uat: true` (the `design` profile does). But there is NO supported way to set that flag:
- `lore create plan` — `buildExtra` (`packages/lore/src/adapters/cli/commands/create.ts:514`) returns `undefined` for `docType === "plan"`; there is no plan branch and no `--requires-uat` flag.
- `lore set` — no extra-writing flag; `CorpusService.set` replaces extra wholesale (would wipe phases), so it is not a safe path either.
- MCP `lore_create` — `LoreCreateSchema` (`packages/lore/src/adapters/mcp/tools.ts:114`) has no `requires_uat`.

`plan.extra.requires_uat` IS already in the schema (`packages/core/src/schemas.ts:337`, `planExtraSchema`, optional boolean) — only the authoring path is missing.

## Change

### CLI (`packages/lore/src/adapters/cli/commands/create.ts`)
1. Add a `--requires-uat` boolean flag (citty `type: "boolean"`), described as plan-only, SPEC-058.
2. Add `"requires-uat": ["plan"]` to `TYPE_SPECIFIC_FLAGS` so passing it on a non-plan type is rejected as a mismatch (exit 4) exactly like `--decision-status` on a non-adr — follow the existing mismatch-validation block (~line 203).
3. Extend `buildExtra` with a `plan` branch: `if (docType === "plan" && requiresUat) return { requires_uat: true };` — thread the new arg from the call site (~line 404). Absent/false flag → plan extra stays `undefined` (byte-identical to today; REGRESSION).

### MCP (`packages/lore/src/adapters/mcp/tools.ts`)
4. Add optional `requires_uat: z.boolean().optional()` to `LoreCreateSchema`, documented plan-only. In the `lore_create` handler, when the target type is `plan` and `requires_uat === true`, merge `{ requires_uat: true }` into `createInput.extra` (mirror the existing `file_anchors` merge at ~line 786). On a non-plan type, follow the SAME consistency stance the CLI takes (reject the mismatch) OR ignore — MATCH whatever the CLI does so the two surfaces agree; document the choice.

## Required tests (six-dimension)

### `packages/lore/tests/unit/adapters/cli-create.bun.test.ts` (bun runner — create imports the bun-only loader)
- HAPPY: `lore create plan --requires-uat ... ` → created plan's `extra.requires_uat === true`
- NEGATIVE/REGRESSION: `lore create plan` WITHOUT the flag → `extra.requires_uat` absent (not `false`, absent)
- ERROR: `lore create spec --requires-uat ...` (or any non-plan type) → exit 4 with a mismatch message naming the flag
- BOUNDARY: `--requires-uat=false` (explicit false) → treated as absent, no key written

### `packages/lore/tests/unit/adapters/mcp-tools.test.ts` (vitest)
- HAPPY: `lore_create` with `type: "plan", requires_uat: true` → created plan's `extra.requires_uat === true`
- REGRESSION: `lore_create` plan without the field → absent
- Consistency: non-plan type + `requires_uat: true` behaves as the CLI does (assert the same reject-or-ignore choice)

## Acceptance

- AC-V-6 (CLI): `cd packages/lore && bun test tests/unit/adapters/cli-create.bun.test.ts`
- AC-V-7 (MCP): `bunx vitest run packages/lore/tests/unit/adapters/mcp-tools.test.ts`
on `spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag`.
