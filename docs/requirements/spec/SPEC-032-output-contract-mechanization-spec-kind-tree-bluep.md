---
id: SPEC-032
type: spec
role: spec
title: "Output-contract mechanization (spec_kind + tree blueprint + text-projection splice)"
status: approved
priority: high
created: 2026-07-03
updated: 2026-07-27
tags: [spec-032, output-contract, tech-spec, spec-kind, tree-blueprint]
parent: PRD-001
---
# SPEC-032 — Output-contract mechanization (spec_kind + tree blueprint + text-projection splice)

> Kind: tech. Parent: PRD-001 §13. Background: the "Tree Consistency Guarantees" tech-spec (TECH-01KV4W88GZF74B98BHCBBV9GHD) lives in DocMan, not this corpus — it designed the now-LIVE PARENT_TYPE_CONTRACT + blueprint mechanism this spec arms. Its implementation lives in `packages/core/src/{doc-type-rules,tree-blueprint,graph-utils}.ts`.
> Consumer: plan → test → implement.
> Origin: PRD v0.5 §13.3 "remaining SPEC-032 scope". Design inputs verified against live code 2026-07-03 (see §2 reality table).

## 1. Problem & Goal

PRD v0.5 §13 declares an output contract but leaves four mechanization gaps. This spec mechanizes them so the contract is enforceable and the living PRD reads as a tree in every projection. **Non-goal**: re-designing the tree-consistency gates — they are already LIVE (§2); this spec only arms and extends them.

## 2. Implementation reality (verified — do not rebuild)

| Capability | Status | Location |
|---|---|---|
| `PARENT_TYPE_CONTRACT` + `isValidParentType`, wired into create/link | **LIVE** | `packages/core/src/doc-type-rules.ts`; `CorpusService._createImpl` + `.link` |
| Cycle detection (`ancestorChainWalk`) | **LIVE** | `packages/core/src/graph-utils.ts` |
| TreeCheckService drift (missing/extra/misplaced/cycle/orphan) + `--fix` | **LIVE** | `service/tree-check-service.ts`; `lore status --check-tree` |
| `ready()` computed readiness over `blocks` | **LIVE** | `service/task-workflow-service.ts` |
| `spec` extra schema | passthrough, no `spec_kind` | `packages/core/src/schemas.ts` |
| `OutlineService.resolve()` | returns `{content verbatim, resolvedComponents[], warnings[]}` — **no splice** | `service/outline-service.ts` |
| `CorpusService.get()` `resolve_mdx` param | **DEAD** — param is `_opts` (never read); `resolved_components` on the return type is never populated | `service/corpus-service.ts:345-411` |
| `lore.tree.yaml` at repo root | **ABSENT** (mechanism live, blueprint file missing) | — |

## 3. Scope (four net-new blocks; CLAUDE.md dedup lint SPLIT OUT → separate spec)

### 3.1 `spec_kind` taxonomy

New enum SSOT `packages/core/src/spec-kind.ts`:
```typescript
export const SPEC_KINDS = ["feature", "tech", "design"] as const;
export type SpecKind = (typeof SPEC_KINDS)[number];
```
Two-layer split (Zod validates, service defaults — Zod `superRefine` CANNOT inject a default, it can only `addIssue`; the ADR/knowledge pattern it mirrors only *rejects*, never defaults):
- **Schema (validate + fail-loud only)**: `specExtraSchema` gains `spec_kind: z.enum(SPEC_KINDS).optional()` under `.passthrough()`. An explicit unknown value (e.g. `"bogus"`) fails loud (`VALIDATION_ERROR`) — the enum rejects it. `.optional()` keeps the 108 existing specs (no `spec_kind`) valid unchanged.
- **Service (default-on-create)**: `CorpusService._createImpl` sets `extra.spec_kind = "feature"` when `type==="spec"` and the field is absent. This is where the default is materialized (schema can't), consistent with §4's change-site list.

CLI: `lore create spec --kind <feature|tech|design>` and `lore set --kind`.

### 3.2 `lore.tree.yaml` blueprint authoring + arming

The check mechanism is live but unarmed (no blueprint). Two coverage regimes, verified against `tree-check-service.ts`:
- **Blueprint-independent (full coverage once ANY blueprint exists)**: `misplaced` / `orphan` / `cycle` drifts come from `checkTree` Step 2–4, which run `isValidParentType` (`PARENT_TYPE_CONTRACT`) over EVERY doc regardless of blueprint shape. A contract-violating parent is always caught.
- **Blueprint-walk (only at modeled positions)**: `missing` / `extra` drifts come from `walkBlueprint`, which counts docs only at positions the blueprint models. **Pass-by-omission risk lives here**: any contract-legal position the blueprint omits gets NO min/max accounting — silently unchecked, and `check-tree` still exits 0.

Therefore the blueprint must model every contract-legal parent position, not just the census-popular ones. Live census (verified): knowledge is 74% under plans, 21% under specs (SPEC-026 assessments), 5% under prd; `PARENT_TYPE_CONTRACT` permits `knowledge:[prd,spec,adr,plan,knowledge]`, `adr:[prd,spec]`, `plan:[prd,spec]`, `task:[plan]` (task is a LEAF — knowledge under task is contract-illegal and MUST NOT appear in the blueprint). One deliberate exception: `knowledge → knowledge` (contract-legal recursive nesting) is NOT modeled — a static tree cannot express unbounded recursion (`walkBlueprint` recurses only through explicit `children`). Validity at all depths stays guaranteed by the blueprint-independent contract checks; only min/max accounting is absent below modeled depth, acceptable because the census shows zero knowledge-under-knowledge usage today. Full-contract blueprint:
```yaml
version: 1
root:
  type: prd
  children:
    - type: spec
      min: 1
      children:
        - type: plan
          min: 0
          children:
            - { type: task, min: 0 }
            - { type: knowledge, min: 0 }   # SPEC-026 assessments, retros
        - { type: adr, min: 0, children: [ { type: knowledge, min: 0 } ] }
        - { type: knowledge, min: 0 }
    - { type: adr, min: 0, children: [ { type: knowledge, min: 0 } ] }
    - type: plan
      min: 0
      children:
        - { type: task, min: 0 }
        - { type: knowledge, min: 0 }
    - { type: knowledge, min: 0 }
# knowledge → knowledge deliberately unmodeled (unbounded recursion; see §3.2 prose)
```
Authoring is calibrated against a real corpus census (not memory). AC pairs a positive check (0 drift on conformant corpus) with a NEGATIVE oracle (a deliberately mis-parented doc MUST raise `misplaced`) so AC-2 can't pass by omission.

### 3.3 Text-projection placeholder splice

Root cause: `resolve()` emits data but never splices. Add a pure function to OutlineService (SSOT for text rendering):
```typescript
export function renderResolvedToMarkdown(resolved: ResolvedDoc): string
```
It walks `resolvedComponents` by `position` (descending, to keep offsets stable — `resolve()` populates `position:{start,end}` from regex `match.index`; matches are non-overlapping, so descending splice is sound). Replaces each placeholder span in `content` with a deterministic markdown rendering (e.g. `<ChildrenOf />` → a bulleted `- [type] title (status)` list; `RecentDecisions` → same shape).

**Prerequisite (change site)**: `CorpusService.get()`'s `resolve_mdx` param is currently dead (`_opts`, never read; `resolved_components` never populated). Revive it: when `resolve_mdx` is set, call `OutlineService.resolve()` and populate `resolved_components` on the return. The splice consumers depend on this.

Wired into two consumers:
- `adapters/cli/commands/get.ts`: when `!--raw`, print `renderResolvedToMarkdown(...)` instead of raw `content`.
- `service/export-docs-service.ts`: write the spliced markdown as the `.md` body (closes the PRD §5 "raw tag in git" limitation).

Dashboard rendering of placeholders is **out of scope → SPEC-033** (React-node rendering off the same `resolvedComponents` data; this spec owns only the markdown-text projection). One `resolve()`, two projections (markdown text here, React nodes there).

### 3.4 `migrate spec-kind` audit + `ready` upstream warning

- `lore migrate spec-kind --dry-run` mirrors `PhaseService.migratePhases` / `commands/migrate.ts`: scans all `spec` docs, heuristically flags those whose title/content suggests `tech`/`design` but carry the defaulted `feature`, reports without writing (idempotent; `--dry-run` off applies).
- `TaskWorkflowService.ready()` gains an advisory field: a task under a plan whose parent spec is not `approved` is still computed-ready per blockers, but the record carries `upstream_unapproved: true` so `lore ready` can warn. Never blocks (advisory, consistent with SPEC-025's no-daemon/read-side ethos). **Signature note**: the pure `evaluateReadiness()` currently takes no plan/spec-status input; this adds a parameter (the parent spec's status) — a pure-fn signature change that gets its own direct unit test (AC-6).

## 4. Layer Stack map

```
packages/core/src/spec-kind.ts            ← SPEC_KINDS enum SSOT (new)
packages/core/src/schemas.ts              ← specExtraSchema + superRefine (spec_kind) (change)
lore.tree.yaml                            ← blueprint at repo root (new)
packages/lore/src/service/outline-service.ts        ← renderResolvedToMarkdown pure fn (new export)
packages/lore/src/adapters/cli/commands/get.ts      ← splice on non-raw (change)
packages/lore/src/service/export-docs-service.ts    ← splice .md body (change)
packages/lore/src/service/task-workflow-service.ts  ← ready()/evaluateReadiness() upstream_unapproved (change)
packages/lore/src/adapters/cli/commands/migrate.ts  ← spec-kind subcommand (change)
packages/lore/src/service/corpus-service.ts         ← spec_kind default-on-create (§3.1) + revive get() resolve_mdx (§3.3) (change)
```

## 5. Acceptance Criteria

- **AC-1** `spec_kind` write-time validated: `create spec` with no `--kind` persists `extra.spec_kind="feature"`; `--kind design` persists `"design"`; `--kind bogus` exits VALIDATION_ERROR; all 108 existing specs still validate.
- **AC-2** `lore.tree.yaml` authored covering all contract-legal parent positions (incl. knowledge-under-adr; knowledge-under-knowledge exempt per §3.2 — recursion unmodeled by design); `lore status --check-tree` exits 0 on the current corpus AND a negative regression test asserts a deliberately mis-parented doc raises `misplaced` (guards against pass-by-omission).
- **AC-3** `renderResolvedToMarkdown` splices every whitelisted placeholder; `lore get <prd>` (non-raw) stdout shows §5 as a rendered child list, not `<ChildrenOf />`; a regression test pins round-trip (raw tag in → rendered list out).
- **AC-4** `export-docs` writes the spliced body; the PRD `.md` in git shows the rendered tree (closes PRD §5 limitation). Export drift detection still clean.
- **AC-5** `lore migrate spec-kind --dry-run` lists candidate mistyped specs without writing; re-run identical (idempotent).
- **AC-6** `evaluateReadiness()` (pure fn) gains the parent-spec-status parameter and has a direct unit test; `ready()` sets `upstream_unapproved` when the plan's parent spec isn't approved; `lore ready` surfaces it; still never blocks.
- **AC-7** (AMENDED post-implementation 2026-07-06, phase-review APPROVED): the resolved-components data path is proven at the ADAPTER seam, not inside CorpusService. Implementation discovered HTTP/MCP adapters already call `OutlineService.resolve()` themselves (thin-pipe precedent x2), so reviving `CorpusService.get(resolve_mdx)` would force a cross-service import the codebase forbids. Shipped: CLI `get.ts` brought in line with the same adapter-level resolution (`--json` exposes `resolved_components`); `GetOpts.resolve_mdx` documented @deprecated with rationale JSDoc; service CLAUDE.md records the seam. Tests assert non-empty resolution at the adapter output. Original wording ("revive the dead param") superseded.
- **AC-8** `bun run typecheck` + `bun run test` (both runners) pass.

## 6. Test dimensions

HAPPY (default feature kind; splice renders) / NEGATIVE (bogus spec_kind rejected) / BOUNDARY (empty ChildrenOf → empty list not crash; blueprint min=0) / ERROR (malformed lore.tree.yaml → fail loud, not silent) / STATE (migrate idempotency; ready upstream flag flips with parent approval) / REGRESSION (108 existing specs validate; export round-trip; write-flow/read-flow e2e unaffected). Schema/pure-fn tests by tester subagent (complexity ≥ medium).

## 7. Downstream handoff

- implement: interfaces above as TS; mirror existing migrate/superRefine patterns; renderResolvedToMarkdown is a pure fn (referentially transparent — easy oracle).
- test: AC-1..6 each map to a dimension; splice round-trip + migrate idempotency are the highest-value oracles.
- SPEC-033: consumes `resolvedComponents` for React rendering (this spec proves the data path via the markdown projection).

## 8. Split-out note

CLAUDE.md duplication lint (PRD §13.4 SSOT oracle) is deliberately NOT in this spec — it's orthogonal (text-similarity over CLAUDE.md files, not corpus tree/schema mechanics) and needs its own algorithm design (similarity threshold). Tracked as a follow-up spec candidate.

## Quality gates (module mode)
- [x] No circular deps (spec-kind.ts leaf; renderResolvedToMarkdown pure)
- [x] Single responsibility per change site
- [x] Public API testable black-box (pure fn + Result-returning services)
- [x] Dependencies injectable (services already DI'd on StoreInterface)


## Code anchors

- packages/lore/src/service/tree-check-service.ts
- packages/lore/src/flows/blueprint-flow.ts
