---
id: PLAN-116
type: plan
role: plan
title: "Implementation — project CLAUDE.md content contract (interface-first)"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: SPEC-095
phases:
  - {name: "Phase 1: Contracts & Content", description: "Config schema (numbers SSOT) + prose contract asset. Both roots, parallel."}
  - {name: "Phase 2: Parallel Implementation", description: "Four workstreams behind the Phase 1 contracts: lint service+probe, status check branch, governance topic registry, template+skill rewrite. TDD-paired."}
  - {name: "Phase 3: Convergence & Verification", description: "Pre-push pair step + assets-manifest regen after all asset edits; full-suite verification, lore verify, code anchors, domain-doc sync."}
links:
  - {id: SPEC-095, type: implements}
---
## Overview

Implementation plan for spec-project-claude-md-content-contract-governance-injected: one contract SSOT (prose asset + zod budgets) consumed by three distribution surfaces (template, lore-init-context, pre-push oracle). Strategy: Interface-First (user-selected 2026-07-27) — contracts land first, four parallel implementation workstreams, convergence phase regenerates the assets manifest and runs full verification.

## Task Legend

| Short | Slug | Estimate |
|---|---|---|
| CFG-RED | task-skill-test-config-context-schema-red-scenarios | S |
| CFG | task-skill-implement-contextconfigschema | S |
| PROSE | task-skill-design-author-claude-md-contract-md-prose-asset-no | S |
| LINT-RED | task-skill-test-lint-boundary-suite-red-ac-cmc-1-path | S |
| LINT | task-skill-implement-lintmemoryfiles-pure-service-fs-discovery | M |
| GOV-RED | task-skill-test-governance-topic-dispatch-red-incl-compiled-e2e | S |
| GOV | task-skill-implement-governance-verb-topic-registry-corpus | M |
| STAT-RED | task-skill-test-status-check-claude-md-corpus-less-oracle-red | S |
| STAT | task-skill-implement-lore-status-check-claude-md-config-only | M |
| SKILL-RED | task-skill-test-init-context-template-ssot-consumption-pins-red | S |
| SKILL | task-skill-implement-template-pointer-lore-init-context-skill | M |
| HOOK-RED | task-skill-test-pre-push-hook-trip-parity-extension-red-ac-cmc | S |
| HOOK | task-skill-implement-pre-push-pair-check-step-assets-manifest | M |
| CLOSE | task-skill-verify-full-suite-close-out-attested-verify-code | M |

## Governance Mode

unattended — phase gates auto-proceed; Invariant violations hard-block regardless.

## Invariants

1. Budget numbers exist in exactly ONE source location (`packages/core/src/config.ts` zod defaults) — a repo-wide grep for `30720`/`16384` outside config.ts + tests returns nothing.
2. The `lore status --check-claude-md` execution path never calls `loadLoreApp` nor opens any DB — pinned by test, works in a corpus-less directory.
3. `hooks/pre-push` and `assets/project/pre-push` stay byte-identical at every commit (pre-push-parity test green).
4. `node scripts/embed-assets-manifest.mjs --check` exits 0 after every asset-touching task merges.
5. Worktree oracles run scoped only (AC file filters + typecheck); the full suite runs once on main post-merge.
6. No test or smoke check writes to the repo's own `.lore/` corpus (throwaway corpus via mkdtemp only).

## Risk Register

| ID | Risk | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | governance.ts churn vs concurrent sessions | L (was M; SPEC-085 merged 93416ea) | rebase conflict at dispatch | pull-rebase before dispatch (standing protocol); GOV holds the exclusive file anchor on commands/governance.ts | re-dispatch with fresh worktree |
| R2 | `.strict()` config: older binary rejects newer config.yaml carrying `context.*` | M | teammate on stale binary reports config parse failure | CFG carries an AC bullet requiring the CHANGELOG/receipt version-floor note (accepted risk per spec) | teammate upgrades binary; key is additive-optional for new configs |
| R3 | AC commands name not-yet-existing test files (false-oracle class) | M | lore verify inconclusive/zero-match | every RED task's file anchor is byte-identical to its AC-CMC-* script path; CLOSE runs `lore verify` whose judgeCompleteness catches under/zero-match | fix paths at CLOSE, re-verify |
| R4 | SKILL.md taxonomy deletion degrades lore-less repos | M | skill invoked where `lore` absent | fallback specified in spec Scope (generic structure + recommend `lore setup`); SKILL AC bullet 2 pins it | restore minimal pointer text, never the taxonomy copy |
| R5 | consumer-repo pre-push false-fails | L | consumer reports blocked push | HOOK-RED pins fail-open + opt-out + --no-verify author→trip cases | `context.memory_files.enabled: false` |

No H-impact risks. R2/R3/R4 mitigations are embedded in task ACs (CFG bullet 5; RED-anchor≡AC-path discipline + CLOSE verify; SKILL bullet 2).

## Estimation Summary

Weighting S=1, M=2 session-units. Phase 1 (CFG-RED+CFG+PROSE): 3 | Phase 2 (LINT-RED/LINT, GOV-RED/GOV, STAT-RED/STAT, SKILL-RED/SKILL): 12 | Phase 3 (HOOK-RED+HOOK+CLOSE): 5. Total 20 nominal (parallelizable); wall-clock bound by critical path below.

## Critical Path

CFG-RED(1) → CFG(1) → LINT-RED(1) → LINT(2) → STAT(2) → HOOK-RED(1) → HOOK(2) → CLOSE(2) = 12 session-units. Slack: PROSE, GOV-RED/GOV, SKILL-RED/SKILL, STAT-RED.

## Exit Criteria

- All 5 spec ACs (AC-CMC-1..5) carry attested pass evidence (`lore verify` on this plan).
- Full suite green on main post-merge (both runners + typecheck).
- Spec code anchors declared post-landing (`lore anchor add`); `lore status --check-drift` exit 0.
- Distribution domain doc updated within plan claim window (SPEC-080 plan-close sync predicate).
- `lore assess` run; findings triaged.

## Decisions Log

- 2026-07-27 Strategy: Interface-First selected over Consumer-Slice (user choice; max parallelism, disjoint file anchors verified).
- 2026-07-27 governance_mode: unattended (user choice).
- 2026-07-27 R1 downgraded M→L: SPEC-085 merged before planning.
- 2026-07-27 Reviewer audit round 1 (NEEDS_WORK) fixes applied: CFG pair path-pinned (config-context.test.ts), R2 mitigation moved into CFG AC, lazy edge LINT→STAT-RED dropped in favor of real code edge LINT→STAT, GOV regression files named, roll-up arithmetic corrected with slug legend.
