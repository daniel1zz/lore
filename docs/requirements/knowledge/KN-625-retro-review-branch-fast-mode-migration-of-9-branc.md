---
id: KN-625
type: knowledge
role: knowledge
title: "Retro: review branch, fast-mode migration of 9 branches, citation gate armed"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
---
# Retro — review branch, fast-mode migration of 9 branches, gate armed (session 6b85319e, 2026-10-09)

Scope: `plan-baseline-review-branch-migration-the-first-branch-eligible` (closed, provisional pass), `plan-baseline-fast-mode-migration-of-the-remaining-9-branches` (closed, PASS on attempt 2), citation gate armed on 12 branches, AC-BLS2-14 measured (89.1%, FAIL). Owner decisions: B (new branch), A (re-probe), A (corpus-only control), A (relative bar), A (provisional + confirm), fast mode A, A (remediate + re-probe), A (subtractive removals), A (arm all 12). Each finding names the mechanism that would refuse it.

## Findings
1. **Citation fidelity was the real weakness, invisible until measured in full.** Sampling said 78.6%; the full pass said 65.3% of 625 cites. Dominant failure: a criterion cited for a rule that only a sibling test in the same file covers, or a "whole suite passes" criterion. The oldest branches were worst (specification 42%, execution 53%) because slice 1/2a never measured fidelity. Mechanism needed: the cite gate should refuse a cite whose criterion command is a whole-file run with no filter naming the rule's behaviour, or at least require a judge pass at cite time (BL-14 automation).
2. **Judges disagree at about the size of the bar's margin.** Three independent samples after cleanup: 91.5%, then 89.1%, each finding 8-11% of pairs earlier judges had kept. A 90% bar on a single LLM-judged sample of ~100 is a coin-flip near the line. Mechanism needed: two judges per pair, disagreement adjudicated, or a confidence interval in the bar.
3. **The absolute probe bar measured the probe protocol, not the baseline.** No branch ever reached 9/10; the corpus-only control showed the baseline leads by +1.0 to +3.5 points and lets the reader commit 2-3x more often. The relative bar was set post hoc (escalated by the plan review, owner accepted as provisional, then confirmed by a pre-registered cross-branch re-probe: 16.5 vs 13).
4. **The only baseline confident-wrong came from the corpus.** BR-704's example copied a false belief present in code comments and rule files; the corpus-only control made the identical mistake. Excavators must run the behaviour on a throwaway corpus, not trust comments.
5. **The census had silent holes, found only by migrating more branches**: standalone-const subcommands and missing node_modules (#94, fixed in code with RED-first), then a false positive on build assets (fixed with an explicit asset allowlist after rejecting an exclusion rule that would have hidden dotted code names), then dependency-injected calls (#104, open).
6. **Gate armed → immediate deadlock (#105):** under enforce, a criterion's sole unfaithful citation cannot be removed even after exempting the criterion. 8 known-unfaithful cites are stuck. The temptation to flip the gate to report and slip the removals through was a gate bypass and was not taken.
7. **Plan reviews caught three real omissions of mine**: the dropped re-probe clause in the fast-mode AC rewrite, the code-change exception missing from the plan invariants, and the post-measurement removals breaking "drawn after the last citation change". Each was fixed by an amendment-log entry, not silently.
8. **#64 was filed in error**: a reject not binding plans is the accepted ADR. Lesson: search for the ADR that scoped a gate before filing a bypass.
9. **Tooling friction**: zsh word-splitting broke three shell loops (two silently did nothing, one created tasks without anchors); claim-scoped worktrees cannot create leaves (#72), so every branch was applied from main by build scripts that the orchestrator read in full before running.

## Numbers
12 branches, 957 live rules (306 established + 15 observed = 321; 599 unconfirmed, 37 undecided), coverage 0 gaps on all 12; 240 unfaithful cites removed (217 + 19 + 4; 8 more stuck, #105), 125 rules downgraded; issues filed this session #65-#105 (excluding #64, closed as filed in error).
