---
id: TASK-261
type: task
role: plan
title: "[Skill:implement] CLI + MCP surfaces + checklist_ref evidence"
status: archived
priority: high
phase: "Phase 3: Adapters and migration"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
links:
  - {id: TASK-260, type: blocks}
---
Estimate: M
Approach: lore phase status/checklist/track subcommands + lore feed phase-start + MCP lore_phase_status; evidence schema gains optional checklist_ref (additive, ac_ref byte-unchanged); recordChecklistVerifiedEvidence second port on the runner seam
Source: spec-spec-056 Module Boundary + D8
Dimensions: D-FUNC, D-UX
Scope-Alt: track CLI rendering minimal (list only)
Covers: AC-P-4, AC-P-6
AC:
- Given a claimed phase in a throwaway corpus, When lore phase status runs, Then scorecard renders N/M attested + checklist + dropped named, exit code distinguishes done/not-done/vacuous
- Given existing evidence tests, When run, Then ac_ref paths byte-identical (regression)
Integration:
- Full loop in throwaway corpus: create phase -> claim -> checklist add -> verify script item -> phase status shows green (commands recorded in evidence)

## Consumer call sites (spike output)

Grep sweep run 2026-07-19 by task-skill-research-migration-shape-spike-read-only-corpus-copy
against the live repo tree (read-only; no writes). This task owns the
CLI/MCP-surface subset (commands, tool registrations, badge renderers,
`lore tree` structural rendering). The service/core-layer rename subset
lives on `task-skill-implement-phaseworkflowservice-rename-checkpoint-conf`;
the migration-specific subset lives on `task-skill-implement-phasemigrationservice`.

### CLI commands with `doc.type === "task"` / `docType === "task"` branches
- `packages/lore/src/adapters/cli/commands/create.ts:251,393,530` — `docType === "task" && ...` gates for `--plan-id`/`--phase` validation (extend to `docType === "phase"`, keep legacy `task` creation path per D2 legacy READ tolerance — confirm with the PWS-rename task whether `lore create task` stays callable post-migration or is retired)
- `packages/lore/src/adapters/cli/commands/list.ts:227` — `filters["type"] === "task"` branch selecting the claim/evidence badge rendering path (see badges below)
- `packages/lore/src/adapters/cli/commands/tree.ts:258` — `{type: "task", ...}` query used to build tree rows
- `packages/lore/src/adapters/cli/commands/anchor.ts:152,242,322,338` — `target.type === "task"` dispatch: routes `lore anchor add/rm/list` to `TaskWorkflowService` vs `DriftCheckService` (spec targets) vs a loud "task or spec" error for any other type — add a `"phase"` arm here (or repoint the existing `"task"` arm)
- `packages/lore/src/adapters/cli/commands/verify.ts` — `--task` flag / `resolveTargetTask` threading for `lore verify`

### `lore tree` structural rendering (the biggest single UX change)
- `packages/lore/src/adapters/cli/commands/tree.ts:51,84,98` — "Task rows carry a claim/evidence workflow badge (AC-WF-9)" comment + `formatWorkflowBadge(task, nowIso, ttlMinutes)` calls on task rows
- `packages/lore/src/adapters/cli/commands/tree.ts:245-315` — the CURRENT phase-grouping logic: plans with declared `extra.phases[]` render `Phase: <name> (N tasks)` string headers grouping TASK CHILDREN under a synthetic (non-doc) heading. Post-SPEC-056, phase becomes an ACTUAL doc type with real children — this grouping-by-string-label code path is structurally superseded by grouping-by-real-child-doc. Decide explicitly whether `tree.ts` keeps a legacy string-grouping renderer for un-migrated corpora (AC-P-6 read-tolerance) alongside a new real-phase-doc renderer, or unifies them.
- `packages/lore/src/adapters/cli/commands/tree.ts:112-135` — `buildValidityBadges` (SPEC-043) — badge map keyed by doc id, merged with workflow badges; no rename needed but the merge point is where a `"phase"` badge (if any distinct one is added) would also land

### Badge renderers (`packages/lore/src/adapters/cli/utils.ts`)
- `:328` — `formatWorkflowBadge(doc: DocRecord, nowIso, ttlMinutes)` — reads `doc.extra.claim`/`doc.extra.verification_evidence` directly off a generic `DocRecord`, so the FUNCTION ITSELF needs no type-narrowing change (already doc-type-agnostic) — but its JSDoc and every call site's surrounding comment says "task"; update wording, not logic
- `:370` — `formatValidityBadge` — unaffected (knowledge/adr only)
- `:395` — `formatJudgmentBadge` — unaffected (review judgments)
- `:418` — `formatStalenessBadge` — unaffected (staleness probes)
- `packages/lore/src/adapters/cli/commands/list.ts:205-287` — `--type task` listing branches call `formatWorkflowBadge`; comments explicitly say "Task-type listings render a claim/evidence workflow badge" — needs a parallel `--type phase` branch (or repoint)
- `packages/lore/src/service/doc-type-meta.ts` — `deriveTypeMeta(doc, opts?)`'s `task` branch (`claimed_by?+claim_stale?+evidence_pass+evidence_fail`) keyed by `doc.type` — the `DocTypeMeta` discriminated union needs a `"phase"` member (or the `"task"` member gets renamed/extended); this is the SSOT `DocSummary.meta` derivation point (SPEC-036 §2 D3), do not add a second derivation path elsewhere

### MCP tool surface (`packages/lore/src/adapters/mcp/tools.ts`)
- `:84` — `DOC_TYPE_ENUM = z.enum(["prd","spec","adr","plan","knowledge","task"])` — needs `"phase"` added (additive; keep `"task"` for legacy corpora per AC-P-6)
- `:320-370` — `LoreClaimSchema` / `LoreReleaseSchema` / `LoreEvidenceAddSchema` / `LoreReadySchema` input schemas — field names (`task_id_or_slug` etc.) and JSDoc referencing "task" semantics
- `:370-388` — `LoreAnchorSetSchema` (SPEC-042 D9, extended by SPEC-045 for spec-target declarative-replace) — task-vs-spec dispatch semantics documented here need a phase arm
- `:1090-1140` — tool registrations: `lore_claim` ("Acquire an advisory execution lease on a task"), `lore_release` ("Clear the advisory execution lease on a task"), `lore_evidence_add` ("Append an oracle verification record to a task"), `lore_ready` ("Computed readiness report over a plan's tasks (never stored)") — description STRINGS need "task"→"phase" wording (or dual wording during the alias window)
- `:1145-1153` — `lore_anchor_set` handler: `if (target.type === "task")` dispatch to TaskWorkflowService-equivalent — same dispatch fork as `anchor.ts` above
- `:1189` — `lore_assess`: `corpusService.getPlanBundle(args.plan_id_or_slug)` — bundle consumption for the AI judge (cross-ref the PWS-rename task's `getPlanBundle().tasks` section)
- Tool descriptions elsewhere mentioning "task" in passing (module header comment `:716-730` listing "task-workflow tools: lore_claim, lore_release, lore_evidence_add, lore_ready") — update the module-level summary comment alongside the tool count if `lore_phase_status` is a genuinely new tool (it is, per the spec's Module Boundary)

### `assess` CLI + prompt surfaces
- `packages/lore/src/adapters/cli/commands/assess.ts:9,90` — `lore assess` flow comment + `getPlanBundle` call
- `packages/lore/src/ai/assess-template.ts:346,581` — prompt-builder JSDoc `{plan, spec?, tasks[]}` — needs a phase-count metric addition too (spec D9: `computeAssessmentFacts` gains `phase_count`, assess prompt version bump)
