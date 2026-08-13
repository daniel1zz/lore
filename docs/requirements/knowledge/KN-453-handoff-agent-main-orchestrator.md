---
id: KN-453
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: PLAN-129
---
# Handoff — agent:main-orchestrator

SCOPE: 13 decisions + 6 next steps = 19 items to account for

## Plan

plan-land-multi-session-concurrency-p1-queryable-ownership-of

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | KD1 ⛔ feed renders ONLY these lines; body invisible. Raw: this plan ready 0 / archived 9. Full suite GREEN at 96fb2807, clean tree: build 0, vitest 509/509 files 8983 pass, bun 2141 pass 0 fail, mirror check OK, run left tree unchanged. | 98 |
| KD2 | KD2 NS1 landed: unbind wired into _releaseImpl via injected port, fires only on writeResult.ok, uses the RELEASED claim's own worktree+session_id. AC-OWN-4 attested exit 0, task archived, plan NOT closed. | 97 |
| KD3 | KD3 AC-OWN-4 tightened pre-dispatch (gen 2->3) to assert release side + live call sites. Spec re-approved twice (v22, v24 after implementer declared the falsifier, measured exit 1). Re-baseline record lives IN the task doc. | 96 |
| KD4 | KD4 ⛔ MIRROR ROOT CAUSE: drift detection is BODY-ONLY (export-docs-service.ts:499 'blind to frontmatter by design'). mirror:export, export-docs --force and check:spec-mirror ALL print clean while an archived task's mirror reads draft. --force only rewrites what the body check flagged. | 97 |
| KD5 | KD5 ⛔ So 're-export and commit before the run' is UNREACHABLE, not just unreliable: no invocable command writes a status change, only the SUITE does. Reproduced — both exporters refused the SPEC-142 status line, then test:bun rewrote exactly it and tripped assertRepoCorpusClean. | 96 |
| KD6 | KD6 ⛔ SETTLE FIRST: AC-OX-1 (spec-oracle-exclusivity) asserts NO test invokes the exporter in WRITE mode under scripts/tests or packages/lore/tests. That write happened anyway. An AC green while its forbidden behaviour is observable is the worse defect — resolve before touching the exporter. | 95 |
| KD7 | KD7 ⛔ THIRD false-oracle variant measured: a test that REQUIRES THE DEFECT TO PERSIST. It borrowed a real stale mirror as fixture, so repairing the mirror reddened it — it lobbies against its own fix. Fixed by constructing both ends + a mutation proving the control reddens (exit 1). | 97 |
| KD8 | KD8 ⛔ assess scored 2 of 3 MAJORs against files in its OWN truncation manifest (445736 vs 80000 budget). Both FALSE: trailer 'no-ops' though every commit carries it (real-git-port.ts:650-664 skips only outside EVERY worktree); call site 'only inferrable' though territory.ts:117-123 passes it. | 97 |
| KD9 | KD9 The one TRUE assess major: AC-OWN-5 liveness rests on a tmpdir heartbeat recording process.ppid (session.ts:149), written ONLY by lore session list\|show. A peer that never ran it is always unmeasured. This is the old NS5, P2 work, not a regression. | 95 |
| KD10 | KD10 ⛔ The defect channel has NO ADOPT VERB: report-issue creates plan_id null; issue offers only resolve (terminal), set has no --plan-id, plan only exempts. Accepted and ignored defects are indistinguishable. Structural cause of the 4 unowned reports. Filed 01KZWMWFN9VXRDNJMKFAW0Y7GF. | 96 |
| KD11 | KD11 ⛔ Do NOT paste the archival command lore done printed again this session. Confirm the plan-close gate actually evaluates on that path; a vacuous PASS is the real risk. | 95 |
| KD12 | KD12 ⛔ Never edit source while a background build-then-test job runs: test:changed builds dist/lore once, then ~130 tests assert binary freshness by mtime. A mutate-revert cycle mid-run manufactured ~130 false reds across two discarded runs. | 96 |
| KD13 | KD13 lore evidence --result pass with a hand-authored tail is REFUSED (exit 4); this session's own dispatch bundle was stale against that. lore verify --task --ac --yes is correct and stronger. The implementer reported the mismatch rather than routing around it. | 94 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1 ⛔ Resolve KD6's AC-OX-1 contradiction BEFORE any exporter fix. Owner task exists: task-the-two-mirror-exporters-disagree-because-drift-detection (plan-land-oracle-exclusivity, phase readonly-oracle, ac_scope AC-OX-1).
- NS2: NS2 ⛔ task-the-cwd-blind-spot-is-one-defect-at-two-call-sites is created but UNCLAIMABLE — plan-land-oracle-executability-the-discovery-refusal-primitive is still draft. Promote it first; the gate is a real precondition.
- NS3: NS3 Mechanize KD8: a finding whose path is in the run's own truncation manifest MUST be emitted unverifiable, never scored as a gap. Until then machine-check every path-naming assess finding — 3 of 6 across two sessions were backwards.
- NS4: NS4 ⛔ Do NOT close this plan: assess is partially_met 78/100 and its one true major is P2 work. Two ACs ship narrower than they read (OWN-4 hooksPath outside every worktree; OWN-5 peer liveness) — decide: narrow the statements or widen the oracles.
- NS5: NS5 P2 prep: capture the ORCHESTRATOR's own pid + start time on TaskClaim, never process.ppid. Declare L1/L2 structured ACs only once P2's layout is MEASURED, never predicted.
- NS6: NS6 One worktree left: .claude/worktrees/agent-a594705e15c844021. Merged and clean; the git-safety gate refused removal only for the 30-min reflog liveness window. Safe now: git worktree remove <path> && git branch -d worktree-agent-a594705e15c844021.
