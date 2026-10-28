---
id: SPEC-270
type: spec
role: spec
title: "Output Contract & Document Taxonomy (domain overview)"
status: deprecated
priority: medium
created: 2026-07-26
updated: 2026-10-10
tags: []
---
## 13. Output Contract & Document Taxonomy

### 13.1 Spec kinds

`spec` docs carry `extra.spec_kind: "feature" | "tech" | "design"`, **write-time validated as a Zod enum (fail-loud; unknown values rejected)**, default `"feature"` (backward compatible — all existing specs are feature specs). A one-shot audit `lore migrate spec-kind --dry-run` (parity with `migrate phases`) flags existing specs that are actually tech/design before the taxonomy is relied upon. Design specs are first-class normative contracts: reviewed, approval-gated, implementation must conform. Binary/HTML artifacts (prototypes, mockups, screenshots) live in-repo under `docs/design/`, referenced from the design spec by relative path — the corpus stores the normative text, the repo stores the artifact.

### 13.2 Stage → required output → completion gate

| Stage | Required output | Mounts under | Stage complete when |
|---|---|---|---|
| Direction / inception | PRD version bump | root | PRD approved |
| Feature definition | spec (kind=feature) | PRD | spec approved |
| UI/UX design | spec (kind=design) + repo prototype artifact | PRD, `relates`→feature spec | spec approved |
| Technical decision | adr | prd or spec | adr accepted |
| Structural tech design | spec (kind=tech) | PRD, `relates`→driving spec/adr | spec approved |
| Execution | plan → tasks + verification evidence (SPEC-025) | spec → plan | tasks archived |
| Closeout | assessment (SPEC-026) + retro knowledge | plan | assess verdict persisted |

Cardinality: one required output doc per stage instance; multi-spec efforts repeat rows per spec. All spec kinds mount under the PRD — the live `PARENT_TYPE_CONTRACT` keeps `spec: ["prd"]` (NOT widened to spec-under-spec); cross-references between specs use typed links, not tree parenthood.

### 13.3 Enforcement layers (status: partially live)

1. **Create-time hard gate — LIVE**: `PARENT_TYPE_CONTRACT` (`@lore/core` doc-type-rules) already rejects illegal parent types at create/link time. Escape hatch: `knowledge` mounts anywhere — ad-hoc notes are never blocked.
2. **Check-time soft gate — shipped, unarmed**: `lore status --check-tree` exists but the repo has no `lore.tree.yaml` blueprint yet. SPEC-032 authors the blueprint and arms the check.
3. **Process convention (NOT a hard gate)**: a stage is complete iff its doc reaches `approved`. Anti-rubber-stamp rule: for design/tech specs the approver SHOULD differ from the author (agent-authored → human-approved). Candidate hardening (SPEC-032): `lore ready` warns when a plan's parent spec is not approved. **§14 mechanizes this layer**: approver≠author becomes a hard invariant (I1), and the approve decision itself becomes AI-triaged with confidence-gated escalation.

Remaining SPEC-032 scope: `lore.tree.yaml` authoring, `spec_kind` Zod enum + `migrate spec-kind` audit, text-projection placeholder splicing (both `lore get --resolve-mdx` stdout and `export-docs` `.md` — `OutlineService.resolve()` today emits `resolvedComponents` data but leaves `content` verbatim), ready-warning, CLAUDE.md duplication lint. SPEC-033 scope: dashboard home replaced by the resolved-PRD projection (today's home is an unrelated hardcoded doc-list — a page rewrite, not a tweak).

### 13.4 Context boundary (SSOT rule)

- **Lore corpus**: everything about the product and the process — requirements, designs, decisions, plans, evidence, assessments, learnings.
- **In-repo CLAUDE.md**: code-adjacent technical navigation only (how to modify this code), atomically co-evolving with the code, referencing Lore slugs for the "why".
- A fact lives in one place and is linked from the other, never duplicated. Verification oracle (SPEC-032 candidate): a doc-lint flags CLAUDE.md sections that duplicate ≥N% of a corpus doc's text.

### 13.5 Dashboard = PRD projection

Dashboard home = resolveMdx-rendered living PRD (SPEC-004 machinery: ChildrenOf / RecentDecisions / ActivePlans / HealthStats) + pending-review and ready-task panels. Product current shape = the resolved PRD; iteration history = version log + assessment timeline; decisions = RecentDecisions + adr filter. Full page rewrite specified in SPEC-033. Positioning broadened by §21 (owner, 2026-07-24): the dashboard evolves toward a general admin console; this Home-as-resolved-PRD directive is unchanged by that broadening.

### 13.6 Ordinal identity (corpus-allocated, SPEC-084 — live since 2026-07-27)

- **`SPEC-N` / `ADR-N` are corpus-allocated ordinals, never authored.** `docs.ordinal` (INTEGER, partial UNIQUE index `(type, ordinal) WHERE ordinal IS NOT NULL`, soft-deleted rows included → numbers are never reused) is the sole identity authority; titles are pure prose — a title matching `^(SPEC|ADR)-\d+\b` is rejected (VALIDATION_ERROR) on BOTH write paths (create schema superRefine + `set` title patch).
- **Allocation**: store-atomic at create (`insertWithAllocatedOrdinal`, MAX+1 over the index, bounded retry, loud `ORDINAL_ALLOCATION_EXHAUSTED`); exempt→numbered kind flips via `allocateOrdinalForExisting`; `domain-overview` kind carries NULL ordinal. Repair-only targeted assignment via internal `assignOrdinalForRepair` (D7 path, no public flag).
- **Display**: composed at read time by core `formatDocDisplayId`/`composeDocDisplayTitle` (single composition site, import-graph-pinned); the composed string is never stored. `lore get SPEC-84`/`spec-084`/zero-padded forms resolve via `resolveDoc`'s ordinal-ref step; export `human_id` reads the column (SPEC-021 A1 allocator retired for numbered types).
- **History anchor**: one-shot `lore migrate ordinals` executed 2026-07-27 (94 kept / 12 changed; triple-080 collision endgame: 80 = bootstrap-injection projection, 81 = PRD-as-outline, 82 = audit-hardening-2). Pre-migration numbers in git history/prose are immutable scars (D10) — content search still finds them.


## Acceptance Criteria (structured)

- [·] [script] AC-DOV-1: Content parity with source PRD section holds: lore migrate prd-to-outline --dry-run for this section exits 0 reporting already_migrated=true with 0 failed invariants (char-coverage, section-ref set equality, R-id set equality)
  script: e2e — lore migrate prd-to-outline --prd prd-lore-internal-first-ai-team-knowledge-platform --section output-contract-document-taxonomy --dry-run
