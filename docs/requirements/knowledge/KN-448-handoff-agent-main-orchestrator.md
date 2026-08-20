---
id: KN-448
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-13
updated: 2026-08-18
tags: []
parent: PLAN-129
---
> ⚠ INVALIDATED 2026-08-13T02:31:42.254Z — superseded by knowledge-handoff-agent-main-orchestrator-101; Truncated by an authoring bug on my side, not a lore defect: the decision/next files had no trailing newline, so the shell read loop silently dropped the final line of each. Stored 10 decisions and 5 next steps against 11 and 6 intended. The complete set is in -101; feeding -100 would silently omit KD11 (my own corpus writes trip the repo-pollution guard) and NS6 (four filed defects need owners).

# Handoff — agent:main-orchestrator

SCOPE: 10 decisions + 5 next steps = 15 items to account for

## Plan

plan-land-multi-session-concurrency-p1-queryable-ownership-of

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | ⛔ lore feed renders ONLY these decision/next lines — a handoff BODY is invisible. All load-bearing content is here. Raw counts: lore ready → ready:1 archived:8 records:9. spec approved v20, ADR v5, plan active v3. Only main exists; no worktrees, no extra branches. | 98 |
| KD2 | ⛔ P1 delivers VISIBILITY, not SAFETY — the spec's own Goal now says so. Exclusion is NOT built: AC-EXCL-1..5, AC-LOCK-1..3, AC-SCOPE-1, AC-BIN-1, AC-MSG-1 are prose only and gate nothing. 6 of 17 criteria are declared and gating. | 97 |
| KD3 | ⛔ The --cwd blind spot is a CLASS: extractCdPrefixTarget AND commandRunsFileUnfiltered both strip only a literal 'cd <dir> &&'. Obeying this repo's own no-cd rule makes a task UN-ARCHIVABLE. Filed 01KZV3XFFY7SEZ9E11NZDC81W8 and 01KZVPHGEMFYWRW3JYB8RYP8F1. | 98 |
| KD4 | All 6 AC commands were rewritten to root-relative form (bun test packages/lore/tests/...) — the only shape satisfying both floors and the no-cd discipline. oracle_generation bumped 1→2 on each, so prior-generation evidence stays marked. | 95 |
| KD5 | ⛔ The two mirror exporters DISAGREE: bun run mirror:export never rewrites a changed file; a step inside the suite does. Proven — commit ec645f29 has 0 hits of the new spec prose, the post-suite tree has 1. Filed 01KZVAXZQAT4S9F4HGQT45YTT9 and 01KZWF5EFFNWW673QYEEPNCMVT. | 96 |
| KD6 | ⛔ So 're-export and commit before the run' CANNOT pre-clean a content-changed doc. Every past green full-suite verdict following a content-only corpus edit was green by ORDERING, not by state. | 94 |
| KD7 | ⛔ FOUR wiring gaps this plan, one cause: ANCHOR DESIGN, not implementer failure. Each time a capability and its ONLY production call site sat in different tasks' anchors. The fourth happened while the anchor mutex worked CORRECTLY. | 97 |
| KD8 | ⛔ A mutex prevents co-writing a file; it does NOT keep a capability and its call site in one acceptance unit. A spec's file anchors MUST cover both. All four implementers flagged the gap honestly — do not attribute this to the execution layer. | 97 |
| KD9 | ⛔ assess returned partially_met 72/100. Its BLOCKER was HALF WRONG — it read a stale test title and concluded the count fact was unasserted, but the exact-value assertion existed at line 360. Machine-check every assess finding that names a path. | 96 |
| KD10 | The 3 assess majors were TRUE and are now closed: an inert trailer (core.hooksPath outside .git made it a silent no-op in this repo while AC-OWN-4 was attested green), a claim-derived discovery set with a vacuous sum-equals-total, and a pure-function-only oracle for a command-named AC. | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1 — Dispatch the one ready task: task-wire-unbindclaimsessionfortrailer-into-lore-release-the. 4 hits in real-git-port.ts, 0 in task-workflow-service.ts. Until wired, commits after lore release keep the released session's trailer. Its AC MUST assert the LIVE call site.
- NS2: NS2 — Last full suite (ec645f29) was RED: build 0, test 1; vitest 509/509 green; bun 2137 pass / 2 fail. Both failures are the pollution guard on the SPEC-142 mirror — the exporter disagreement, not a code regression. Commit that mirror, then re-run with no corpus writes during the run.
- NS3: NS3 — ⛔ Do NOT close this plan yet. Re-run assess after NS1/NS2 and require a clean result; the last run was partially_met 72/100. ⛔ Do not paste the archival command lore done prints — confirm the plan-close gate actually evaluates on that path, and treat a vacuous PASS as the real risk.
- NS4: NS4 — Before P2 starts, declare the L1/L2 structured ACs. Two reviews flagged that the safety-critical half of the spec has no executable oracle. Deferral was deliberate — pinning an oracle to a guessed path destroys it — so declare them once P2's layout is measured, not predicted.
- NS5: NS5 — ⛔ P2 must capture the ORCHESTRATOR's own pid and start time. L0's beacon records process.ppid, the shell that invoked lore; the ADR says P2 must not inherit it. Enough for 'is a process behind this session alive', NOT enough for a lease that refuses another session's writes.
