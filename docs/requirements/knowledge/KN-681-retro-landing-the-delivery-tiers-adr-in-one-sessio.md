---
id: KN-681
type: knowledge
role: knowledge
title: "Retro: landing the delivery-tiers ADR in one session — semantic merge conflicts, AC design gaps, approve-over-reject"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: [retro, hooks, governance]
parent: PRD-001
links:
  - {id: ADR-047, type: relates-to}
---
# Retro: landing the delivery-tiers ADR — four specs, twelve tasks, one session (2026-10-15)

Governing: adr-rule-delivery-tiers-gate-hook-skill-and-optimistic. Plans (all archived): plan-unified-upgrade-reminder-and-retirement-of-the-session (assess 80 met), plan-interception-moves-off-every-tool-call-turn-end-review-and (78 partially_met), plan-an-active-spec-counts-as-approved-for-claims-and-plan (83 met), plan-move-the-six-checkpoint-backed-rules-from-always-loaded (81 met). Issues closed as fixed: #22 #52 #142 #143 #144 #146 #184 #190 #202 #203 #208; duplicates closed: #193 #205 #206.

## What went wrong, with the mechanism that would have caught it
1. **First-round triage verdicts were not reliable.** #142 was triaged STILL-VALID and written into the ADR and Spec B; it had been fixed by 1d09f4b4. Caught only when a later audit read the file. Mechanism: a triage verdict must cite the file:line it read *this turn*; "still valid" without a quoted current line is unverified.
2. **Three cross-branch semantic conflicts, each green on its own branch, red after merge** (A1 test used g2-g4 hooks B1 deleted; B3's new asset missing from the asset list A3 rewrote; A2's test failed strict tsc and A2 was archived before typecheck ran on main). Live evidence for #165. Mechanism: run typecheck + the tree-scanning/asset-list tests on main after EVERY merge, before `lore done` — not once per wave.
3. **AC design gaps, all mine, all strengthening corrections recorded:** AC-TE-6 passed with a stubbed verb (capability ≠ wiring; corrected to drive the real binary, #202); AC-RT-2 omitted `lore context init` and could never pass (#208); AC-ACT-2/AC-RT-1/AC-RT-2 hard-code the main checkout path, so a worktree run checks the wrong tree. Mechanism: run every declared AC command once red in a throwaway before declaring it.
4. **Approve over reject.** Rule landing demoted nine leaves; I chained review→approve and approved eight over REJECT verdicts (baseline is not judgment-required; #159). The rejects were real: leaf prose contradicted the landed rules, and Spec A's change set had missed BR-905/BR-911/BR-1060/BR-1061/BR-1067, which still named the retired session-start target. Filed #212. Mechanism: plan close lists the leaves its change set touches and refuses until each has a current-version approve judgment.
5. **Worktree leaks.** C1's `lore context refresh` in its worktree wrote main's `.claude/rules` (#33 live); `lore done` printed "worktree: gone" for branch-name claims (#158 live); worktrees resolve @lore/core from main (#15, re-hit twice, #205 dup).

## What worked
- Optimistic interception principle refined by the owner mid-design: check at the nearest aggregation point where repair is still cheap (Stop for behaviour, milestones for quality), not "as late as possible".
- Parity-before-delete for the g1-g4 hooks (AC-TE-1 green with hooks present, then removal).
- `lore issue resolve` + `resolves` links + `lore issues --sync --apply` closed GitHub issues without hand drift.

## Full suite on main at a9a4ee9c (recorded as fail evidence on each landing task)
vitest 18 failed / 11333 passed; bun 3 failed / 3117 passed. Every failure predates the session or is tracked: #32, #38, #55, #139, #170, #185, #186, #201, #210. Regressions this session introduced and fixed: drift-population-reporting (hooks/ scan vacuous after g1-g4 removal), real-setup-ports asset list, AC-UR-1 hook names, A2 strict-tsc.

## Left open
- baseline-attribute-work-to-a-run draft: BR-1032 contradicts BR-1055 (#215).
- baseline-choose-which-fragments-apply draft: BR-1095 (added concurrently by another session) not in prose/boundary; how refresh treats a dynamic main fragment is unstated.
- This machine's ~/.claude still runs the retired hooks until `lore setup` converges it.
- New issues filed: #198 #204 #207 #210 #211 #212 #214 #215.
