---
id: ADR-006
type: adr
role: decision
title: "Verification skill family — routed convergence + shared failure-first discipline"
status: approved
priority: medium
created: 2026-07-17
updated: 2026-07-18
tags: []
parent: PRD-001
---
# ADR — Verification skill family: converge as a routed family with one shared failure-first discipline (not a merge)

## Context

The verification-adjacent skills (test / lore-review / iterative-review / bug-hunt / dogfood / lore-uat / biz-review / product-lens, plus harness built-in `verify` and upstream `tdd`) had grown independently: trigger words collided (dogfood advertised "bug hunt" and "find issues"; lore-review advertised "find bugs"; four skills triggered on "review"), failure-path posture was wildly uneven (test and lore-uat mandated it; dogfood/iterative-review/lore-review were implicit or opportunistic), and nothing encoded the core lesson of the 2026-07-17 full-lifecycle dogfood: a verification pass that exercises only success paths misses whole defect classes (four found there in ten minutes of failure-path probing after a "clean" success-path run).

## Decision

1. **Family, not merge.** The lanes are genuinely distinct (static scan / runtime exploration / one-shot review / review-fix loop / suite authoring / requirement-driven acceptance). Convergence = one routing map + disjoint trigger words + explicit NOT-for cross-references in every description; no skill was physically merged or retired.
2. **One shared discipline, eight rules.** `assets/skills/shared/verification-discipline.md` (SSOT, vendored; installed at `~/.claude/skills/shared/`) — enumerate mandated failures first; prove the oracle can fail before trusting green; negative controls travel in pairs; hunt silent fallbacks deliberately; boundaries are failure scenarios; measure unpiped; name what was NOT covered; verdicts from external oracles only. Every family skill references it as MANDATORY, each with a lane-specific enforcement hook:
   - `test`: new tests must be SEEN RED first; NEGATIVE/ERROR dimensions derive from the contract's mandated failures; unpiped exit codes; fix tests ship negative-control siblings.
   - `lore-review`: happy-path-only test evidence in a diff = D-TEST BLOCKER.
   - `iterative-review`: "clean" exit now requires the failure-coverage gate, not merely zero findings.
   - `bug-hunt`: silent-fallback hunting is a first-class category; one refutation attempt per finding before it reports.
   - `dogfood`: mandatory destructive-probing pass (hostile input, double-submit, interrupted flows, unauthorized reach, two-tab staleness).
   - `lore-uat`: mandated rejections are first-class `R-NEG-##` inventory rows entering the same coverage matrix; uncovered P0 R-NEG blocks clean ACCEPT.
   - `biz-review`: `failure_modes` must be argued per scenario, never defaulted empty.
3. **zz-uat fully retired**: eval fixture (`evals.json`) and workspace directory renamed to lore-uat; no references remain.
4. **product-lens left content-unchanged** — it reviews product strategy, not implementation correctness; it appears in the routing map only. `tdd` (upstream shared) left unchanged, referenced as the methodology lane.

## Consequences

- Routing ambiguity drops: "bug hunt"→bug-hunt only; "find bugs" no longer claimed by lore-review; dogfood scoped to a RUNNING app.
- Distribution: the shared discipline file rides `lore setup` with the other vendored skills (assets-ssot manifest extended; conformance suite 69/69).
- Drift risk: lore-uat/lore-review/shared exist in two copies (assets SSOT + installed) — byte-parity is part of the assets-ssot oracle discipline; edit assets first, then sync.
- Rule 6 (unpiped measurement) was violated once more DURING this very convergence work (a `git status | head; echo $?` misread ~/.agents as a git repo) — reconfirming the rule pays for itself.
