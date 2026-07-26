---
id: KN-067
type: knowledge
role: knowledge
title: "Retro — SPEC-075 full-chain autopilot: ac_scope discipline, first-use gaps ×2, SPEC-061 zero-match miss, grounded review"
status: draft
priority: medium
created: 2026-07-24
updated: 2026-07-25
tags: [retro, spec-075, autopilot, verify]
parent: PLAN-042
links:
  - {id: PLAN-042, type: informs}
  - {id: KN-082, type: relates-to}
---
# Retro — SPEC-075 full-chain autopilot session (ideation → PRD → spec → 3-task plan, 2026-07-24)

Session shape: single session drove the complete governed chain — 6-role ideation → PRD v0.13 §21 (5-stakeholder review) → SPEC-075 (module design, 4-perspective review) → 3 serialized worktree implementers → 12/12 AC attested → plan archived. Learnings below carry a surprise or a rejected alternative; routine mechanics are not repeated here.

## L1 — Undeclared `ac_scope` makes per-task `lore verify` runs pollute the aggregate evidence

`lore verify <plan> --task <t>` executes ALL 12 declared plan ACs at every mid-chain checkpoint. In a serialized 3-task plan this guarantees expected failures at T1/T2 stages (T3's artifacts don't exist yet) and those attested fails accumulate on the record — the closure assessment then flagged "3 attested fails vs 1 pass" as an evidence-integrity finding even though the causality (mid-chain, pre-dependency) was benign. Root cause: the orchestrator never declared per-task `ac_scope` (SPEC-070 supports it), so verify had no way to scope. Mechanization already exists — the failure was authoring discipline. **Rule: in multi-task plans, declare `ac_scope` per task at task-creation time; run `--ac`-scoped verifies mid-chain; reserve the aggregate closure AC for one post-merge run.** (The assess judge independently recommended exactly this — adopted.)

## L2 — "First real use exercises the untested gap" struck twice in one session

(a) The FIRST adhoc-task claim ever attempted in this corpus revealed adhoc tasks are structurally unclaimable (claim gate vacuous-passes only on `parent_id === null`; SPEC-069 adhoc tasks parent to the root PRD → `getPlanBundle` hard-fails). The channel had creation tests but no end-to-end claim test. (b) The dashboard NewDocModal cannot author a gate-conformant spec at all (no content field vs `hasSkeleton`) — latent since gate enforcement was wired into the service layer, surfaced only when an e2e fixture drove the modal. Both are instances of the standing "consumer/end-to-end audits" lesson (CLAUDE.md): every channel needs an author→consume oracle, not just a create oracle. Both now have tracked fix tasks (`task-fix-spec-069-gap-adhoc-task-claim-structurally-impossible`, `task-decide-implement-newdocmodal-gated-type-authoring-spec`).

## L3 — SPEC-061's matched-case counting has a live miss (false-oracle vector, mechanized guard didn't fire)

T1-stage verify ran dashboard `bunx vitest run -t "AC-075-N"` commands before any matching test existed: 37 files executed, ZERO cases matched the filter, exit 0 — and the attestation recorded `completeness: complete`. AC-061-10's `-t` matched-case counting should have judged this `inconclusive`. A "pass" whose test doesn't exist yet is the exact fabrication class SPEC-061 was built to catch; the guard exists but does not recognize this output shape. Tracked: `task-fix-spec-061-miss-vitest-t-zero-matched-case-run-recorded` (high). Until fixed, treat mid-chain per-AC passes for not-yet-implemented surfaces as suspect regardless of the completeness label.

## L4 — Stakeholder review with codebase grounding catches what reasoning-only review cannot

The PRD-delta review round produced two verified factual corrections ONLY because one reviewer was instructed to ground claims in the repo: `/api/ready` already existed (SPEC-037) — the draft (and the module CLAUDE.md it trusted) said it didn't; judgment records carry qualitative `reasons[]`, not numeric scores — the draft promised score rendering. Both would have shipped as wrong spec text and misallocated implementation work. **Rule: at least one reviewer per document round gets explicit file-anchor grounding instructions; module CLAUDE.md claims about OTHER modules' surfaces are drift-prone and must be verified against code, not quoted.** (The stale CLAUDE.md claim itself was fixed in T3.)

## L5 — Fix-loop boundary judgment: a tracked foreign task blocking a closure oracle is fixable in-loop

AC-075-12 (full suite) failed on a pre-existing, corpus-tracked e2e regression outside the plan. Options weighed: M5-escalate (out-of-scope change) vs execute the already-triaged adhoc task in the fix loop. Chose the latter: the work was already sanctioned by its own corpus task with explicit ACs and a fix direction, making it repair of the shared oracle baseline rather than new scope. The distinction that mattered: *pre-triaged with ACs* (execute) vs *undiagnosed foreign breakage* (escalate). Fixture repair confirmed gate-correct/fixture-stale; 38/38 green with 2× determinism confirmation.

## Cross-references

- Plan: `plan-spec-075-dashboard-adjudication-workbench-route-telemetry` (archived); assessment: `knowledge-assessment-plan-spec-075-dashboard-adjudication`.
- Positioning decision + overruled consensus: `knowledge-ideation-dashboard-capability-expansion-6-role` §11.
- Seed/gate debt history + resolution: `knowledge-pre-existing-e2e-seed-gate-debt-dashboard-spec-create` v3.
