---
id: TASK-926
type: task
role: plan
title: "[Skill:implement] archive --apply honours the done-floor port (#173)"
status: archived
priority: high
phase: "archive-sweep-floors"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-154
plan: PLAN-154
links:
  - {id: TASK-956, type: blocks}
  - {id: TASK-967, type: resolves}
---
Estimate: M
Approach: (1) CorpusService `archiveSweepCandidate` (corpus-service.ts:3221): for an R4 task candidate, call the DoneFloorPort before the status write; a floor → return an outcome `{ ok: false, skipped: true, floor, detail }` and write nothing (D8); err → the existing failure outcome; null → archive as today. R2/R3 handoffs unchanged. (2) commands/archive.ts (apply loop :129-150): render a skipped outcome as `[SKIPPED] <slug> — refused by <floor>`, carry `floor` in `--json`; `--sweep` (:94-120) keeps listing the task (exit 3) and appends the floor that would refuse it, computed through the same service call path (add a read-only service method if needed — never a second copy of the floors). (3) packages/core/src/archive-candidates.ts only if the candidate type needs a `floor` field. Run scoped: archive-apply-done-floors.bun.test.ts, integration/archive-sweep-cli.bun.test.ts, `bun run typecheck`. Straggler re-baseline (this task and its RED task own it; the approval task touches this file only at its line-261 plan approval): the existing straggler case in integration/archive-sweep-cli.bun.test.ts (~lines 150-200, the oracle of locked AC-097-3: `archive --apply` archives an evidence-less straggler and the re-sweep exits 0) goes red under U2 / spec D8. Re-baseline it so the HAPPY straggler carries an attested pass (still archived, re-sweep exits 0), and add a floor-refused straggler case: an evidence-less straggler stays open, `archive --apply` prints `[SKIPPED] <slug> — refused by attested-pass`, and the re-sweep exits 3. Record the original assertion and why (issue #173, BR-1072) in the evidence note.
Source: spec-approval-and-plan-closure-go-through-the-same-checks-on D8; issues #173, #47; facts archive.ts:94, corpus-service.ts:3221, archive-candidates.ts R4.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-AP-10, AC-AP-8

AC:
- AC-AP-10's command prints its PASS line; archive-sweep-cli.bun.test.ts passes with the re-baselined HAPPY straggler and the new floor-refused straggler case.
- `bun run typecheck` exits 0. Commit before attesting; stop at `lore release`.
