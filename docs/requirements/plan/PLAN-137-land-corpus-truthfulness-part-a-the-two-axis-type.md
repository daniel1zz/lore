---
id: PLAN-137
type: plan
role: plan
title: "Land corpus truthfulness part A — the two-axis type foundation and the six implementation chains that consume it"
status: approved
priority: medium
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: SPEC-143
phases:
  - {name: "P0 Type foundation", description: "The shared type cluster every other chain consumes: StampClass (stamp axis, three-valued), RadiusMeasurement (discriminated union mirroring real-git-port.ts::BranchMeasurement), StampCurrency, StampVerdict and the total readStampVerdict projection in gate-predicates.ts; StateStamp and the ARMING_REV constant in packages/core/src/task-workflow.ts. Serial and foundational — its shape gates four of the six chains. Its AC requires a compile-only consumer fixture exercising all five verdict readings and both radius arms before it archives, so a wrong shape surfaces here rather than in four parallel worktrees."}
  - {name: "P1 Independent labels", description: "The two chains that consume NO new type and therefore run fully parallel to P0: AC-CT-2 (evidence-capture writes a real attestation from spawnResult data it already measures) and AC-CT-1+AC-CT-7 (projectAcCoverageGlyph with a never exhaustiveness check, the two-rule check-ac-state-renderers.ts scan with its --rule selector, and D7's same-commit amendment of SPEC-038 AC-ACODE-9 plus outline-service.ts's two mirroring JSDoc sites). AC-CT-1 and AC-CT-7 are ONE task because they share the scan script file."}
  - {name: "P2 Stamp mechanisms", description: "Four mutually independent chains, all blocked by P0's type foundation and parallel to each other once it archives: AC-CT-3 (stamp axis classified by the immutable arming_rev cutoff, with the mandatory accept-control half), AC-CT-4 (blastRadiusChanged returning RadiusMeasurement via git diff --quiet, pathspec-validity resolvability, four halves with live controls), AC-CT-5 (VerifyRunnerService pre/post stamp reads with a REAL commit injected between them — never a fake GitPort), AC-CT-8 (probeOccupancy's SKIPPED-and-continue contract with its live control and the user-surface assertion)."}
  - {name: "P3 Phase-gate verification", description: "The plan's own final gate: full dual-runner suite on merged main (bun run test:vitest + bun run test:bun), bun run typecheck, lore verify for every in-scope script-mode AC, lore status --check-tree --check-drift, a dist/lore rebuild for binary provenance, and confirmation that SPEC-038 is back to approved after T2's D7 amendment. Without this phase the plan has no final gate and could be declared complete on per-task evidence alone."}
links:
  - {id: SPEC-143, type: implements}
---
# Land corpus truthfulness, part A — the two-axis type foundation and the six implementation chains that consume it

Builds SPEC-143 Migration **Phase 1 (honest labels)** in full, and the **mechanisms** of Phase 2 (the stamp), decomposed Interface-First. Part B (a separate plan, cut after this one merges) carries D3 wiring — `attestationFloor`'s two-axis decision and the two parallel distributions — plus final acceptance.

⛔ **This plan does NOT complete Phase 2, and saying otherwise would contradict the governing spec.** SPEC-143's Migration step 6 states: "⛔ Phase 2 is not done without this step — that is the difference between a mechanism and a metadata field." Step 6 is AC-CT-9, deferred to part B. Concretely: `blastRadiusChanged` lands here as a correctly-tested pure function that `attestationFloor` does not yet consult for a real gate decision. Every mechanism in P2 is in that state until part B wires it. The plan's own gate task (P3) must report this rather than let a green board imply Phase 2 is closed.

## Scope and AC coverage

| Plan | Spec ACs |
|---|---|
| **This plan (A)** | AC-CT-1, AC-CT-2, AC-CT-3, AC-CT-4, AC-CT-5, AC-CT-7, AC-CT-8 — **7** |
| Part B (not yet cut) | AC-CT-9, AC-CT-10 — 2 |
| Out of scope, spec Migration Phase 3 | AC-CT-6 (C7 push-path convergence) — 1 |

⛔ 7/10 here is deliberate, not a coverage gap. The `lore ac list SPEC-143` set is 10; the missing 3 are accounted for above and must be re-checked when part B is cut.

## Governance mode

`attended` — every phase gate requires explicit user confirmation before the next phase dispatches. Invariant violations hard-block regardless of mode.

## Invariants — verified at every phase gate

- **INV-1** `bun run typecheck` exits 0 on `main` after every merge.
- **INV-2** Both runners green at each phase gate: `bun run test:vitest` and `bun run test:bun`. ⛔ Worktree-scoped runs during execution use `bun run test:changed <base>`; the full suite runs only on `main` after merge.
- **INV-3** SPEC-143 reads `approved` at the moment of every dispatch. ⛔ `lore ac set` by any task demotes it to `draft` and hard-blocks EVERY descendant claim; re-read the status immediately before each dispatch, never from a batch-start snapshot.
- **INV-4** Every red-first AC's failing evidence is recorded by the agent that produced the red, at the moment it was red (`lore evidence --result expected-fail`). ⛔ Transcription by the orchestrator afterwards does not count, with or without a disclaimer.
- **INV-5** `lore status --check-tree --check-drift` exits 0 at each phase gate.
- **INV-6** `dist/lore` is rebuilt (`bun run build`) after the last merge of each wave, before any push. ⛔ `--check-binary-provenance` exits 3 on a `dist/lore` older than HEAD, which is every merge not followed by a rebuild.
- **INV-7** No new `TODO`/`FIXME` markers enter the tree.

## Risk Register

| Risk | Impact | Trigger (observable) | Mitigation (in the task tree) | Contingency |
|---|---|---|---|---|
| The type foundation is a single point of failure — six consumers depend on it, so a wrong shape means full-line rework | **H** | Any P1/P2 task reports the declared types cannot express its case | T0's AC requires a compile-only consumer fixture exercising all five `StampVerdict` readings and both `RadiusMeasurement` arms BEFORE T0 archives | Halt the wave, revise types in a follow-up task, re-dispatch consumers from the corrected base |
| AC-CT-5's injection seam is timing-sensitive — a REAL commit must land between the runner's pre-read and post-read, and the spec explicitly refuses a fake `GitPort` | **H** | The test passes with the commit landing outside the window, or flakes across runs | T5 is estimated L and paired with its own RED task whose scenarios pin the ordering; the falsifier (record only the post-run stamp) must be observed red | If the seam cannot be hit deterministically, escalate to the user — ⛔ do NOT weaken to a fake port, which the spec rejects by name |
| D7 forces AC-ACODE-9 and two JSDoc sites into the SAME commit as the renderer fix, and the `ac set` demotes SPEC-038 to `draft` | **M** | SPEC-038 reads `draft` after T2 merges | T2's bundle states the same-commit requirement explicitly; the main agent runs `lore review` + `lore approve` on SPEC-038 immediately after merging T2 | If a descendant claim is blocked meanwhile, re-approve first and re-dispatch |
| Anchor overlap between sibling tasks — measured: exactly ONE pair | **M** | `lore ready --json` reports `anchor_conflicts[]` non-empty | Enumerated over all 15 tasks' declared `file_anchors` 2026-08-23: the only file appearing twice is `packages/lore/src/service/gate-predicates.ts` (T0 and the AC-CT-3 task), already serialized by a `blocks` link. A second potential collision was removed by construction — AC-CT-1 and AC-CT-7 are ONE task because both write `check-ac-state-renderers.ts`. ⛔ An earlier version of this row said "three pairs"; that count was never verifiable against the anchors it claimed to summarise | Never leave a conflict to dispatch time — the gate would stall the second agent |
| All 10 ACs carry PROSE falsifiers, not structured fields; nothing forces redemption | **M** | A task reports pass without ever having observed its falsifier red | Each implement task's AC requires running the declared mutation once and recording the red | Accepted residual — the mechanism needs its own spec (`knowledge-a-declared-property-with-no-measuring-oracle-and-the`) |
| A peer session lands commits mid-wave, reddening a worktree for reasons unrelated to the diff | **M** | A worktree suite reddens on files the task never touched | Scoped runs via `bun run test:changed <base>`; full suite only on `main` | Re-verify at the merged tree before attributing failure to the task |

## Estimation

Measured from the created tasks (S=1, M=2, L=3), not from the pre-decomposition estimate:

| Phase | Tasks | Session-units |
|---|---|---|
| P0 Type foundation | 2 | 3 |
| P1 Independent labels | 4 | 7 |
| P2 Stamp mechanisms | 8 | 14 |
| P3 Phase-gate verification | 1 | 1 |
| **Total** | **15** | **25** |

**Critical path**: `T0-test(1) → T0(2) → T5-test(2) → T5(3) → T9(1)` = **9 session-units** — the AC-CT-5 chain, whose RED task is M rather than S because the real-commit injection window has to be constructed, and whose implementation is the plan's only other L.

All six chains, for comparison:

| Chain | Path | Units |
|---|---|---|
| AC-CT-5 | T0-test → T0 → T5-test → T5 → T9 | **9** ← critical |
| AC-CT-3 | T0-test → T0 → T3-test → T3 → T9 | 7 |
| AC-CT-4 | T0-test → T0 → T4-test → T4 → T9 | 7 |
| AC-CT-8 | T0-test → T0 → T6-test → T6 → T9 | 7 |
| AC-CT-1+7 | T2-test → T2 → T9 | 6 |
| AC-CT-2 | T1-test → T1 → T9 | 3 |

⛔ **9 still exceeds the plan skill's 6-unit critical-path threshold, and an earlier version of this section claimed 6.** That figure was wrong: it estimated T5-test at S and omitted the gate task. Recorded rather than quietly corrected, because the split into parts A and B was justified partly on the claim that A's critical path fell to 6. The split remains right on other grounds — part B's tasks can be written against types that exist rather than against declarations — but it did NOT bring the critical path under the threshold. The residual is structural: the type foundation must precede the AC-CT-5 seam, which must precede the gate, and no reordering removes that.

P1 runs fully parallel to P0 (neither of its chains consumes the new types), and P2's four chains are mutually independent once T0 archives.

## Exit Criteria

- All 15 tasks archived (or deprecated with rationale in the Decisions Log).
- Every one of the 7 ACs in scope carries attested pass evidence via `lore verify`, and every one carries a recorded `expected-fail` from its red phase.
- `lore assess` run and findings triaged.
- All H-impact risks either did not trigger, or triggered and were mitigated with the outcome recorded here.
- SPEC-038 back to `approved` after T2's D7 amendment.
- Part B's scope re-confirmed against `lore ac list SPEC-143` before it is cut — the AC set may have moved.
- ⛔ The completion report states explicitly that SPEC-143 Migration Phase 2 remains OPEN after this plan, AC-CT-9 being outstanding. A plan that closes green while its governing spec's own completion bar is unmet must say so in the same breath.

## Decisions Log

| ID | Decision | Rationale |
|---|---|---|
| D-A1 | Decomposition strategy: **Interface-First** | Six consumers depend on one type cluster; defining it first collapses O(N) sequential depth to O(1). Alternatives considered: spec's own Migration ordering (rejected — forces C5 to wait a phase it has no dependency on) and Risk-First (rejected — the two riskiest ACs both depend on the type foundation, so they cannot go first) |
| D-A2 | Scope split into part A and part B | 19 tasks / critical path 15 breached both plan-skill thresholds. Splitting at the wiring boundary drops A's critical path to 6, and part B's tasks can then be written against types that EXIST rather than against declarations |
| D-A3 | Red-first via paired `[Skill:test]` RED tasks, test blocks impl | Separates the agent that writes the failing test from the agent that makes it pass; INV-4's evidence is then produced by a party with no stake in it passing |
| D-A4 | Concurrency: multi-worktree, `attended` phase gates | Each implementer gets its own worktree and a distinct `LORE_ACTOR`; claims are raised by the implementer inside its own worktree, never pre-claimed here |
| D-A5 | D7 handled inside T2, re-approval by the main agent | The spec makes the same-commit requirement mechanical; the re-approval cannot be done by the implementer, which cannot assert the merge landed |
| D-A6 | Failure loop: retry ≤2 with the failure text, then a fresh agent with the failure summary as an anti-pattern | Project standing protocol |
| D-A7 | `capture_source` and stamp-verdict are TWO PARALLEL distributions (decided this session, R12) | Recorded here because part B implements it; folding them yields non-exclusive buckets summing to twice the row count |
