---
id: KN-490
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-21
updated: 2026-10-10
tags: []
parent: PLAN-079
---
# Handoff — agent:main-orchestrator

SCOPE: 8 decisions + 9 next steps = 17 items to account for

## Plan

plan-land-oracle-executability-the-discovery-refusal-primitive

## Task Refs

(none)

## Modified Files

- packages/core/src/attestation-completeness.ts
- packages/core/src/oracle-file-existence.ts
- packages/lore/src/service/issue-resolution.ts
- packages/lore/src/adapters/cli/commands/issue.ts
- packages/lore/src/adapters/cli/commands/status.ts
- packages/lore/src/flows/drift-flow.ts
- scripts/check-anchor-coverage.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | All four items of ticket 109 (NS2/NS3/NS4/NS5) landed and merged; NS1 decomposed. 5 worktree agents, 7 merges, 15 new ACs, 4 tasks archived, 1 plan closed through the live plan-close gate | 97 |
| KD2 | EVERY lore verify --falsify run this session was vacuous: 11 rows, 10 ACs, 3 specs, 100% false match. Causes: no usable node_modules; untracked files absent (git stash create lacks --include-untracked); dist/lore gitignored. All exit 1 | 99 |
| KD3 | No exit code can fix --falsify: vitest and bun test both exit 1 for startup AND assertion failures, so the signal is only in the output, which the runner never reads | 99 |
| KD4 | I reported those falsify rows as machine-proven. WRONG. lore assess caught it by reading the evidence tails — third instance this session of advisory catching what deterministic certified | 98 |
| KD5 | Real discriminating power for every AC this session comes from implementer in-worktree reds, which are SELF-REPORTED with genuine assertion tails. The evidence hierarchy is inverted here | 96 |
| KD6 | AC-061-18's own fix reintroduced gap 8 in the same commit: four runner arms anchored at ^, the fifth substring-matched dist/lore anywhere, so any success echo naming the binary re-became a runner segment. Probe-confirmed, fixed, re-verified | 98 |
| KD7 | Three factual errors of mine: AC-BFI-14's copy enumeration was wrong; 'archiving makes falsifiers permanently unprovable' was overstated; 'build packages/core first' is FALSE here — no TS sub-package has a build step | 99 |
| KD8 | Defect-channel quota freed legitimately for the first time: the no-adopt-verb report is the defect M7 fixed, so a resolves edge from its archived task computes fixed. Open 10 to 9, then the falsify defect was filed | 97 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS-A: plan-land-oracle-executability has 6 ready tasks, the largest open front. Sharpest is task-wire-the-discovery-refusal-guard-into-the-evidence-capture (AC-OX-12): findDiscoveryRefusal has exactly ONE production consumer, verify-runner-service.ts, so lore evidence --capture can record a discovery refusal as expected-fail under capture_source:runner. I demonstrated it accidentally with a poisoned cwd
- NS2: NS-B: task-clear-the-29-criterion-pass-unfalsified-backlog-across is BLOCKED, do not execute as written. Handoff 110 measured pass_unfalsified_count blind to 692 of 769 script-mode ACs, and a falsifier runnable only while its plan is live. As written it mints 29 dead declarations. Blocker is in the task body
- NS3: NS-C: filed defect 01M0H8XP5JZTR8Q7BH6HV6YRM4 needs the green-control fix — run the UNMUTATED command in the same scratch worktree first, record inconclusive when it fails. One step, catches all three causes, no new syntax. Belongs under spec-falsifiability-reachability
- NS4: NS-D: task-settle-the-ac-dc-9-ac-dc-14-b-conflict-then-collapse-quota. AC-DC-9's oracle pins which consumer spells which call in a named file instead of the invariant, so any faithful refactor reddens it. No ac-scope on purpose: settling that is step one. Do NOT re-open the isDanglingAdoption MAJOR — verified false positive, the third conjunct is subsumed by keying on the COMPUTED resolution and RED SEED (c) tests it
- NS5: NS-E: task-obtain-a-machine-proven-red-for-ac-bfi-14-and-ac-bfi-15 tracks the falsify gap for those two. Its premise was corrected in place: archiving ends the CURRENT window only; a future plan carrying those ac-scopes can run them
- NS6: NS-F: root CLAUDE.md is at its 0.97 eviction floor, 23753/24576 bytes, 86 bytes before any addition breaches. The next standing lesson MUST be paired with an eviction; the gate forbids another module's doc, trading lines for bytes, and raising the ceiling
- NS7: NS-G: worktree-agent-adcbb451afe84dda0 is clean, merged, 0 ahead, but the safety gate needs 30 min of reflog quiet and it was ~6 min at session end. Remove it and its branch. The other four were removed
- NS8: NS-H: assess and plan-close can deadlock on a large plan — assess hit the 180s provider timeout on a 233k-char diff (budget 80k) while plan-close hard-requires a fresh assessment. A retry worked. Also every evidence write staleness the assessment, so record ALL evidence BEFORE the final assess
- NS9: NS-I: gaps 5, 7, 8 of knowledge-four-governance-gaps-measured-while-resuming-handoff are FIXED by the tokenizer work, no filing needed. Gap 6 (ac set refuses --mode on equality) is open. New minor: a --description value starting with -- is parsed as a flag by citty
