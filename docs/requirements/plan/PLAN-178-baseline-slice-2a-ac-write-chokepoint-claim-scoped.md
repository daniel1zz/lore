---
id: PLAN-178
type: plan
role: plan
title: "Baseline slice 2a: AC write chokepoint, claim-scoped corpus authoring, indexes, completeness census, citation gate, rule read path"
status: archived
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: SPEC-157
phases:
  - {name: "Phase 1: Write paths", description: "AC write chokepoint (closes #36 for ACs, AC audit rows carry the real actor) and claim-scoped corpus authoring (fixes #39)."}
  - {name: "Phase 2: Indexes and census", description: "migration-014 indexes + backfill + mismatch count; completeness census and leaf coverage via the TypeScript compiler API."}
  - {name: "Phase 3: Citation gate", description: "Exemptions with cap, then the three-state per-branch citation gate; retire-vs-cite race closed in the write tx."}
  - {name: "Phase 4: Rule read path", description: "rule show/find/impact, task-start governing rules, snapshot narrowed to 4 doc types."}
  - {name: "Phase 5: Backfill and acceptance", description: "Rollback e2e, completeness backfill of specification and execution via claim-scoped writes, verify on main, full suite, assess."}
---
# Plan: Baseline slice 2a — machinery (AC write chokepoint, claim-scoped corpus authoring, indexes, completeness census, citation gate, rule read path)

Parent: `spec-baseline-slice-2-completeness-census-per-branch-citation` (approved v16). Covers AC-BLS2-1..12 and AC-BLS2-15 (added mid-plan, see Decisions Log). Out of scope here: AC-BLS2-13 (per-branch migration plans) and AC-BLS2-14 (slice 2c).

## Governance Mode
unattended — owner delegated approvals ("后面全自动") and chose unattended phase gates on 2026-10-08. Invariant violations hard-block regardless.

## Decisions Log
- 2026-10-08 Strategy: **Risk-first** (owner choice over Dependency-ordered and Vertical-slice): Phase 1 removes the two blockers that decide whether migration can be parallel and the gate honest (#36 bypass, #39 single writer); Phase 2 builds the indexes and the completeness census (largest unknown).
- 2026-10-08 Census implementation: **TypeScript compiler API static analysis** (owner choice over a hand-written command→service table). `typescript` is a root devDependency (^5.8.3, installed 5.9.3).
- 2026-10-08 Testing: independent tester agent writes each RED test in a worktree and records expected-fail on the spot; implementer records its own expected-fail before editing. **No RED→impl `blocks` edges** (slice-1 TASK-879 deadlock); order is enforced by phase and dispatch order. Full suite on main once per phase after merges.
- 2026-10-08 Exemptions are stored in a table created by migration-014 (one migration for all slice-2a tables).

- 2026-10-08 Independent plan audit (lore-reviewer, 5 dims all 3/5): 3 blocking findings fixed — I2 anchors the core claim schema + MCP tools (scope lives in task.extra.claim, no migration); I3 anchors status.ts and owns store read methods, edge I3->I4; edge I5->I7 and I7 anchors store/ + MCP tools. Non-blocking taken: gate reuses RuleReadService.find (edge I7->I6, one ranking SSOT); oracles made executable for chokepoint grep, MCP parity, latency, backfill actor, verify/handoff; B2 made self-contained with a >60-gap split rule. Not taken: splitting migration-014 and the gate further (kept L; revisit if either stalls).

- 2026-10-08 R6 contract decisions: exemption headroom = floor(10% x live ACs) - granted (same rounding as the cap); audit op 'cite_gate_would_refuse' and error.feeding_pack field names as pinned by the RED test; report mode records would-refuse rows on UNARMED branches too (needed to measure would_refuse before arming) — I6 adds its own test for this case; enforce + unarmed stays accepted with no row (pinned).
- 2026-10-08 R7: evidence row v3 on task-skill-test-red-retire-vs-cite-race-ac-bls2-3 is void (ran 4 ms from a wrong cwd, captured a failed cd); v4 is the real red (860 ms).
- 2026-10-08 Phase 1 gate (full suite on main at 9340d9e9): vitest 14 failed files = 5 planned RED (ac-exempt, cite-gate, feed-governing-rules, rule-read-impact, site-census) + pre-existing (setup, claude-md-eviction-floor, mirror-status-parity, spec-mirror-export, anchor-coverage-ratchet, anchor-coverage-stale-exemption — the last fails at ad8c8e3f too) + real-setup-ports (caused by another session's uncommitted assets/skills/shared/batched-governance.md, not this plan) + falsifier-dep-materialization (load-sensitive: fails under concurrent agent load, 3/3 pass in isolation) + error-message-commands-executable (REAL regression from I1: refusal text read as command 'lore ac verbs' — fixed in a follow-up commit). bun: 19 fail = planned RED migration-014/race + pre-existing setup-manifest, spec-loop pollution guard, github network, dashboard-sigterm.
- 2026-10-08 I3 deviation accepted: same-transaction index writes implemented as SQL triggers on docs (one definition covers every SQLite/Turso write path incl. sync); InMemoryStore computes the indexes as views. Hazard: a future migration that recreates docs drops the triggers — guarded by migration tests asserting the head trigger list.
- 2026-10-08 Replan (+2 tasks, Phase 2): I4 left interface-method calls neither followed nor reported (spec C1 requires dynamic dispatch reported as not_measured) and no CLI e2e for sites/coverage/map. R4b+I4b added; I4b blocks B1/B2 so the backfill does not run on a census that hides store-level refusals (e.g. the exemption cap). I4's out-of-anchor RuleService.setSiteMap accepted (single CAS write path for baseline writes).
- 2026-10-08 B1 stop rule (>60 starting gaps → split per leaf) fired at 93 gaps; first leaf took ~5 min with 4 new rules (37 sites). Decision: no split — the same agent continues the remaining 7 leaves; the stop rule's purpose (bounding an L task of unknown size) is met by the measured per-leaf cost.
- 2026-10-08 Replan (+2 tasks, +AC-BLS2-15): both backfills reached 0 gaps in worktrees but fail on main — census keys depend on node_modules layout (#60) and miss refusals not built with err() and same-code different-field sites (#59). AC-BLS2-12 cannot pass honestly until fixed; fail evidence recorded on B1 and B2 so their pass rows cannot close them. R4c+I4c added, I4c blocks B1/B2; backfills will remap under the corrected census (keys change).
- 2026-10-08 Contract bugs in RED tests fixed by the orchestrator as recorded test corrections (assertions unchanged): corpus-scope-lease read `lore get --json` at the wrong depth (#56); cite-gate latency case used a lowercase AC id (#61); cite-gate rollback-identity case compared timestamps and same-ms audit order (flaky). Invariant-5 miss: issue-report.test.ts pinned LATEST_SCHEMA_VERSION 13 — bumped.
- 2026-10-08 AC re-baselines (each logged in the spec's Amendment log): AC-BLS2-1 (create is a sanctioned, gated path — refusing it deleted BR-5), AC-BLS2-3 (oracle strengthened: the race test could not falsify the in-tx read; cite-gate-in-tx test added), AC-BLS2-11 (statement made literally true for mode-off with baseline docs), AC-BLS2-12 (command runs the census from source; binary defect #58 tracked separately). AC-BLS2-15 added.
- 2026-10-08 Closure: lore assess partially_met 71 (knowledge-assessment-baseline-slice-2a-ac-write-chokepoint); gaps triaged — #58 binary census (slice-3 distribution blocker, accepted here), backfill start counts were echoed strings (final passes captured on main by the orchestrator), split-rule decision recorded above, authorizeCite full scan filed #63.

## Invariants (checked at every phase gate)
1. No test or smoke run writes to this repo's `.lore/`; throwaway corpora via mkdtemp + `lore init`.
2. Every script AC passes via attested `lore verify` on main after merge, never self-reported.
3. With no baseline documents, or gate mode `off`, every pre-existing output is unchanged (AC-BLS2-11 guards it from Phase 5; checked by hand at earlier gates via `lore status --json` on a throwaway corpus).
4. No `LORE_GATE_BYPASS`, no `--steal`/forced release of foreign claims, no edits in foreign worktrees.
5. A schema-version bump is verified against every test that replays the migration chain or pins `user_version` (sync-push remote fixture, migration-*.bun.test.ts, schema-version pins, ordinal write-site check) — slice-1 regression lesson.
6. Main's full suite shows no new red relative to the pre-plan list (setup #38, setup-manifest-fields, store CLAUDE.md eviction floor, mirror parity x2, spec-loop pollution guard, github network). **Extended during execution (each with its proof, recorded at the phase gates)**: anchor-coverage-ratchet and anchor-coverage-stale-exemption (both fail on the pre-plan commit ad8c8e3f), real-setup-ports (caused by another session's uncommitted assets/skills/shared/batched-governance.md, not by this plan), falsifier-dep-materialization (load-sensitive; 3/3 green in isolation, also 2/8 red on 653cca85), dashboard-sigterm (pre-existing). The list was incomplete at planning time; extending it after the fact is disclosed here, not hidden.

## Risk Register
| Risk | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|
| Chokepoint breaks a legitimate write path (dashboard, migration, import) | H | any non-AC test red after P1 merge | P1 RED test enumerates the 4 entry points + byte-identical carry-over; full suite after merge | add the path to the chokepoint as a sanctioned caller, recorded in the spec |
| Claim-scoped corpus writes let a worktree damage the live corpus | H | a write outside the declared branch lands | scope = one branch's baseline docs + cite/map verbs; CAS; actor provenance; AC-BLS2-8 negative case | disable corpus scope (config) and fall back to orchestrator writes |
| Census misses sites (dynamic dispatch) and reports complete | H | AC-BLS2-5 fixture passes but a known refusal site is absent from a real command's census | not_measured is its own count; Phase 5 backfill compares census against a grep of `return err(` per file | widen census or record the site manually with a recorded reason |
| migration-014 regresses sync/replica fixtures | M | sync-push or migration chain test red | Invariant 5 in the P2 bundle | follow-up fixture task like slice-1 C9 |
| Gate latency on ac add/set | M | p95 > 50 ms | registry index read inside tx | cache-free by design; profile |
| Backfill uncovers hundreds of unmapped sites | M | > 100 gaps in one branch | split backfill per leaf | accept non-business exclusions with reasons, sampled in 2c |

## Estimation Summary
27 tasks after two replans: Phase 1 4, Phase 2 8 (R3, I3, R4, I4, R4b, I4b, R4c, I4c), Phase 3 5, Phase 4 6, Phase 5 4. Critical path below.

## Critical Path
As planned: I1 -> I2 -> I3 -> I5 -> I7 -> I6 -> R11 -> V1 = 20 session-units. As executed, the census branch became the longest chain: I1 -> I2 -> I3 -> I4 -> I4b -> I4c -> B1/B2 (remapped twice) -> V1, because two census defects (#59, #60) surfaced only when the backfills ran; the gate chain finished in parallel.

## Coverage
AC-BLS2-1 R1/I1 · 2 R6/I6 · 3 R7/I6 · 4 R3/I3 · 5 R4/I4/R4b/I4b · 6 R8/I7 · 7 R9/I8 · 8 R2/I2 · 9 R10/I9 · 10 R5/I5 · 11 R11 · 12 B1/B2 · 15 R4c/I4c — 13/13, 0 orphan tasks (V1 is the plan's verification gate).

## Exit Criteria
AC-BLS2-1..12 and AC-BLS2-15 attested pass on main (V1's lore verify: 13 passed, 0 failed, including AC-BLS2-12 run from source — binary path #58); full suite no new reds; `lore assess` reviewed; spec code anchors declared after landing; handoff written.
