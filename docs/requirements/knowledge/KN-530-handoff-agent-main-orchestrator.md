---
id: KN-530
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-140
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 6 next steps = 12 items to account for

## Plan

plan-make-lore-issues-refuse-a-retired-shape-upstream-as-loudly

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | User redirected mid-session from ticket 121's threshold work to the report-issue/issues defect. Planning chain closed: SPEC-147 approved v13 (5 ACs), PLAN-140 approved v4, two tasks with non-intersecting anchors. | 97 |
| KD2 | Defect is ONE cell of a 5-cell shape/verb matrix: retired-shape upstream + 'lore issues' + no --local exits 0 and reads LOCAL while a DIFFERENT upstream was configured. Both neighbours (same verb/GitHub shape, write verb/same shape) refuse with exit 4. | 98 |
| KD3 | The AI judge escalated twice and was right twice: AC-IS-4 was a proxy oracle satisfiable by importing a shared constant while still re-deriving policy locally; my plan baseline wrote AC-IS-4(a) as a source grep, which would force copying the literal into issues.ts. Both fixed. | 95 |
| KD4 | Every AC's oracle was run against HEAD pre-dispatch. AC-IS-1/4/5 behaviourally RED; AC-IS-2/3 behaviourally GREEN by design (green control + regression guard). The plan states both kinds separately - conflating them misreports a working control as a defect probe. | 96 |
| KD5 | Ticket 121 KD3 is PARTLY FALSE, corrected in knowledge-two-attributions-in-the-corpus-growth-threshold: --check is IN-PROCESS and never shells out to lore list, and runs THREE times per test not twice (3x11.48s vs 30s). NS1's premise that field projection shrinks the drift-checks is false. | 96 |
| KD6 | Retracted one of my own findings: I reported data.source as having zero discriminating power, then machine-checked and was WRONG - the field is source_reason and correctly returns no-upstream-configured vs forced-local. No AC added, no gap filed. | 99 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS-A: tester agent was STILL RUNNING at handoff time on task-skill-test-issues-upstream-shape-refusal-four-cli-surface (worktree agent-a3f9b69297e2c4213). Expect AC-IS-1/AC-IS-4 describes RED, AC-IS-2/AC-IS-3 GREEN. It records its own expected-fail evidence and stops at release. Verify branches with 'git branch -a' + 'git log --oneline main..<branch>' - never rely only on the branch name a subagent reports.
- NS2: NS-B: after merging the tester branch (merge message MUST carry the task slug), dispatch task-skill-implement-classifyfeedbackupstream-as-the-single. Anchors already cover BOTH the capability (report-issue-wiring.ts) and both production call sites. The classifier name is fixed by spec D1: classifyFeedbackUpstream.
- NS3: NS-C: after the implementer merges, run 'lore verify plan-make-lore-issues-refuse-a-retired-shape-upstream-as-loudly' for all five ACs, then 'lore done' on both tasks (the implementer cannot assert 'landed in main' from its worktree), then 'lore assess', then 'bun run build' - pre-push provenance blocks on a dist/lore older than HEAD.
- NS4: NS-D: the five ACs carry NO --falsifier-* declarations yet, deliberately - no implementation existed when they were written. Add them after the fix lands so 'the smallest mutation that turns this oracle red' is machine-checkable. Record it as a strengthening, not a quiet edit.
- NS5: NS-E: ticket 121 NS1/NS2/NS3 DEFERRED with decisions already made: ENOBUFS -> 'lore list --fields' projection; the two 30s timeouts -> '--type' scoping on export-spec-mirror --check (first confirm the other five types' idempotency is covered elsewhere, else it is a WEAKENING needing explicit re-baseline); runLore must surface result.error instead of 'result.status ?? 1'. The spawnSync audit surface is 200+ files with 'status ?? N' in production code too - needs a check script, not a manual sweep.
- NS6: NS-F: mirror content-parity design DECIDED but UNIMPLEMENTED: resolved-vs-resolved PLUS normalising the expansion so it carries no volatile state (child live status). resolved-vs-resolved alone does NOT remove concurrency drift - mirror holds last-export's resolution, check resolves now, any write between them changes a child status. Green on HEAD today, so not an active failure.
