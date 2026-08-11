---
id: KN-418
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-076
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 7 next steps = 14 items to account for

## Plan

plan-land-falsifiability-reachability-the-attested-red-runner-a

## Task Refs

(none)

## Modified Files

- packages/lore/src/service/task-workflow-service.ts
- packages/lore/src/service/verify-runner-service.ts
- packages/lore/src/service/gate-enforcer.ts
- packages/lore/src/service/export-docs-service.ts
- packages/core/src/ordinal.ts
- scripts/export-spec-mirror.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | 5 of 6 tasks on the new plan are merged+attested+archived at 8e8ff19e. The 6th (mirror-id-unify) is released but its 2 commits are UNMERGED — blocked on a peer session's uncommitted CLAUDE.md edit, which git correctly refuses to overwrite | 95 |
| KD2 | The corpus's FIRST attested red exists: lore verify --falsify mutated a real AC (AC-TC-2) in a scratch worktree, recorded expected-fail capture_source:runner, exit 1 (declared 1), tree byte-identical after. Session opened with attested_fail=0 across three plans | 95 |
| KD3 | The tail guard REFUSES a hand-authored tail on the release binary — fed it the exact string two agents used earlier, exit 4 naming --capture. Sweep 53 files, zero exemptions. capture_source now visible: runner 265 vs self-report 3734 = 93.4% self-report | 95 |
| KD4 | G16: the anti-fabrication guard closed the HONEST path. test:changed runs 550-620s vs a 600s capture window; self-report is admitted only when oracle==manual; --output-tail-file with --oracle test is refused exit 4. An agent thus misfiled a test run as manual | 95 |
| KD5 | G18: the anchor mutex is PLAN-SCOPED (task-workflow-service.ts:3676 takes siblings from getPlanBundle). Cross-plan overlap is ungated and anchor_conflicts is blind the same way. All three batches here were same-plan, so it held by circumstance | 95 |
| KD6 | G19: AC-FR-10's oracle runs a full export (self-healing ids) BEFORE asserting id consistency, so the invariant cannot be driven red — its own RED needed self-healing disabled. D6 was written about the --check COMMAND, never carried to the TEST | 90 |
| KD7 | I twice asserted what I had not read: that .lore/export-index.json is untracked (I checked config.yaml and generalised), and that G19's evidence described main (it described the unmerged branch). Implementer caught one, peer the other | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: merge worktree-agent-a9f801dd0f61837b2 (2 commits, 813 files) once the peer commits CLAUDE.md — different hunks, git will auto-merge. Then full suite on the merged tree, lore verify --ac AC-FR-10 --task task-unify-..., lore done, and the plan's FIRST lore assess
- NS2: NS2: ⛔ tell peer session lore-66 when main is green AND whether the suite left the tree dirty — its T6 (mirror content comparison) is parked on exactly that, because per G19 the suite's own export can destroy the divergence T6 exists to measure
- NS3: NS3: the ordinal seam is OPEN and unowned. OrdinalMigrationService writes an unpadded human_id AND an unpadded suggested_file_path, pinned by the attested AC-084-4 at packages/lore/tests/unit/store/migrate-ordinals.bun.test.ts:205-207. The exporter self-heals silently; nothing detects the window
- NS4: NS4: G17 — AC-FR-1 closed G1's MECHANISM only. 7 of 8 registered checkpoints still return 'no approved governing skill' at 42-47 bytes, exit 0, against the live corpus; the feeding-source docs do not exist. ⛔ G1 is NOT resolved; both knowledge docs now say HALF-CLOSED
- NS5: NS5: do NOT close any of the four plans. plan A 70/100 with 2 MAJORs (backlog-and-arm is now UNBLOCKED — attested-red exists and lore status --enumerate pass_unfalsified_count lists the 29, of which 11 sit in SPEC-038), plan B 88/100, plan C 4 minors, new plan never assessed
- NS6: NS6: G7/G8/G11/G15/G16/G17/G18/G19 have no owning spec. G11 bites soonest: --capture's 600s window vs test:changed's 550-620s, knob in the SHARED main-checkout config. An agent raised it to 1200000 there — ⛔ that does NOT ship; the code default at config.ts:461 is still 600_000
- NS7: NS7: keep the three bundle additions that worked — mandatory --capture, one unfiltered whole-file run per test-file anchor, and do-your-work-in-context. All three tasks in the first batch were refused by lore done before these existed; none after
