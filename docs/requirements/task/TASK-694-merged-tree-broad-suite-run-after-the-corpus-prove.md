---
id: TASK-694
type: task
role: plan
title: "Merged-tree broad-suite run after the corpus-provenance plan landed"
status: draft
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Vehicle for NS3 of knowledge-handoff-agent-main-orchestrator-96: record the merged-tree broad-suite run as a corpus fact produced by a runner, not as a transcript claim.

Both `lore assess` MAJORs on the two plans closed in the prior session indicted the same thing — a green broad-suite run on the merged tree existed as a fact in the session transcript but not as an evidence row anyone could later audit. This task exists so that the run has somewhere to land.

`lore verify` cannot attest it: attestation derives the command from a declared script-mode AC, and there is no AC whose oracle is "the whole suite". `lore evidence --capture` is therefore the correct instrument — it spawns the command itself and records `capture_source: runner`, so the pass/fail is not self-reported even though it carries no `attestation` block. Per this repo's standing rule, `--capture` is for observation OUTSIDE any AC, which is exactly what a broad regression run is.

Known pre-existing failures at the time of this run, reproduced independently by four implementer agents at the merge-base and out of scope for the plan that just landed: two assertions in `packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts` (`AC-084-5`) expecting `"SPEC-1"` and receiving `"SPEC-001"`.
