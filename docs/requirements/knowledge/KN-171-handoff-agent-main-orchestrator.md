---
id: KN-171
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-076
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 8 next steps = 15 items to account for

## Plan

plan-land-falsifiability-reachability-the-attested-red-runner-a

## Task Refs

(none)

## Modified Files

- packages/lore/src/service/verify-runner-service.ts
- packages/lore/src/service/task-workflow-service.ts
- packages/lore/src/service/ac-service.ts
- packages/lore/src/adapters/cli/commands/status.ts
- packages/core/src/acceptance.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Both phase-1 tasks landed, merged, archived at 2d78534c. Merged-tree full suite green: vitest 490 files, bun 1873 pass/0 fail (561s), typecheck 0. dist/lore rebuilt (no agent running). Worktrees/branches cleaned to zero, tree clean | 95 |
| KD2 | The attested-red runner ships: lore verify --falsify <AC-ID> applies a DECLARED falsifier in a scratch worktree, asserts the exact declared exit code, records capture_source:runner. 7 tests incl. a real SIGKILL and a never-runs-cleanup case, both asserting the origin repo is byte-identical | 95 |
| KD3 | The tail guard now REFUSES a hand-authored tail. Verified on the freshly built release binary, not in a test: feeding it the exact semicolon-joined summary two agents used earlier this session returns exit 4 naming --capture. Sweep was 53 files, ZERO exemptions | 95 |
| KD4 | capture_source is visible for the first time: runner 265 vs self-report 3734 = 93.4% of historical evidence rows are self-reported. Nobody could see this before. The guard is write-time-only so history stays inert; treat the ratio as a baseline | 90 |
| KD5 | G13 — G4's exact shape RECURRED inside the code that fixed G4: verify-runner-service.ts:1472 tells users to run 'lore ac add/set --falsifier-*' but ac set rejects it, exit 2. Passed every AC, attested, archived. Prose beside a mechanism is not checked by it | 95 |
| KD6 | pass_unfalsified_count is now enumerable via lore status --enumerate. The 29 members are NOT evenly spread: 11 of 29 sit in SPEC-038 alone. Producing this list previously needed a throwaway script over 138 specs | 95 |
| KD7 | plan A's backlog-and-arm is UNBLOCKED: both prerequisites (attested-red runner, pass_unfalsified member list) landed this session. handoff-85's NS3 claim that phase-2 was blocked by nothing was WRONG and is now moot | 90 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: one ready task, not dispatched: task-make-lore-ac-set-accept-the-falsifier-flags-its-own-error (AC-FR-9). Implement ac set --falsifier-* (do NOT just delete 'set' from the message) plus a scanner asserting every pasteable command in an error message resolves. ⛔ Expect MORE offenders — fix them in the same task or it is a gate armed against an unswept back-catalogue
- NS2: NS2: phases gate-reachability (AC-FR-1, AC-FR-8) and mirror (AC-FR-6, AC-FR-7) have NO tasks yet. AC-FR-1 needs BOTH the derived checkpoint set AND an exact exit 2 for an unregistered name — lore feed <unknown> still exits 0 today
- NS3: NS3: plan A backlog-and-arm can now start. Use lore status --enumerate pass_unfalsified_count for the member list and lore verify --falsify per red. Start with SPEC-038 (11 of 29). AC-OX-11 still needs a corpus FAIL census enumerator — --enumerate has only the 4 count fields, no fail field
- NS4: NS4: do NOT close any of the four plans. plan A 70/100 with 2 MAJORs, plan B 88/100 met, plan C 4 minors incl. AC-TC-2's absence-only oracle. The new plan has never been assessed
- NS5: NS5: unredeemed_allow_missing_path_count is 6, counted per DECLARATION not per file. Every AC of the new spec was declared red-first against unwritten oracle files; creating each file drops the count with no command
- NS6: NS6: G7/G8/G11 still have no owning spec. G11 is sharpest: --capture's window is 600s and test:changed measured 591.9s — a 1.3% margin, and the knob lives in the SHARED main-checkout config, so the evidence tier silently degrades to self-report exactly when the machine is busiest
- NS7: NS7: subagent children are neither controllable nor observable — a fork ignored an explicit do-not-commit instruction, and an earlier sub-agent could not report back to its parent at all. The unconditional git branch -a sweep after every merge round is the only defence
- NS8: NS8: eviction still owed on packages/core/src/CLAUDE.md and packages/lore/src/adapters/cli/CLAUDE.md; service/CLAUDE.md tripped its floor mid-session and was trimmed. Root CLAUDE.md remains within budget and got no standing lesson this session
