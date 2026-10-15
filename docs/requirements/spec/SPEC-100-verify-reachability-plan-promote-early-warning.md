---
id: SPEC-100
type: spec
role: spec
title: "Verify reachability — plan-promote early warning, reachability-aware attestation feeding pack, exemption kind taxonomy"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-10-10
tags: []
links:
  - {id: SPEC-094, type: implements}
---
# Verify reachability — early warning at plan-promote, reachability-aware attestation feeding pack, exemption reason taxonomy

## Overview/Goal

The 2026-07-27 full-system audit's remediation plan exposed three seams around the attested-evidence pipeline (retro: `knowledge-full-system-spec-compliance-audit-2026-07-27-85-11-1`, §Plan-close postscript):

1. **Late failure.** A plan whose parent is not a spec (or whose parent spec declares zero script-mode ACs) is legal at create/promote/claim/evidence time, yet `lore verify` — the only attested-evidence writer — is structurally unreachable for it. The incompatibility surfaces only at plan-close (ATTESTATION_FLOOR_NOT_MET), hours after the shape was chosen. Legality at promote time silently does not imply closability.
2. **Wrong recovery guidance.** `feedAttestationFloor` (checkpoint-registry.ts) unconditionally emits `Recovery: run lore verify <plan> ...` — for an unreachable plan that command deterministically fails with `plan has no parent spec — nothing to verify`. The feeding pack recommends an impossible action, violating its own "every deny carries an executable repair" contract.
3. **Exemption taxonomy gap.** `extra.attestation_exempt` + free-text reason cannot distinguish the canonical case (red/TDD: no oracle exists to attest) from the audit case (oracles exist and ran, but the pipeline is unreachable). Audit readers cannot tell "unverified" from "verified but unattestable".

This spec mechanizes all three: an ADVISORY (never a deny) at plan-promote, a reachability branch in the attestation feeding pack, and a typed `attestation_exempt_kind` enum required whenever exemption is claimed.

## Scope

**In scope:**
- **M1 — plan-promote reachability advisory.** A pure helper `verifyReachability(planParentType, parentSpecScriptAcCount)` → `{reachable: boolean, why: "parent-not-spec" | "no-script-acs" | null}` in `gate-predicates.ts`. The `plan-promote` checkpoint surfaces an ADVISORY line when unreachable — naming the plan-close consequence (attestation floor will have no `lore verify` path; the two real options: parent the plan under a spec with script-mode ACs, or plan on a typed exemption). Advisory NEVER affects the gate verdict (mirrors SPEC-081 D1: observability never changes the outcome).
- **M2 — reachability-aware `feedAttestationFloor`.** The feeding pack branches on the same `verifyReachability` derivation: reachable → current text byte-preserved (REGRESSION); unreachable → the `Recovery: run lore verify ...` sentence is REPLACED by a precondition explanation (why verify cannot run for this plan) plus the two real options, keeping the existing exemption mechanics text.
- **M3 — exemption kind taxonomy.** `attestationExemptKindSchema` in `@lore/core` (`schemas.ts`): enum `red-tdd | no-oracle | pipeline-unreachable | other`. The plan-close exemption check (`checkPlanClose`) now requires `extra.attestation_exempt_kind` to be a valid enum member whenever `extra.attestation_exempt === true` (missing/invalid kind → the exemption does NOT satisfy the floor; the feeding pack names the enum and the one-line meaning of each member). Fail-loud, no silent legacy fallback: the only plan ever closed via exemption predates this spec and is already archived (no re-close path exists), so no migration is needed.

**Out of scope:**
- Extending `lore verify` to resolve ACs across `implements`-linked specs for multi-spec plans (the model-level fix; a candidate future spec — this spec only makes the current single-parent model honest about its boundary).
- Any change to `attestationFloor`'s ratio math or the per-task attested requirement (SPEC-069 owns those).
- Dashboard surfaces for the new kind field.

## Design Decisions

- **D1 — advisory, not deny, at plan-promote.** Cross-spec plans are a legitimate minority shape (audit remediation); denying them would force artificial per-spec splits. The debt was silence, not permissiveness.
- **D2 — one derivation site.** M1 and M2 consume the SAME `verifyReachability` helper; the advisory and the feeding pack can never disagree about reachability.
- **D3 — kind is required when exemption is claimed.** A bare `attestation_exempt: true` without a typed kind is exactly the silent-fallback shape this repo bans; the gate refuses it with the enum spelled out in the feeding pack.

## Acceptance Criteria

Structured via `lore ac add` (script-mode, oracle-bound). Sketch: (1) `verifyReachability` unit truth-table + plan-promote advisory presence/absence + verdict-unchanged assertions; (2) `feedAttestationFloor` reachable-branch byte-regression + unreachable-branch content assertions (no `lore verify` recommendation, names both real options); (3) `attestationExemptKindSchema` accept/reject table + `checkPlanClose` exemption-with/without-kind outcomes; (4) `bun run typecheck` exit 0.


## Acceptance Criteria (structured)

- [⚑] [script] AC-VRW-1: verifyReachability truth table (>=4 cases: parent-not-spec / no-script-acs / reachable / boundary zero-AC) plus plan-promote advisory presence when unreachable and absence when reachable, with gate verdict asserted unchanged in both branches; suite exits 0
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-reachability.test.ts
- [⚑] [script] AC-VRW-2: feedAttestationFloor reachable branch byte-identical to pre-change text (regression pin) and unreachable branch contains zero occurrences of the string 'Recovery: run' + names both real options (parent-spec script ACs, typed exemption); suite exits 0
  script: test — bunx vitest run packages/lore/tests/unit/service/feed-attestation-reachability.test.ts
- [⚑] [script] AC-VRW-3: attestationExemptKindSchema accepts all 4 enum members and rejects >=2 invalid values; checkPlanClose denies exemption missing kind and passes exemption with valid kind (4-row outcome table); suite exits 0
  script: test — bunx vitest run packages/lore/tests/unit/service/attestation-exempt-kind.test.ts
- [⚑] [script] AC-VRW-4: bun run typecheck exits 0 across all packages
  script: tsc — bun run typecheck
- [⊘] [script] AC-VRW-5: End-to-end on built dist/lore in a throwaway corpus: approving a plan parented to a PRD prints >=1 reachability advisory line to stderr with exit 0, and approving a plan parented to a spec with >=1 script-mode AC prints zero advisory lines; suite exits 0
  script: e2e — cd packages/lore && bun test tests/unit/adapters/cli-plan-promote-advisory.bun.test.ts

## Code anchors

- packages/lore/src/service/gate-predicates.ts#verifyReachability
- packages/core/src/schemas.ts#attestationExemptKindSchema
- packages/lore/tests/unit/service/verify-reachability.test.ts
- packages/lore/src/service/checkpoint-registry.ts
