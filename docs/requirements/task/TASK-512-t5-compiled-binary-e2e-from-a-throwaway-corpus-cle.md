---
id: TASK-512
type: task
role: plan
title: "T5 compiled-binary e2e from a throwaway corpus: clean close with advisory + blocked close naming the AC"
status: archived
priority: medium
phase: "Close-out"
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-102
plan: PLAN-102
---
## Task Objective

Prove the whole mechanism end-to-end through the COMPILED binary against a throwaway corpus — the only surface that shows what a consumer install actually gets.

Deliver `packages/lore/tests/e2e/plan-close-invariants-compiled.bun.test.ts`, driving `dist/lore` (never source, never the repo's own `.lore/`):

1. Scaffold a `mkdtemp` corpus, `lore init` inside it, cwd there for every call (canonical pattern: `packages/dashboard/tests/e2e/global-setup.ts`). Its `.lore/config.yaml` sets `workflow.gates."plan-close".prd_sync.enabled: true` and declares NO `workflow.attestation.min_ratio`.
2. Scenario A (closes clean): a PRD → spec (script-mode AC, so the ancestor spec has NO domain doc — its parent is the PRD) → plan → task; record attested evidence for that AC via the trusted-runner path; archive the plan. Assert exit 0, and assert the not-applicable advisory for the absent domain doc is VISIBLE in the output — a silent vacuous pass fails this test.
3. Scenario B (blocks): a sibling plan whose task claims the same declared AC with only self-reported evidence. Assert exit 4 and that the AC id appears in the output.
4. Control assertion (the interceptor must be live): scenario B's denial must disappear once the AC's evidence carries attestation, using the same corpus and the same command — otherwise a test that "passes" proves only that some other precondition failed.

Measure exit codes WITHOUT a pipe (`cmd > out 2>&1; echo $?` semantics — a piped exit code is the pipe's, not the command's). Run `bun run build` before the suite: a `.bun.test.ts` that spawns `dist/lore` against stale bytes is one of this repo's five recorded false-oracle vectors.

## Spec Reference

`spec-plan-close-predicates-measure-invariants-an-applicability` — AC-PCI-12 is the only AC that exercises the compiled surface; every other AC tests source. §D2's "loud on two channels" is what scenario A's advisory assertion pins.

## Acceptance Criteria

- AC-PCI-12 `cd packages/lore && bun test tests/e2e/plan-close-invariants-compiled.bun.test.ts -t 'compiled close'`

`-t 'compiled close'` is a contract — test names must contain it verbatim. This file runs under `bun test` ONLY (it uses `bun:sqlite` transitively via the binary); never add it to a vitest path.

## Context Digest

- ⛔ Never write to the repo's own `.lore/` corpus from a test. A stale `lore dashboard` on port 8787 once absorbed an e2e write suite into the real corpus (2026-07-07 pollution incident).
- Attested evidence is runner-issued ONLY; public write paths reject an `attestation` field. Produce it through `lore verify` inside the throwaway corpus (its AC command must be something trivially green there, e.g. a `true`-style command), not by hand-crafting the field.
- Exit-code map: 4 = gate deny. Assert the code, not just the message.
- T1-T4 are merged before this task starts; the predicates, the coverage conjunct, attribution, and the contract table are all live.

## File Anchors

- `packages/lore/tests/e2e/plan-close-invariants-compiled.bun.test.ts` — NEW
