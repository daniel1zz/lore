---
id: SPEC-160
type: spec
role: spec
title: "Baseline slice 3a: architecture tree, baseline-root navigation, requirements to rules, outline retirement, distribution"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-17
tags: []
---
# Baseline slice 3a: architecture tree, baseline-root navigation, requirements to rules, outline retirement, distribution

PRD: spec-product-baseline-architecture-trees-the-product-s-current (BL-5, BL-6 steps 1-5, BL-8, BL-16). ADR: adr-the-product-is-a-baseline-tree-specs-are-implementations (decisions 3, 5, 6, 8). Rules BR-979..BR-987.

## Owner decisions (2026-10-10)
| # | Decision | Chosen | Rejected and why |
|---|---|---|---|
| D1 | Architecture tree storage (ADR decision 3 left "new type vs typed sections" open) | Reuse the `baseline` type with `tree: business \| architecture`; architecture node kinds root / section / module card / standard / debt registry; ids AS-n (standards) and AD-n (debt) from the same registry as BR-n | New `architecture` type: rule allocation, lifecycle, CAS, versions, ac_cites and impact would all be rebuilt (23 non-test files name the literal "baseline") |
| D2 | Can a criterion cite a debt entry? | No — criteria cite BR-n or AS-n; AD-n is named only in a standard's Current Exceptions | Debt is not verifiable behaviour |
| D3 | plan-close `prdOutlineSynced` | Retired; replaced by a rule-state predicate: a rule cited by the plan's spec criteria may not be contradicted, nor stale without an attested pass from the plan's tasks since it went stale | Leaf-edit diff: still a content-diff proxy (SPEC-080 T3's own objection); measured 38 of 53 plan-close denials were this proxy |
| D4 | PRD split scope | Two phases. 3a = steps 1-5 (one first-PRD resolver; baseline root for bootstrap / tree / dashboard home; R-## to leaf rules with coverage from citations; outline to branches). 3b = spec parent contract + 169-spec parent migration | One-shot: largest blast radius (spec-create gate, tree check, markdown sync, 169 specs) |

## Inventory (measured 2026-10-10)
- Single-root consumers: 28 groups; riskiest: requirement coverage via spec.parent_id (corpus-service.ts:4016, requirement-service.ts:225), parent contract (doc-type-rules.ts:15, schemas.ts:657, gate-predicates parentLegal, tree-check), prd-sync domain doc (prd-sync-domain-doc.ts:52-70), bootstrap root / pointers / lore tree (session-service.ts:310, project-pointers-flow.ts:100, corpus-service.ts:3466-3492), markdown sync auto-parent (sync-docs-service.ts:413). "First PRD" has two orderings today (updated_at DESC vs created_at ASC).
- Root PRD: 28 R-## requirements, 12 outline entries; 169 live specs parented to it.
- SPEC-080 machinery: outline verbs (prd-outline-service.ts), extra.outline[], prdOutlineSynced (gate-predicates.ts:1577, checkpoint-registry.ts:1616), outline exempt, --check-prd-budget (kept), dead renderLinkOnlyOutlineForBootstrap (delete), migrate prd-to-outline (retire).
- Distribution: ac-cite already defaults to report when baseline docs exist (ac-write-chokepoint.ts resolveCiteGateFor); missing: setup seeding of the mode, an audited adoption action, a shipped baseline authoring skill and templates (the method lives only in everything-workspace/skills/business-baseline), and `lore setup --project` creates no baseline root.

## Design
- **Architecture tree (BL-5)**: `baselineExtraSchema` gains `tree`; node kinds for architecture; a standard rule variant with Current Reality / Target Rule / Current Exceptions (AD ids) / Migration; registry gains a prefix per id family (migration); `AC_CITE_ID_PATTERN` accepts BR|AS, refuses AD; `indexBaseline` / `collectLeafRules` and census filter `tree=business`. Content: root + five sections (current-state, target-state, standards, adr, debt registry) seeded from the nine module CLAUDE.md files, service invariants as AS-n candidates and open defects as AD-n.
- **Navigation (BL-6 1-3)**: one `CorpusService` resolver for "the strategy document" (single ordering); a baseline-root resolver; bootstrap prints Root (baseline root) and Strategy (PRD); `lore tree` / HTTP / MCP / dashboard home default to the baseline root, PRD via explicit root.
- **Requirements (BL-6 4)**: `extra.requirements[i].migrated_to: BR-n`; coverage of a migrated requirement = the rule has a live script-mode citing criterion; unmigrated as today; report lists both. The 28 R-## are migrated by the orchestrator (corpus work).
- **Outline (BL-6 5, BL-16)**: outline write verbs refused naming `lore baseline add`; list kept read-only; prdOutlineSynced replaced per D3 (config key kept for compatibility, re-pointed); dead outline bootstrap renderer deleted; the 12 outline entries mapped to branches in the corpus.
- **Distribution (BL-8)**: `lore setup --project` writes `workflow.gates.ac-cite.mode: report` only when absent; ships `assets/skills/lore-baseline/` (method from everything-workspace business-baseline, adapted) and node templates; `lore baseline adopt [--mode report|enforce] [--arm <branch>...] [--disarm ...]` writes config + one audit row; `lore status` flags a mode not produced by adopt as unaudited.

## Non-goals (3b or later)
Spec parent contract and the 169-spec parent migration; PRD budget re-scoped to leaves; the 4 domain-overview narratives without a branch (dashboard x2, output contract, extension hooks) move to the architecture tree content in 3b.

## Acceptance criteria
`lore ac list` (AC-BLS3-1..11).


## Acceptance Criteria (structured)

- [⚑] [script] AC-BLS3-1: Architecture nodes (describe 'architecture tree (BL-5)'): a baseline node with tree=architecture and kinds root/section/module-card/standard/debt-registry is accepted, any other kind refused; adding a standard rule returns AS-n and a debt entry AD-n from the same never-reused registry (interleaved adds never collide, also under 8 concurrent adds); census coverage and citation-gate branch indexing ignore architecture nodes
  script: test — bunx vitest run packages/lore/tests/unit/service/baseline-architecture-tree.test.ts && echo 'AC-BLS3-1 PASS: architecture kinds, AS/AD ids from one registry, census and arming ignore architecture'
  other_command=6
- [⚑] [script] AC-BLS3-2: Citing (describe 'cite AS, refuse AD (BL-5)'): lore ac cite with a live AS-n succeeds under enforce on an armed branch; citing AD-n is refused with AC_CITE_REQUIRED-class exit 4 and nothing is written; a criterion citing only AS-n places its spec by that standard's tree without arming errors
  script: test — bunx vitest run packages/lore/tests/unit/service/cite-gate-architecture.test.ts && echo 'AC-BLS3-2 PASS: AS citable, AD refused exit 4'
  other_command=2
- [⊘] [script] AC-BLS3-3: Navigation (describe 'baseline root navigation (BL-6)'): with a baseline root, bootstrap prints Root: <baseline root> and Strategy: <PRD>; lore tree / HTTP /api/tree / MCP lore_tree default to the baseline root and accept the PRD as explicit root; with no baseline root every one of these outputs is byte-identical to before; the 'first PRD' lookup has one ordering used by every caller
  script: test — bunx --bun vitest run packages/lore/tests/integration/cli/baseline-root-navigation.bun.test.ts && echo 'AC-BLS3-3 PASS: bootstrap/tree default to baseline root; no-baseline output unchanged'
  other_command=5
- [⚑] [script] AC-BLS3-4: Requirements (describe 'requirement coverage from citations (BL-6)'): a requirement with migrated_to BR-n is covered iff BR-n has a live script-mode citing criterion; a migrated P0 with no citing criterion makes lore status --check-requirements exit 3; unmigrated requirements are counted exactly as before; the report lists migrated and unmigrated separately
  script: test — bunx vitest run packages/lore/tests/unit/service/requirement-coverage-from-cites.test.ts && echo 'AC-BLS3-4 PASS: migrated coverage from citations, unmigrated unchanged'
  other_command=3
- [⚑] [script] AC-BLS3-5: Plan close (describe 'plan-close rule state (BL-16)'): with prd_sync enabled, a plan whose spec criteria cite a contradicted rule is refused exit 4 naming the rule; a stale cited rule with no attested pass from the plan's tasks since it went stale is refused; all cited rules verified -> closes with no domain-document edit; the old PRD_OUTLINE_NOT_SYNCED reason is never produced
  script: test — bunx vitest run packages/lore/tests/unit/service/plan-close-rule-state.test.ts && echo 'AC-BLS3-5 PASS: plan-close checks cited rule state, never outline sync'
  other_command=3
- [⚑] [script] AC-BLS3-6: Outline retired (describe 'outline writes retired (BL-16)'): lore outline set/rm/exempt exit 4 naming lore baseline add and write nothing; lore outline list still lists the stored entries; the dead bootstrap outline renderer no longer exists
  script: test — bunx --bun vitest run packages/lore/tests/integration/cli/outline-retired.bun.test.ts && echo 'AC-BLS3-6 PASS: outline writes refused, list kept'
  other_command=5
- [⚑] [script] AC-BLS3-7: Setup (describe 'setup seeds baseline adoption (BL-8)'): lore setup --project in a temp git repo with lore init writes workflow.gates.ac-cite.mode report when absent and never changes an existing mode; the baseline authoring skill and node templates are installed and listed in the setup ledger; assets manifest parity holds
  script: test — bunx --bun vitest run packages/lore/tests/integration/cli/setup-baseline-adoption.bun.test.ts && echo 'AC-BLS3-7 PASS: setup seeds report mode only when absent; skill and templates installed'
  other_command=4
- [⚑] [script] AC-BLS3-8: Adopt (describe 'baseline adopt (BL-8)'): lore baseline adopt --mode enforce --arm <branch> writes the config and exactly one audit row with actor, old and new settings; --disarm and --mode report likewise; lore status reports a mode changed by hand-editing the config as unaudited and a mode set by adopt as audited
  script: test — bunx --bun vitest run packages/lore/tests/integration/cli/baseline-adopt.bun.test.ts && echo 'AC-BLS3-8 PASS: adopt writes config + audit row; status flags hand edits'
  other_command=4
- [⚑] [ai] AC-BLS3-9: The architecture tree exists in lore's corpus: a root, the five sections, one module card per module CLAUDE.md (9), at least 10 standards (AS-n) drawn from the service invariants each with the four parts, and a debt registry whose AD-n entries each name an open issue
  ai: Pass only if lore baseline tree shows tree=architecture nodes: 1 root, 5 sections, 9 module cards, >=10 AS rules each wi
- [⚑] [ai] AC-BLS3-10: The root PRD's 28 R-## requirements each carry migrated_to a live baseline rule (or a recorded reason none applies) and its 12 outline entries are each mapped to a baseline branch in a recorded table
  ai: Pass only if lore get on the root PRD shows migrated_to on every requirement (or a reason), each target rule is live, an
- [⚑] [script] AC-BLS3-11: Re-homed from deprecated SPEC-080 AC-080-1 (BL-16: kept behaviour): root PRD raw body <= 24000 chars; lore status --check-prd-budget exits 3 on a seeded over-budget fixture, 0 on a compliant fixture, and completes in < 1000 ms on the compliant fixture
  script: test — bunx --bun vitest run packages/lore/tests/integration/prd-budget-check.bun.test.ts && echo 'AC-BLS3-11 PASS: PRD budget check exits 3 over budget, 0 compliant'
  other_command=1
- [⚑] [script] AC-BLS3-12: RETIRED BEHAVIOUR, re-baselined 2026-10-10 by slice 3b (owner decision D7; BR-424 retired): outline detail links are no longer checked — an outline entry with no rel=detail link, or a link to a missing document, is not a size-check finding (lore status --check-prd-budget exits 0 for it), because the outline is read-only history (BR-694) and size budgets moved to baseline nodes (BR-1010). Original statement: every stored outline entry declares >= 1 rel=detail link resolving to an existing non-deleted document, else exit 3.
  script: test — bunx --bun vitest run packages/lore/tests/integration/prd-budget-check.bun.test.ts -t detail-link && echo 'AC-BLS3-12 PASS: detail links are no longer a finding'
  other_command=1
- [⚑] [script] AC-BLS3-13: Re-homed from deprecated SPEC-080 AC-080-2's surviving half (BL-16): a direct lore set patching extra.outline is refused with VALIDATION_ERROR (exit 4) naming the retirement and lore baseline add; lore outline list returns stored entries unchanged (describe 'outline writes retired' guard cases)
  script: test — bunx vitest run packages/lore/tests/unit/service/outline-writer-guard.test.ts && echo 'AC-BLS3-13 PASS: direct outline edits refused, list read-only'

## Code anchors

- packages/core/src/baseline.ts
- packages/lore/src/service/rule-service.ts
- packages/lore/src/service/ac-write-chokepoint.ts
- packages/lore/src/service/navigation-roots.ts
- packages/lore/src/service/requirement-service.ts
- packages/lore/src/service/gate-predicates.ts
- packages/lore/src/adapters/cli/commands/baseline-adopt.ts
- packages/lore/src/flows/setup-project-flow.ts
- assets/skills/lore-baseline/SKILL.md
- packages/lore/src/adapters/cli/commands/outline.ts
