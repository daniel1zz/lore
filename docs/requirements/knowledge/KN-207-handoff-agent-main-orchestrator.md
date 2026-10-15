---
id: KN-207
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-03
updated: 2026-10-10
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 10 next steps = 16 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

- CLAUDE.md
- packages/core/src/CLAUDE.md
- packages/core/src/archive-candidates.ts
- packages/core/src/session-actor.ts
- packages/core/src/session.ts
- packages/core/src/task-workflow.ts
- packages/lore/src/adapters/cli/CLAUDE.md
- packages/lore/src/adapters/cli/commands/evidence.ts
- packages/lore/src/adapters/cli/commands/gate.ts
- packages/lore/src/adapters/cli/commands/ready.ts
- packages/lore/src/adapters/cli/evidence-precheck.ts
- packages/lore/src/adapters/cli/utils.ts
- packages/lore/src/adapters/evidence-capture.ts
- packages/lore/src/adapters/mcp/CLAUDE.md
- packages/lore/src/adapters/mcp/tools.ts
- packages/lore/src/app.ts
- packages/lore/src/service/CLAUDE.md
- packages/lore/src/service/checkpoint-registry.ts
- packages/lore/src/service/gate-predicates.ts
- packages/lore/src/service/phase-migration-service.ts
- packages/lore/src/service/phase-workflow-service.ts
- packages/lore/src/service/plan-membership.ts
- packages/lore/src/service/task-workflow-service.ts
- packages/lore/tests/e2e/evidence-cd-chain-precheck-compiled.bun.test.ts
- packages/lore/tests/integration/claim-session-capture-app-wiring.bun.test.ts
- packages/lore/tests/unit/adapters/evidence-precheck.test.ts
- packages/lore/tests/unit/adapters/mcp-evidence-capture.test.ts
- packages/lore/tests/unit/adapters/mcp-tools-uncommitted-worktree-guard.test.ts
- packages/lore/tests/unit/service/adhoc-claim-gate.test.ts
- packages/lore/tests/unit/service/claim-anchor-gate.test.ts
- packages/lore/tests/unit/service/claim-anchor-toctou.test.ts
- packages/lore/tests/unit/service/claim-session-identity.test.ts
- packages/lore/tests/unit/service/isplanmember-single-definition.test.ts
- packages/lore/tests/unit/service/phase-claim-gate.test.ts
- packages/lore/tests/unit/service/phase-migration-plan-membership.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | KD5 conclusion right, reason wrong: capture_source:runner is NOT attestation (lore done needs attestation !== undefined). Override is forced not by a missing attest path (verifyAdhocTask ships) but by ac-scope requiredness keyed on the parent plan spec, which adhoc guarantees absent | 95 |
| KD2 | KD4 has a dimension tests cannot see: two branches each passing lore status --check-claude-md merged to 24864/24576 bytes, exit 3, blocking pre-push. Per-branch budget checks are structurally blind to merge-time byte addition | 95 |
| KD3 | The global lore is a symlink to the MAIN CHECKOUT dist/lore: rebuilding hot-swaps the CLI under live agents, not rebuilding leaves every CLI fix inert even for its author. Only window: rebuild once, after the last agent, before the authoritative full suite | 95 |
| KD4 | The ADR three-question review EXTENDS more than it overrules: three agents independently reported it adding requirements the fix list never stated (declined members must be NAMED; an existence AC must assert a positive count; a reviewer duty must land on the SHIPPING surface) | 90 |
| KD5 | isPlanMember triplication root cause was not the copies but service/CLAUDE.md never defining service, so a store-less predicate module read as one in two JSDocs, one writing that reason into the shared module own header. Fixed at 23bb6bf | 95 |
| KD6 | The adhoc flag bypasses a FOURTH floor: lore done red-first floor is keyed on extra.ac_scope presence, so an ad-hoc task archives with no red row and no red_first, unasked. Appended as instance 4 to the existing ac-scope task v2, not a separate defect | 90 |

## Failing Oracle

(none)

## Next Steps

- NS1: task-phaseworkflowservice-claim-captures-no-session-id-so-every — CRITICAL shipped-channel regression: noAnchorOverlap reads a field only one of its two claim writers sets, so same-actor phase overlaps hit an unsatisfiable fail-safe refusal
- NS2: task-capture-source-is-optional-at-the-evidence-write-boundary — make it required, delete the self-report fallback; the safe-looking default is what made the gap invisible
- NS3: task-an-ad-hoc-task-can-never-reach-the-attestation-path-that v2 — UPSTREAM of both the override problem and the red-first bypass; re-keying ac-scope arms both floors
- NS4: task-a-t-filter-is-a-regex-so-this-repo-s-own-ac-titles — parens and plus in AC titles silently match zero and exit 0 in the pre-recording window; measured twice in one session
- NS5: task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a — edge-triggered: one agent hit it at ~624s, another fit a 326-file selection inside
- NS6: task-the-tenth-plan-member-site-is-a-write-path-create-time — first plan-member site on a WRITE path; needs a retroactive policy in the same slice
- NS7: task-the-mcp-refusal-omits-the-derived-cd-target-the-cli-now — one-line parity append plus the unmarked oracle-manual opt-out
- NS8: ANCHOR MUTEX: the phaseworkflowservice and capture-source tasks both declare phase-workflow-service.ts and task-workflow-service.ts — sequence, never concurrent
- NS9: REVIEWER EYE: NS6 rewrote six assertions that pinned the retired same-by proxy, incl SPEC-056 AC-P-3, each with a refusing counterpart beside it
- NS10: STILL DEFERRED by user scope choice: NS2 AC-statement-drift and KD3 (AC-067-4 precedent) — two faces of one issue, never dispatched
