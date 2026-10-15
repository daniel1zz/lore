---
id: PLAN-164
type: plan
role: plan
title: "Baseline slice 3b"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: SPEC-163
phases:
  - {name: "build", description: "Code: contract, consumers, view, migration, budgets, distribution"}
  - {name: "corpus", description: "Live corpus: overviews, mapping, migration, final census"}
---
# Plan: baseline slice 3b

## Invariants
- Red-first: every task records an expected-fail run of its AC's test on pre-fix code before implementing.
- Never write the repo's .lore/ from tests (InMemoryStore or mkdtemp + lore init). Live-corpus writes are never made by a test. They are made by the orchestrator from the main checkout, with ONE named exception: the domain-overview task's implementer writes architecture-tree content and deprecates the 4 overviews (corpus authoring is its deliverable).
- No silent fallback: a spec with no parent is a first-class state, never defaulted to the PRD anywhere.
- corpus-service.ts edits are serialized: audit-surface fix -> link-atomicity fix -> contract task -> consumers task.
- Criteria AC-BLS3B-1..12 are declared on the spec with cites; each task owns exactly its ac_scope and never edits criteria.

## Governance
governance_mode: unattended

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| ~18 test files pin PARENT_REQUIRED / parentLegal for specs | M | contract task updates them in the same commit, each change named in its report as a re-baseline (old assertion, why it is a contract change) |
| Approval gate blocks approving existing uncited specs mid-mapping | M | mapping is applied with lore ac cite (no demotion) before any re-approval |
| Migration on live corpus | H | dry-run first; one audit entry per spec with the old parent; --revert tested |

## Notes
- Live-corpus steps owned by the orchestrator: apply the uncited-spec mapping (AC-BLS3B-12 ledger), run `lore migrate spec-parents --apply`, then AC-BLS3B-10/11/12 checks.

## Owners of the corpus phase
- Domain-overview task (AC-BLS3B-10): one implementer agent writes the architecture-tree content (module cards / standards via `lore baseline add --tree architecture` and `lore rule add`), adds a `supersedes` link from each destination node to its overview, deprecates the 4 overviews, and writes `scripts/check-domain-overviews-retired.ts` (read-only checker) in its worktree; the orchestrator merges the script and runs the check from main.
- Mapping (AC-BLS3B-12): 8 mapper agents already ran (2 per batch of 21, independent, outputs `mapping/out-<batch>-<A|B>.jsonl` in the session scratchpad); one adjudicator agent rules every disagreement with a reason; the orchestrator writes the ledger knowledge doc `knowledge-uncited-spec-mapping-ledger-slice-3b` from those files, applies each final decision (`lore ac cite` / `lore rule add` then cite / deprecate with destination), and the final-task implementer writes `scripts/check-spec-citation-census.ts` and `scripts/check-uncited-spec-ledger.ts` (read-only checkers).
- Migration apply (AC-BLS3B-11): the orchestrator runs `lore migrate spec-parents` (preview) then `--apply` from main after all build tasks are merged and rebuilt, then runs both checkers.

## Owner authorization for the live-corpus steps
- 2026-10-10 night the owner answered every open decision before going offline and asked for the migration to be finished unattended ("我睡觉了，等我醒了验收"; D5-D8 in the spec): spec parents removed, the 84 uncited specs judged one by one with deprecation as an allowed outcome, disagreements ruled by a third agent. That is the explicit authorization for unattended execution of these steps.
- Reversibility: the parent migration is reversible (`--revert` from its audit entries, tested by AC-BLS3B-7). Deprecation is terminal, so it is applied only to specs where both mappers agree or the adjudicator rules deprecate with a named destination, and the ledger lists every one for the owner's morning review.
- Every deprecation, agreed or adjudicated, records its destination (leaf/standard slug, superseding spec, or 'behaviour removed: <evidence>') in the ledger AND as the deprecation reason on the spec; a row with no destination is not applied.

## Tasks and owned criteria
| Task | Phase | ac_scope | Blocked by |
|---|---|---|---|
| task-3b-contract-specs-take-no-parent-and-need-a-citation-to-be | build | AC-BLS3B-1, AC-BLS3B-2 | task-fix-123-link-parent-is-atomic (plan-baseline-close-out-fixes; itself after task-fix-128-audit-entries-record-the-write-surface) |
| task-3b-consumers-tree-check-navigation-outline-stats-import | build | AC-BLS3B-5, AC-BLS3B-6 | contract |
| task-3b-view-implements-and-implemented-by-computed-from | build | AC-BLS3B-4 | - |
| task-3b-migration-lore-migrate-spec-parents-preview-apply-revert | build | AC-BLS3B-7 | - |
| task-3b-status-per-kind-node-budgets-and-spec-citation-census | build | AC-BLS3B-3, AC-BLS3B-8 | - |
| task-3b-distribution-skills-and-dashboard-carry-the-no-parent | build | AC-BLS3B-9 | - |
| task-3b-corpus-domain-overviews-into-the-architecture-tree | corpus | AC-BLS3B-10 | - |
| task-3b-corpus-uncited-spec-mapping-ledger-migration-apply-and | corpus | AC-BLS3B-11, AC-BLS3B-12 | all six build tasks |

## Order of live-corpus steps
1. Domain-overview task (any time; independent of the build).
2. All build tasks merged, `bun run build` on main.
3. Adjudicator rules disagreements; orchestrator writes the ledger and applies decisions: cites (`lore ac cite`), added rules then cites, deprecations with destination.
4. `lore migrate spec-parents` preview, then `--apply`.
5. Checkers for AC-BLS3B-10, -11, -12 run from main.

## A deprecation verdict without a destination
It goes back to the adjudicator, who must either name a destination or rule cite / needs-rule instead. Nothing is applied while a row lacks a decision that can be executed, so AC-BLS3B-11 and -12 cannot pass with an open row.
