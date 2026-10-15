---
id: ADR-041
type: adr
role: decision
title: "The product is a baseline tree; specs implement its rules through AC citations"
status: approved
priority: critical
created: 2026-10-07
updated: 2026-10-07
tags: [baseline, product-shape, spec-080]
parent: PRD-001
links:
  - {id: SPEC-081, type: supersedes}
---
# The product is a baseline tree; specs implement its rules through AC citations

## Status

Owner-decided 2026-10-07 (session 6b85319e); this document's lifecycle status is whatever `lore get` shows — the text does not assert it. Supersedes SPEC-080 trade-offs T1 (reject PRD nesting) and T2 (domain as spec kind `domain-overview`, not a first-class type), and the root PRD's "PRD-as-living-root" principle (see Consequences). Each decision below is stated in its FINAL form; how it got there is in "Decision history".

## Context

Reference method: `everything-workspace/skills/business-baseline/SKILL.md` (DDD modelling layer + BDD specification layer; product-owned durable rule tree root / branch / leaf; permanent rule ids; no implementation detail in the tree). Reference architecture layout: `everything-workspace/architecture/`.

Measured on this corpus, 2026-10-07 (read-only sqlite, specs created before this session):

- 164 live spec rows (166 including 2 soft-deleted); all 164 have `parent_id` = the root PRD. None hangs under a domain.
- Spec kinds among live rows: tech 96, (none) 34, feature 18, domain-overview 11, design 5.
- Root PRD at v77; `extra.outline[]` had 11 entries, one per domain-overview spec; domain-overview specs carry narrative only — no rule ids, no ACs.
- The root PRD's Goals table (G1–G16) is phase/version-indexed: an accumulated requirement log, not the product's current shape.
- The same AC id is claimed by more than one live spec (observed: `AC-ACS-1..8` in two specs).

Consequence: "what does lore do in domain X, and under which rules" has no single addressable answer; it is spread across per-requirement specs. North Star property 3 (addressability) fails as a symptom of the same gap.

Evidence for the decisions below: `knowledge-baseline-product-shape-validation-ledger-a1-spec-to` (experiments A1–A5).

## Decision

1. **Two current-state trees define the product; nothing else does.** The baseline tree (business) and the architecture tree (technical) are mutable and current-state only; history lives in version rows and change records, never in the trees' text. Specs do not define the product — a spec is an implementation.
2. **Baseline nodes are a new first-class document type** with root / branch / leaf roles at arbitrary depth, its own schema and gates — not a spec kind, not nested PRDs. A branch is a bounded context (boundary where a term changes meaning); a leaf is one business point (single verb, user-meaningful result, Command → Constraint → Domain Event); only leaves carry rules. Lore's own branches (owner-approved): corpus · review · baseline · specification · execution · session · hygiene · autonomy · issue-loop · distribution · sync · context.
3. **The architecture tree follows `everything-workspace/architecture/`** (read 2026-10-07 from its `overview.md` and `standards/README.md`): `current-state/` (system overview, module map, dependencies, data flow, deployment, external dependencies, known issues, one card per module); `target-state/` (target architecture, boundaries, migration roadmap); `standards/` (rules new code must follow, each in four parts — Current Reality / Target Rule / Current Exceptions citing debt ids / Migration — under a stable principle layer); `adr/`; an architecture-debt registry (id, scope, issue, severity, target, owner, status open | in-progress | mitigated | resolved | accepted, refs; existing debt may stay, new or enlarged debt is forbidden). Technical structure — adapters, layering, schema, storage, sync, telemetry — lives here, never under a business leaf.
4. **Rules are citable units with permanent ids.** Baseline leaf rules carry: permanent id, one-sentence business statement, confidence (🟢 established / 🟡 Undecided / 🟡 Unconfirmed), `enforced_by` (guaranteed / both / prompt-only), boundary examples; a leaf carries a `Depends on` table; a branch carries a ubiquitous-language table. Architecture standard rules and debt entries also carry permanent ids. An id is never reused.
5. **Specs relate to the trees many-to-many, through AC citations; a spec has no single tree parent.** Every AC cites ≥ 1 live rule id — baseline leaf rule or architecture standard rule — enforced by a deterministic service-layer gate (CLI / MCP / HTTP identical); a missing, deprecated or retired id is refused. "Which specs implement this leaf / standard" and "which rules have no citing AC" are computed from citations. Placement is never decided by judgment.
6. **The PRD keeps strategy only.** A new baseline root carries "what the product is" and branch navigation; the PRD keeps why / for whom / non-goals and stops being the tree root. Its `R-##` requirements become leaf rules; its outline entries become branches.
7. **Existing specs are migrated, not abandoned:** first excavate baseline rules and architecture standards branch by branch from current behaviour; then map each live spec's ACs to rule ids by two independent mappings, with the owner adjudicating rule-level disagreements; the citation gate enforces only once lore's own corpus is migrated (exemptions capped and listed).
8. **Shipped to every consuming project** through the normal assets path, with an adoption mode in which the citation gate reports but does not refuse until a project adopts.
9. **Validate before committing, and deliver in three slices** (owner-approved with the PRD): (1) type + rules + evidence-computed rule state + report-only citation check + `specification`-branch pilot; (2) remaining branches + gate enforcing; (3) architecture tree + PRD split + SPEC-080 retirement + distribution. PRD: `spec-product-baseline-architecture-trees-the-product-s-current`.

## Decision history (how the final form was reached, same day)

- Initial: "a spec hangs under the leaf it implements" (old decision 1) and "all existing specs are re-parented under baseline leaves" (old decision 4).
- A1 refuted single-leaf placement (50.6% / 60.4% vs 70%) → owner: technical architecture is a separate tree (now decision 3).
- A4 showed the two-tree space covers nearly every spec but agent placement is not reproducible (66.5% vs 85%) → owner: placement computed from AC citations, one home per spec (old decision 11).
- A5 refuted one computed home (80% vs 85%; about half the ACs of a "specification" spec belong elsewhere) → owner: many-to-many through AC citations, no single tree parent (now decision 5). Old decisions 1, 4 and 11 are restated above in this final form.
- Phase 1A (PRD): PRD split, distribution to consumers, rule fields, validate-first — now decisions 6, 8, 4, 9.

## Open for the design spec (not decided here)

- Data model: what replaces a spec's required `parent_id` (and plan → spec parenting); whether rules are structured data or parsed markdown; rule-id grammar and scope (global vs per-branch), storage, and concurrency-safe allocation; the AC citation field and its effect on already-approved specs; resolution of duplicate AC ids.
- Every consumer that today derives structure from a spec's parent: `lore tree`, tree-check / parent_id↔link reconciliation, orphan advisory, spec-create's parent-type contract, dashboard home, bootstrap root pointer, `--check-requirements` — each moves to citation-computed relations or the baseline root.
- How the architecture tree's sections map onto lore doc types (new type vs typed sections; debt as a typed registry); how the existing `adr` type folds in.
- Fate of the 11 domain-overview specs and `extra.outline[]` (expected: converted into branches).
- Retirement shapes (deprecated vs retired-never-a-rule); whether change records exist and their shape (change-set `impact` not selected for v1); their numbering under concurrent sessions (the reference method's `R-<n>` relies on exclusivity — not acceptable under the North Star).
- A lore-specific boundary for "no implementation detail in the baseline" (lore's vocabulary is technical).

## Consequences

- **Supersedes the root PRD's PRD-as-living-root principle** (§1 "every document is reachable through a tree rooted at the product PRD", §5, goal G2 "PRD-as-living-root tree navigable", and the `--check-tree` conformance in G8 insofar as it assumes the PRD root). The PRD must be amended in slice 3 (BL-6); until then the old principle remains what the code enforces.
- SPEC-080's outline machinery (outline verbs, plan-close `prdOutlineSynced`, PRD budget oracle) is re-scoped or retired in slice 3 (BL-16).
- Every pre-existing spec is a migration target; per the standing lesson on new gates, the sweep is budgeted in the same slice that arms the gate (slice 2).
