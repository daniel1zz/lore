---
id: KN-041
type: knowledge
role: knowledge
title: "P2 decision-score log (score-gated autonomy)"
status: draft
priority: medium
created: 2026-07-09
updated: 2026-07-09
tags: [ioc, p2, decision-log, calibration, autonomy]
links:
  - {id: PLAN-022, type: informs}
---
## Purpose

Running **confidence-scored decision log** for the P2 effort. Operating mode: score-gated autonomy — the agent decides and executes autonomously; the human is pulled in ONLY when a judgment scores below threshold or blast-radius is critical. This doc is the durable audit trail of those judgments (aligns with SPEC-035 calibration ethos: score every judgment, keep the record).

## Scoring protocol

- Each substantive judgment gets `[CONF: NN]` (0–100), assessed over: evidence strength × reversibility/blast-radius × oracle-verifiability × consistency-with-precedent.
- **Escalate to human** iff `CONF < 70` OR blast-radius = critical (irreversible / external / security / cross-service / architecture-direction).
- Otherwise autonomous; score recorded here for audit.

## Judgment log

| # | Judgment | CONF | Basis | Action |
|---|---|---|---|---|
| ① | P2 scope = C (generalize slice-1 checkpoints into a registry) + P2-before-P4 | 85 | ADR direction; user endorsed both | proceeded (user-confirmed at fork) |
| ② | Gate placement = C2 commit-time (plan-promote + task-claim), NOT C1 create-time | 90 | slice-1 precedent `parentLegal` checks type-not-status; measured P1 workflow (plan/task authored under draft upstream) | proceeded (user-confirmed at fork) |
| ③ | task-claim gate default ON | 80 | IoC inversion at execution boundary; config-disable escape | proceeded (user-confirmed at fork) |
| ④ | approve C2 spec + decompose to plan | 88 | evidence-anchored spec; reversible | AUTONOMOUS (≥70) |
| ⑤ | plan decomposition = lore-native, 3 phases / 6 tasks, serial dispatch | 82 | mirrors slice-1/P1; worktree isolation broken → serial per handoff | AUTONOMOUS (≥70) |

## Execution log (P2 T1–T6, all AUTONOMOUS, each ≥70)

| # | Judgment | CONF | Oracle (independently re-run by main agent) | Commit |
|---|---|---|---|---|
| ⑥ | T1 registry refactor behavior-preserving | 90 | 56 unit + 48 integration unchanged; typecheck 0 | 158a154 |
| ⑦ | T2 upstream predicates (approved-only, SSOT w/ readiness) | 88 | 30 predicate tests; typecheck 0 | 4a1d5ff |
| ⑧ | T3 plan-promote + task-claim gates (getPlanBundle SSOT traversal) | 90 | 14 cross-tier integration; vitest 2959 / bun 699 | a789757 |
| ⑨ | T4 workflow.gates config (browser-safe barrel) | 89 | 8 config-disable + 11 schema; full green | d798ad1 |
| ⑩ | T5 G3/G4 hook shims (mirror g2 fail-open) | 86 | G3×12 + G4×11 smoke; settings valid; dist rebuilt | 1e9adc1 |
| ⑪ | T6 e2e closed-loop + config-brake | 91 | 2 e2e pass; typecheck 0 / vitest 2970 / bun 709 | c3b50ff |

**Outcome:** P2 landed end-to-end. Dogfood confirmed — approving the P2 plan itself passed through the newly-built G3 `plan-promote` gate (`gate: pass`, because the P2 spec is approved + carries 6 AC). No judgment fell below 70 → no human escalation was triggered during execution, exactly as the score-gated-autonomy mode intends.

## P4 execution log (feed-before-produce + provenance, all AUTONOMOUS)

| # | Judgment | CONF | Oracle (main-agent re-run) | Commit |
|---|---|---|---|---|
| ⑫ | P4 scope = γ (feed-before-produce + provenance vertical slice at spec node) | 84 | ST-reasoned; ADR capabilities 2+4; reuses findFeedingSkill/gate-feeding | — |
| ⑬ | approve P4 spec + decompose (4 tasks) | 86 | 7 AC; reversible | — |
| ⑭ | T1 governs link type | 88 | subagent found real CHECK-constraint gap → migration-004 (both stores); 159 store tests | aa31b3d |
| ⑮ | T2 lore feed + lore_feed MCP (SSOT via shared flows/feed-flow) | 89 | 30 (feed SSOT + gate regression) | 313ebc8 |
| ⑯ | T3 provenance auto-write (fail-soft + idempotent) | 88 | 69 incl fail-soft with failing store double | cc98601 |
| ⑰ | T4 push infeasible (Tier-S: PreToolUse allow has no additionalContext) → pull-only; e2e | 90 | 13; documented not forced | 80b2555 |
| ⑱ | controlled dist/lore rebuild (backup + migration-004 integrity check on live corpus) | 92 | 212 docs / 43 spec / 39 knowledge unchanged; live `lore feed` works | — |

**P4 outcome:** feed-before-produce (deterministic `lore feed` + `lore_feed` MCP, tool 25) + bidirectional provenance (`governs` link auto-written at create, `--governed-by` forward + generic nav reverse) landed. Push was researched and found infeasible (evidence-driven, not forced). migration-004 applied cleanly to the live corpus (integrity verified). **ADR follow-ups now: P1 ✅ · P2 ✅ · P3 (slice done) · P4 ✅.** The IoC paradigm is realized end-to-end across all four capabilities. No judgment fell below 70 → zero human escalation during execution.

## Standing escalation triggers (bring to human)

- Any predicate/gate semantics ambiguity that would change what gets blocked.
- Refactor that risks slice-1 behavior regression NOT caught by existing tests.
- Config/schema change that could break existing `.lore/config.yaml` validation.
- Any oracle (tsc/test/e2e) that stays red after 2 subagent retries.
